/**
 * The base character, `sd_base_v3`: a stylised game avatar modelled as signed
 * distance fields and meshed by sdf.mjs.
 *
 * Everything else is built from this file:
 *  - the body field `bodyD` is the surface every skinned garment is offset
 *    from (templates.mjs), so clothing follows the real silhouette;
 *  - `bodyRegions` gives each region's skin weights, used for the body and
 *    for every garment vertex, so body and clothes deform together;
 *  - the cranium is exactly rig.HEAD, shared by every face shape, so hair,
 *    hats and eyewear fit all of them.
 *
 * Proportions (rest pose, metres): 1.80 tall, head 0.285 chin-to-crown,
 * shoulders 0.50 across the deltoids, waist 0.25, hips 0.30.
 */
import * as THREE from "three";
import { HEAD, REST, sideBone as B } from "./rig.mjs";
import { arm, leg, sgn, torsoWeights } from "./anatomy.mjs";
import { mix } from "./geometry.mjs";
import { clamp, gauss, rotation, sdCone, sdEllipsoid, sdRoundBox, smax, smin, sstep, Sweep, toLocal } from "./sdf.mjs";

const SIDES = ["L", "R"];

/**
 * Body build, -1 (slim) … 0 (base) … +1 (broad). The generator meshes the
 * body at 0 and samples the ±1 fields to bake the `buildSlim` / `buildBroad`
 * blendshapes; nothing else should change it.
 */
let BUILD = 0;
export function setBuild(b) {
  BUILD = b;
}
export const getBuild = () => BUILD;
const bk = (k) => 1 + k * BUILD; // scale factor for a body measurement

/* ── limbs as swept tubes ────────────────────────────────────────────────── */

function frameOf(tan) {
  const t = new THREE.Vector3(...tan).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), t);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const front = new THREE.Vector3().crossVectors(t, side).normalize();
  if (front.z < 0) front.negate();
  return { side: side.toArray(), front: front.toArray() };
}

function limbSweep(sampler, n) {
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = sampler(t);
    samples.push({ c: s.c.toArray(), rx: s.rx, rz: s.rz, t, ...frameOf(s.tan.toArray()) });
  }
  return new Sweep(samples);
}

const SWEEPS = new Map();
/** The arm and leg sweeps for the current build. */
function sweeps() {
  let v = SWEEPS.get(BUILD);
  if (!v) {
    v = {
      ARM: Object.fromEntries(SIDES.map((s) => [s, limbSweep(arm(s, BUILD), 64)])),
      LEG: Object.fromEntries(SIDES.map((s) => [s, limbSweep(leg(s, BUILD), 72)])),
      MUSCLES: Object.fromEntries(SIDES.map((s) => [s, limbMuscles(s, BUILD)])),
    };
    SWEEPS.set(BUILD, v);
  }
  return v;
}

/** A point on a limb: centre at t, pushed `f` along its front and `o` outward (away from the body midline). */
function onLimb(sampler, t, f = 0, o = 0) {
  const s = sampler(t);
  const { side, front } = frameOf(s.tan.toArray());
  const out = Math.sign(s.c.x) || 1;
  return [0, 1, 2].map((k) => s.c.getComponent(k) + front[k] * f + side[k] * o * out);
}

/** Muscle bellies on the limbs, as ellipsoids along the limb axis. */
function limbMuscles(side, build) {
  const A = arm(side, build);
  const L = leg(side, build);
  const tE = A.tJoint;
  const tK = L.tJoint;
  const m = (1 + 0.16 * build) * 0.92;
  const out = [];
  const axisRot = (sampler, t) => {
    const tan = sampler(t).tan;
    // Rotation that maps +Y to the limb tangent (limbs are close to vertical).
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().negate());
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    return rotation(e.x, e.y, e.z);
  };
  const r = (a, b, c) => [a * m, b, c * m];
  // biceps (front), triceps (back), forearm (outer/front)
  out.push({ c: onLimb(A, tE * 0.52, 0.012 * m, 0), r: r(0.039, 0.072, 0.034), R: axisRot(A, tE * 0.52), k: 0.02 });
  out.push({ c: onLimb(A, tE * 0.45, -0.013 * m, 0.004), r: r(0.041, 0.077, 0.036), R: axisRot(A, tE * 0.45), k: 0.02 });
  out.push({ c: onLimb(A, tE + (1 - tE) * 0.28, 0.006, 0.008), r: r(0.035, 0.07, 0.032), R: axisRot(A, tE + (1 - tE) * 0.28), k: 0.02 });
  // quads (front), hamstrings (back), calf (back), knee cap
  out.push({ c: onLimb(L, tK * 0.48, 0.014 * m, 0.006), r: r(0.058, 0.13, 0.046), R: axisRot(L, tK * 0.48), k: 0.045 });
  out.push({ c: onLimb(L, tK * 0.5, -0.012 * m, 0), r: r(0.058, 0.13, 0.046), R: axisRot(L, tK * 0.5), k: 0.045 });
  out.push({ c: onLimb(L, tK + (1 - tK) * 0.3, -0.014 * m, 0.002), r: r(0.043, 0.095, 0.04), R: axisRot(L, tK + (1 - tK) * 0.3), k: 0.04 });
  out.push({ c: onLimb(L, tK - 0.012, 0.036, 0), r: [0.028, 0.03, 0.018], R: axisRot(L, tK), k: 0.03 });
  return out;
}
const muscleD = (m, x, y, z) => {
  const l = toLocal(m.R, m.c, x, y, z);
  return sdEllipsoid(l[0], l[1], l[2], m.r[0], m.r[1], m.r[2]);
};

function armD(s, x, y, z) {
  const { ARM, MUSCLES } = sweeps();
  if (!ARM[s].near(x, y, z, 0.02)) return 1;
  let d = ARM[s].eval(x, y, z).d;
  const [bi, tri, fore] = MUSCLES[s];
  d = smin(d, muscleD(bi, x, y, z), bi.k);
  d = smin(d, muscleD(tri, x, y, z), tri.k);
  d = smin(d, muscleD(fore, x, y, z), fore.k);
  return d;
}

function legD(s, x, y, z) {
  const { LEG, MUSCLES } = sweeps();
  if (!LEG[s].near(x, y, z, 0.03)) return 1;
  let d = LEG[s].eval(x, y, z).d;
  const [, , , quad, ham, calf, knee] = MUSCLES[s];
  d = smin(d, muscleD(quad, x, y, z), quad.k);
  d = smin(d, muscleD(ham, x, y, z), ham.k);
  d = smin(d, muscleD(calf, x, y, z), calf.k);
  d = smin(d, muscleD(knee, x, y, z), knee.k);
  return d;
}

/* ── torso, neck and shoulders ───────────────────────────────────────────── */

const DELT_R = Object.fromEntries(SIDES.map((s) => [s, rotation(0, 0, sgn(s) * 0.42)]));
const PEC_R = Object.fromEntries(SIDES.map((s) => [s, rotation(0.1, sgn(s) * 0.25, sgn(s) * -0.18)]));

function deltoidD(s, x, y, z) {
  const k = bk(0.13);
  const l = toLocal(DELT_R[s], [(0.173 + 0.006 * BUILD) * sgn(s), 1.364, -0.008], x, y, z);
  return sdEllipsoid(l[0], l[1], l[2], 0.0395 * k, 0.061 * bk(0.05), 0.0455 * k);
}

function torsoD(x, y, z) {
  const ax = Math.abs(x);
  if (y < 0.78 || y > 1.66 || ax > 0.32) return Math.max(0.05, Math.abs(y - 1.2) - 0.5);
  const w = bk(0.085), dp = bk(0.07);
  // Rib cage and upper chest give the V; the abdomen pinches the waist in.
  let d = sdEllipsoid(x, y - 1.268, z - 0.004, 0.136 * w, 0.158, 0.1 * dp);
  d = smin(d, sdEllipsoid(x, y - 1.345, z - 0.0, 0.142 * bk(0.1), 0.066, 0.089 * dp), 0.05);
  const side = x >= 0 ? "L" : "R";
  {
    const pk = bk(0.16);
    const l = toLocal(PEC_R[side], [0.064 * sgn(side) * w, 1.322, 0.05 * dp], x, y, z);
    d = smin(d, sdEllipsoid(l[0], l[1], l[2], 0.068 * pk, 0.05 * pk, 0.041 * pk), 0.03);
  }
  d = smin(d, sdEllipsoid(ax - 0.094 * w, y - 1.24, z + 0.018, 0.058 * bk(0.16), 0.13, 0.068), 0.045); // lats
  d = smin(d, sdEllipsoid(x, y - 1.1, z - 0.01, 0.121 * bk(0.11), 0.13, 0.09 * bk(0.13)), 0.075); // abdomen
  d = smin(d, sdEllipsoid(x, y - 0.95, z + 0.002, 0.138 * bk(0.07), 0.096, 0.1 * bk(0.07)), 0.09); // pelvis
  d = smin(d, sdEllipsoid(ax - 0.062 * bk(0.05), y - 0.918, z + 0.046 * bk(0.08), 0.072 * bk(0.08), 0.078, 0.064 * bk(0.08)), 0.04); // glutes
  d = smin(d, sdEllipsoid(ax - 0.112 * bk(0.06), y - 0.94, z + 0.004, 0.05, 0.07, 0.07), 0.04); // hip flare
  // Trapezius: neck to the top of the shoulder.
  d = smin(d, sdCone(ax, y, z, [0.03, 1.446 + 0.004 * BUILD, -0.026], [0.145 * bk(0.04), 1.406, -0.02], 0.029 * bk(0.18), 0.025 * bk(0.12)), 0.04);
  d = smin(d, deltoidD(side, x, y, z), 0.045);

  // Surface detail (inward is positive).
  const front = sstep(0.0, 0.05, z);
  const back = sstep(0.0, -0.05, z);
  let dent = 0;
  dent += 0.0028 * front * gauss(x, 0, 0.009) * sstep(1.0, 1.05, y) * sstep(1.27, 1.2, y); // linea alba
  dent += 0.0016 * front * gauss(ax, 0.04, 0.03) * (gauss(y, 1.125, 0.006) + gauss(y, 1.07, 0.006)) * sstep(0.04, 0.07, z); // abs
  dent += 0.004 * front * gauss(x, 0, 0.006) * gauss(y, 1.025, 0.006); // navel
  dent += 0.0026 * front * gauss(y, 1.27, 0.01) * gauss(ax, 0.07, 0.04); // under-pec line
  dent += 0.003 * back * gauss(x, 0, 0.012) * sstep(0.98, 1.06, y) * sstep(1.42, 1.34, y); // spine groove
  dent -= 0.0018 * front * gauss(y, 1.418, 0.008) * gauss(ax, 0.07, 0.04); // collarbones
  dent += 0.003 * front * gauss(x, 0, 0.012) * gauss(y, 1.43, 0.012); // jugular notch
  return d + dent;
}

/** Neck: a column from the trapezius up inside the head, with the jaw crease done by the head mesh. */
function neckD(x, y, z) {
  if (y < 1.33 || y > 1.7 || Math.abs(x) > 0.12) return 1;
  const k = bk(0.08);
  let d = sdCone(x, y, z, [0, 1.38, -0.018], [0, 1.62, -0.004], 0.057 * k, 0.048 * bk(0.05));
  // Sternocleidomastoid: two cords from behind the ears to the collarbones.
  for (const s of [1, -1]) d = smin(d, sdCone(x, y, z, [0.048 * s, 1.56, -0.016], [0.016 * s * k, 1.43, 0.042 * k], 0.014, 0.012), 0.02);
  return d;
}

/* ── hands ───────────────────────────────────────────────────────────────── */

const HAND = Object.fromEntries(
  SIDES.map((side) => {
    const s = arm(side)(1);
    const dir = s.tan.clone().normalize();
    const inward = new THREE.Vector3(-sgn(side), 0, 0);
    inward.addScaledVector(dir, -inward.dot(dir)).normalize();
    // Palms face the thighs, turned a little toward the front.
    inward.applyAxisAngle(dir, sgn(side) * -0.32);
    const front = new THREE.Vector3().crossVectors(dir, inward).normalize();
    if (front.z < 0) front.negate();
    return [side, { o: s.c.clone().addScaledVector(dir, -0.004), dir, inward, front }];
  })
);

const HS = 1.12; // hand scale: stylised hands read a touch larger
/**
 * Fingers: [width position (+ = toward the thumb), proximal, middle, distal
 * phalanx lengths, radius, splay (rad), curl (rad)]. Side by side with no
 * gaps, each curling into the palm a little more than the last — a hand at
 * rest, not a spread glove.
 */
const FINGERS = [
  [0.0305, 0.043, 0.027, 0.021, 0.0092, 0.035, 0.32],
  [0.0102, 0.046, 0.029, 0.022, 0.0095, 0.0, 0.4],
  [-0.0102, 0.044, 0.028, 0.021, 0.009, -0.025, 0.5],
  [-0.0292, 0.035, 0.022, 0.018, 0.008, -0.07, 0.6],
];

function handD(side, x, y, z) {
  const H = HAND[side];
  const qx = x - H.o.x, qy = y - H.o.y, qz = z - H.o.z;
  const a = (qx * H.dir.x + qy * H.dir.y + qz * H.dir.z) / HS; // along the fingers
  const b = (qx * H.front.x + qy * H.front.y + qz * H.front.z) / HS; // across the palm
  const c = (qx * H.inward.x + qy * H.inward.y + qz * H.inward.z) / HS; // out of the palm
  if (a < -0.05 || a > 0.21 || Math.abs(b) > 0.09 || Math.abs(c) > 0.08) return 1;
  const taper = 1 - 0.1 * clamp(a / 0.09, 0, 1);
  let d = sdRoundBox(a - 0.048, b * (1 / taper), c + 0.001, 0.046, 0.043, 0.015, 0.013);
  // Relaxed curl through three joints.
  for (const [w, l1, l2, l3, r, splay, curl] of FINGERS) {
    const k0 = [0.09, w, 0.0];
    const sx = Math.sin(splay);
    const seg = (p, l, th) => [p[0] + l * Math.cos(th), p[1] + l * sx, p[2] + l * Math.sin(th)];
    const k1 = seg(k0, l1, curl);
    const k2 = seg(k1, l2, curl * 2.3);
    const k3 = seg(k2, l3, curl * 3.1);
    const f = Math.min(sdCone(a, b, c, k0, k1, r, r * 0.93), sdCone(a, b, c, k1, k2, r * 0.93, r * 0.86), sdCone(a, b, c, k2, k3, r * 0.86, r * 0.74));
    d = smin(d, f, 0.0035);
  }
  const t0 = [0.022, 0.038, 0.006];
  const t1 = [0.05, 0.062, 0.026];
  const t2 = [0.074, 0.068, 0.044];
  d = smin(d, Math.min(sdCone(a, b, c, t0, t1, 0.0145, 0.012), sdCone(a, b, c, t1, t2, 0.0115, 0.0098)), 0.012);
  // Knuckle ridge.
  d -= 0.0012 * gauss(a, 0.09, 0.008) * sstep(0, -0.01, c);
  return d * HS;
}

/* ── feet ────────────────────────────────────────────────────────────────── */

function footD(side, x, y, z) {
  const s = sgn(side);
  const cx = REST[B("Foot", side)][0];
  if (Math.abs(x - cx) > 0.085 || y > 0.15 || z < -0.11 || z > 0.22) return 1;
  const lx = (x - cx) * s; // + = outer side
  let d = sdEllipsoid(lx + 0.002, y - 0.046, z + 0.03, 0.04, 0.046, 0.05); // heel
  d = smin(d, sdEllipsoid(lx - 0.002, y - 0.044, z - 0.045, 0.045, 0.04, 0.085), 0.03); // mid-foot
  d = smin(d, sdEllipsoid(lx - 0.004, y - 0.03, z - 0.122, 0.048, 0.028, 0.052), 0.03); // ball + toes
  d = smin(d, sdEllipsoid(lx + 0.018, y - 0.032, z - 0.158, 0.016, 0.022, 0.022), 0.012); // big toe
  // Toes: four small pads in front of the ball.
  for (let i = 0; i < 4; i++) d = smin(d, sdEllipsoid(lx - 0.006 - i * 0.0105, y - 0.022, z - (0.156 - i * 0.008), 0.0058, 0.012, 0.012), 0.006);
  // Arch on the inside.
  d += 0.006 * gauss(y, 0.008, 0.012) * gauss(z, 0.03, 0.04) * sstep(0, 0.03, -lx);
  return smax(d, 0.004 - y, 0.006);
}

/* ── the body field ──────────────────────────────────────────────────────── */

const footWeights = (s, x, y, z) => {
  let w = mix({ [B("Foot", s)]: 1 }, { [B("Leg", s)]: 1 }, sstep(0.075, 0.105, y) * sstep(0.03, -0.03, z) * 0.6);
  // Toes bend at the ball of the foot.
  w = mix(w, { [B("ToeBase", s)]: 1 }, sstep(0.095, 0.13, z));
  return w;
};

/** Distance to every body region, with its skin weights. */
export function bodyRegions(x, y, z) {
  const { ARM, LEG } = sweeps();
  const r = [];
  r.push({ d: torsoD(x, y, z), w: torsoWeights({ x, y, z }), name: "torso" });
  const n = neckD(x, y, z);
  let nw = mix({ Spine2: 0.55, Neck: 0.45 }, { Neck: 1 }, sstep(1.41, 1.47, y));
  nw = mix(nw, { Head: 1 }, sstep(1.48, 1.54, y));
  r.push({ d: n, w: nw, name: "neck" });
  for (const s of SIDES) {
    const a = ARM[s].near(x, y, z, 0.05) ? ARM[s].eval(x, y, z) : { d: 1, t: 0 };
    r.push({ d: armD(s, x, y, z), w: arm(s)(a.t).w, name: "arm", side: s, t: a.t });
    r.push({ d: deltoidD(s, x, y, z), w: { [B("Shoulder", s)]: 0.35, [B("Arm", s)]: 0.65 }, name: "deltoid", side: s });
    r.push({ d: handD(s, x, y, z), w: { [B("Hand", s)]: 1 }, name: "hand", side: s });
    const l = LEG[s].near(x, y, z, 0.05) ? LEG[s].eval(x, y, z) : { d: 1, t: 0 };
    r.push({ d: legD(s, x, y, z), w: leg(s)(l.t).w, name: "leg", side: s, t: l.t });
    r.push({ d: footD(s, x, y, z), w: footWeights(s, x, y, z), name: "foot", side: s });
  }
  return r;
}

/** The nearest region and its limb parameter — garments use this to cut sleeves and legs. */
export function bodyPart(x, y, z) {
  let best = null;
  for (const r of bodyRegions(x, y, z)) if (!best || r.d < best.d) best = r;
  return best;
}

/**
 * Which hide region (rig.BODY_REGIONS) a point on the skin belongs to. The
 * boundaries are chosen so each standard garment covers whole regions with
 * a margin — e.g. short sleeves end inside "elbows", shorts inside "knees".
 */
export function regionOf(x, y, z) {
  const p = bodyPart(x, y, z);
  const radialNeck = Math.hypot(x, (z + 0.012) * 0.92);
  switch (p.name) {
    case "neck":
      return "neck";
    case "hand":
      return "hands";
    case "foot":
      return "feet";
    case "deltoid":
      return "shoulders";
    case "arm":
      return p.t < 0.25 ? "upperArms" : p.t < 0.5 ? "elbows" : p.t < 0.88 ? "forearms" : "hands";
    case "leg": {
      if (p.t < 0.12) return y > 1.0 ? "abdomen" : y > 0.93 ? "waist" : "hips";
      if (p.t < 0.42) return "thighs";
      if (p.t < 0.62) return "knees";
      if (y > 0.165) return "shins";
      return y > 0.095 ? "ankles" : "feet";
    }
    default: {
      // torso
      // The neck reaches down to where any neckline might sit, so the shoulders below it can be hidden by a crew neck.
      if (y > 1.36 && radialNeck < 0.125) return "neck";
      if (y > 1.3 || Math.abs(x) > 0.12 * (y > 1.18 ? 1 : 10)) return "shoulders";
      if (y > 1.18) return "chest";
      if (y > 1.0) return "abdomen";
      // Where tops end and bottoms begin: covered by both together, neither alone, so never hidden.
      if (y > 0.93) return "waist";
      return "hips";
    }
  }
}

/** Limb parameter (0 at the shoulder/hip → 1 at wrist/ankle) for a point near that limb. */
export function limbT(kind, side, x, y, z) {
  const { ARM, LEG } = sweeps();
  const S = kind === "arm" ? ARM[side] : LEG[side];
  return S.eval(x, y, z).t;
}

/** Distance to a limb's centre-line tube and the parameter of the nearest point (cheap: no muscles). */
export function limbParam(kind, side, x, y, z) {
  const { ARM, LEG } = sweeps();
  const S = kind === "arm" ? ARM[side] : LEG[side];
  if (!S.near(x, y, z, 0.09)) return { d: 1, t: -1 };
  return S.eval(x, y, z);
}

/**
 * A smooth hull over the trunk that cloth hangs from: chest to hips without
 * the abs, navel, spine groove or the dip under the pecs. Garments inflate
 * the union of this and the body, so fabric bridges hollows instead of
 * shrink-wrapping every muscle.
 */
export function drapeD(x, y, z) {
  if (y < 0.78 || y > 1.5 || Math.abs(x) > 0.26) return 0.1;
  let d = sdEllipsoid(x, y - 1.3, z - 0.004, 0.158, 0.17, 0.112);
  d = smin(d, sdEllipsoid(x, y - 1.08, z - 0.006, 0.13, 0.17, 0.1), 0.12);
  d = smin(d, sdEllipsoid(x, y - 0.94, z + 0.004, 0.148, 0.1, 0.108), 0.1);
  return d + 0.004;
}

/** The body's parts, for garments that follow one region. */
export const PARTS = { torsoD, neckD, armD, legD, footD, handD, deltoidD };

export function bodyD(x, y, z, { hands = true, feet = true } = {}) {
  let d = torsoD(x, y, z);
  if (y > 1.3) d = smin(d, neckD(x, y, z), 0.04);
  let legs = 1;
  for (const s of SIDES) {
    const sx = sgn(s) * x;
    if (sx > 0.05 && y > 0.6) {
      // Tight blend in the armpit, soft over the deltoid.
      const kArm = 0.008 + 0.038 * sstep(1.28, 1.4, y);
      let a = armD(s, x, y, z);
      if (hands && y < 0.97) a = smin(a, handD(s, x, y, z), 0.012);
      d = smin(d, a, kArm);
    }
    if (sx > -0.04 && y < 1.1) {
      let l = legD(s, x, y, z);
      if (feet && y < 0.17) l = smin(l, footD(s, x, y, z), 0.022);
      legs = Math.min(legs, l); // no blend between the thighs
    }
  }
  // Hips into thighs: soft at the sides, tight in the crotch.
  const kLeg = (0.004 + 0.035 * sstep(0.84, 0.93, y)) * (0.3 + 0.7 * sstep(0.02, 0.09, Math.abs(x)));
  d = smin(d, legs, kLeg);
  return d;
}

/* ── head ────────────────────────────────────────────────────────────────── */

const [CX, CY, CZ] = HEAD.center;
const [RX, RY, RZ] = HEAD.radii;

/**
 * Face shapes only change the face below the cheekbones (jaw, chin, cheeks),
 * so the cranium — and everything that sits on it — is shared.
 *   jawX   how far out the jaw angle sits (half-width, m)
 *   jawY   height of the jaw angle
 *   chin   chin width factor; chinY its centre height
 *   cheek  fullness of the cheeks (lower face mass width factor)
 */
export const FACE_SHAPE = {
  oval: { jawX: 0.061, jawY: 1.565, chin: 1.0, chinY: 1.526, cheek: 1.0 },
  round: { jawX: 0.065, jawY: 1.568, chin: 1.25, chinY: 1.53, cheek: 1.1 },
  square: { jawX: 0.071, jawY: 1.554, chin: 1.53, chinY: 1.525, cheek: 1.02 },
  heart: { jawX: 0.054, jawY: 1.574, chin: 0.72, chinY: 1.523, cheek: 0.96 },
};

/** Eyeball centre and radius (left eye; mirror x for the right). */
export const EYE = { x: 0.0375, y: 1.64, z: 0.0935, r: 0.0175 };
const EAR_R = Object.fromEntries(SIDES.map((s) => [s, rotation(0, sgn(s) * 0.38, sgn(s) * -0.08)]));
export const EAR_C = Object.fromEntries(SIDES.map((s) => [s, [0.096 * sgn(s), 1.626, -0.008]]));
const LIP_U = rotation(-0.3, 0, 0);
const LIP_L = rotation(0.28, 0, 0);
/** The mouth line (neutral mouth): centre height, depth and half-width. */
export const MOUTH = { y: 1.5595, z: 0.1135, w: 0.02 };
/** The resting smile: how far the mouth line lifts at x. */
export const smileAt = (x, w = MOUTH.w) => 0.0026 * Math.min(1.2, Math.abs(x) / w) ** 2;

/**
 * Nose and mouth options. The base head is meshed with "button" / "neutral";
 * the others are baked as blendshapes (noseStraight, noseBroad, lipsFull,
 * mouthWide) by sampling these fields, so they cost no extra meshes.
 */
export const NOSE = {
  // Small and slightly upturned (the meshed default).
  button: { bridge: [[0, 1.636, 0.1205], [0, 1.6045, 0.131]], br: [0.0058, 0.0078], tip: [1.6005, 0.1302, 0.0108, 0.0094, 0.0098], wing: [0.0108, 1.5965, 0.1215, 0.0072, 0.0064, 0.007] },
  // Longer, higher bridge, tip further out and lower: reads clearly in profile.
  // (Projects ~4 mm past the button, not ~13: any further and it hangs off the stylised face.)
  straight: { bridge: [[0, 1.648, 0.1222], [0, 1.5985, 0.1388]], br: [0.0054, 0.0078], tip: [1.5965, 0.1366, 0.0104, 0.0098, 0.0102], wing: [0.0108, 1.5935, 0.1228, 0.0068, 0.0062, 0.0068] },
  // Wide, flatter bridge, big rounded tip and full wings: reads clearly from the front.
  broad: { bridge: [[0, 1.634, 0.12], [0, 1.6045, 0.132]], br: [0.0094, 0.0128], tip: [1.599, 0.1322, 0.0178, 0.0122, 0.0112], wing: [0.0188, 1.5948, 0.1192, 0.0114, 0.0088, 0.0092] },
};
export const MOUTH_SHAPE = {
  neutral: { w: 0.02, up: [0.02, 0.0052, 0.0092], lo: [0.0178, 0.0066, 0.0092], fwd: 0 },
  full: { w: 0.0206, up: [0.0209, 0.0068, 0.0104], lo: [0.0188, 0.0088, 0.0108], fwd: 0.0013 },
  wide: { w: 0.0238, up: [0.0238, 0.0052, 0.009], lo: [0.0214, 0.0064, 0.009], fwd: 0 },
};
let NOSE_SEL = NOSE.button;
let MOUTH_SEL = MOUTH_SHAPE.neutral;
/** Selects the nose / mouth variant headD evaluates (the generator bakes the others as blendshapes). */
export function setFaceDetail({ nose = "button", mouth = "neutral" } = {}) {
  NOSE_SEL = NOSE[nose];
  MOUTH_SEL = MOUTH_SHAPE[mouth];
}

export function craniumD(x, y, z) {
  return sdEllipsoid(x - CX, y - CY, z - CZ, RX, RY, RZ);
}

function lowerFaceD(x, y, z, f) {
  // Maxilla and cheeks: the mass of the face under the eyes.
  let d = sdEllipsoid(x, y - 1.594, z - 0.032, 0.078 * f.cheek, 0.066, 0.082);
  // Jaw line: from under the ear to the chin, both sides, blended at the chin (no crease at x = 0).
  const jaw = (sx) => sdCone(sx, y, z, [f.jawX, f.jawY, -0.018], [0.016 * f.chin, f.chinY + 0.002, 0.07], 0.021, 0.017);
  d = smin(d, smin(jaw(x), jaw(-x), 0.02), 0.03);
  // Chin.
  d = smin(d, sdEllipsoid(x, y - f.chinY, z - 0.073, 0.021 * f.chin, 0.019, 0.02), 0.018);
  return d;
}

function earD(s, x, y, z) {
  const l = toLocal(EAR_R[s], EAR_C[s], x, y, z);
  const ex = sgn(s) * l[0];
  if (Math.abs(ex) > 0.05 || Math.abs(l[1]) > 0.06 || Math.abs(l[2]) > 0.05) return 1;
  let d = sdEllipsoid(ex - 0.006, l[1], l[2], 0.011, 0.029, 0.02);
  d = smin(d, sdEllipsoid(ex - 0.006, l[1] + 0.023, l[2] - 0.002, 0.0078, 0.0092, 0.0092), 0.004); // lobe
  const cavity = sdEllipsoid(ex - 0.015, l[1] + 0.002, l[2] + 0.003, 0.0074, 0.019, 0.0122);
  d = smax(d, -cavity, 0.0025);
  d = smin(d, sdEllipsoid(ex - 0.009, l[1] - 0.004, l[2] + 0.002, 0.0042, 0.0088, 0.0052), 0.003); // antihelix
  return d;
}

/** The skull's outer form for one face shape, without ears, eyes, nose or mouth. */
export function skullD(shape, x, y, z) {
  const f = FACE_SHAPE[shape];
  let d = craniumD(x, y, z);
  d = smin(d, lowerFaceD(x, y, z, f), 0.045);
  // Temples flatten a little; the back of the skull drops into the nape.
  d = smin(d, sdEllipsoid(x, y - 1.58, z + 0.04, 0.065, 0.06, 0.06), 0.04);
  if (z < 0.03 && y < 1.62) d = smin(d, sdEllipsoid(x, y - 1.565, z + 0.026, 0.05, 0.034, 0.028), 0.02);
  return d;
}

/** The outermost skull over every face shape — what hair and hats are fitted to. */
export function scalpUnionD(x, y, z) {
  if (Math.abs(x) > 0.2 || y < 1.4 || y > 1.9 || z < -0.2 || z > 0.22) return 0.1;
  let d = Infinity;
  for (const s of Object.keys(FACE_SHAPE)) d = Math.min(d, skullD(s, x, y, z));
  return d;
}

/** The skin of the head for one face shape (everything above the jaw/neck crease). */
export function headD(shape, x, y, z) {
  const ax = Math.abs(x);
  if (ax > 0.16 || y < 1.45 || y > 1.82 || z < -0.15 || z > 0.19) return 0.08;
  let d = skullD(shape, x, y, z);

  // Brow ridge and cheekbones (soft — this is a friendly face).
  d = smin(d, sdEllipsoid(ax - 0.034, y - 1.671, z - 0.097, 0.027, 0.0105, 0.018), 0.014);
  d = smin(d, sdEllipsoid(ax - 0.053, y - 1.612, z - 0.07, 0.028, 0.018, 0.03), 0.026);

  // Eye sockets: a soft bowl the eyeball and the lid meshes sit in.
  const ex = ax - EYE.x, ey = y - EYE.y;
  if (Math.abs(ex) < 0.045 && Math.abs(ey) < 0.035 && z > 0.06) {
    const socket = sdEllipsoid(ex - 0.001, ey + 0.0008, z - (EYE.z + 0.006), 0.0214, 0.0158, 0.0155);
    d = smax(d, -socket, 0.006);
    // A bed for the eyeball so no skin pokes through it.
    d = smax(d, -(Math.hypot(ex, ey, z - EYE.z) - (EYE.r + 0.0007)), 0.002);
  }

  // Nose: bridge, a rounded tip and soft wings.
  // (The box is wide enough for the broadest nose's wings and the straight nose's bridge plus
  // their blend, so no variant is clipped by it — a clipped field leaves a ridge in the morph.)
  if (ax < 0.052 && y > 1.562 && y < 1.672 && z > 0.088) {
    const N = NOSE_SEL;
    let n = sdCone(x, y, z, N.bridge[0], N.bridge[1], N.br[0], N.br[1]);
    n = smin(n, sdEllipsoid(x, y - N.tip[0], z - N.tip[1], N.tip[2], N.tip[3], N.tip[4]), 0.008);
    n = smin(n, sdEllipsoid(ax - N.wing[0], y - N.wing[1], z - N.wing[2], N.wing[3], N.wing[4], N.wing[5]), 0.007);
    n = smax(n, -sdEllipsoid(ax - (N.wing[0] - 0.0046), y - (N.wing[1] - 0.004), z - (N.wing[2] + 0.004), 0.0026, 0.0016, 0.0032), 0.0012); // nostrils
    d = smin(d, n, 0.009);
  }

  // Lips with a slight smile, parted by a real slit into a mouth cavity (so jawOpen can open it).
  if (ax < 0.045 && y > 1.525 && y < 1.585 && z > 0.07) {
    const M = MOUTH_SEL;
    const sm = smileAt(x, M.w);
    const u = toLocal(LIP_U, [0, MOUTH.y + 0.0056 + sm, MOUTH.z - 0.0016 + M.fwd], x, y, z);
    const l = toLocal(LIP_L, [0, MOUTH.y - 0.0056 - (M.lo[1] - 0.0066) * 0.6 + sm * 0.6, MOUTH.z - 0.0034 + M.fwd], x, y, z);
    const lips = smin(sdEllipsoid(u[0], u[1], u[2], M.up[0], M.up[1], M.up[2]), sdEllipsoid(l[0], l[1], l[2], M.lo[0], M.lo[1], M.lo[2]), 0.005);
    d = smin(d, lips, 0.007);
    // The slit between the lips, and the mouth's inside behind it.
    const slit = sdEllipsoid(x, y - (MOUTH.y + sm), z - (MOUTH.z - 0.004), M.w * 0.98, 0.0011 * (1 - 0.5 * (ax / M.w) ** 2), 0.014);
    const inside = sdEllipsoid(x, y - (MOUTH.y - 0.003), z - (MOUTH.z - 0.021), 0.018, 0.0095, 0.011);
    d = smax(d, -smin(slit, inside, 0.003), 0.0012);
    d = smax(d, -sdEllipsoid(ax - M.w, y - (MOUTH.y + 0.0028), z - (MOUTH.z - 0.007), 0.0032, 0.003, 0.0038), 0.003); // corners
  }

  // Ears.
  for (const s of SIDES) if (sgn(s) * x > 0.068 && y > 1.57 && y < 1.69 && z < 0.045) d = smin(d, earD(s, x, y, z), 0.006);
  return d;
}

/* ── skin tint (multiplied with the user's skin colour at runtime) ───────── */

/** Where the body mesh stops and the head's own neck takes over. */
export const NECK_CUT = 1.5;

/**
 * The head's skin for one face shape, merged smoothly into the top of the
 * neck (under the jaw and at the nape). Below NECK_CUT its neck sits just
 * inside the body's, so the body shows there.
 */
export function headSkinD(face, x, y, z) {
  const h = headD(face, x, y, z);
  if (y > 1.62) return h;
  const n = neckD(x, y, z) + 0.0012 * sstep(NECK_CUT + 0.004, NECK_CUT - 0.022, y);
  const k = 0.022;
  const hh = Math.max(k - Math.abs(h - n), 0) / k;
  return Math.min(h, n) - hh * hh * k * 0.25;
}

export function headTint(x, y, z) {
  const ax = Math.abs(x);
  const front = sstep(0.08, 0.11, z);
  const lips = front * gauss(y, MOUTH.y, 0.0085) * gauss(x, 0, 0.021);
  const cheeks = gauss(ax, 0.052, 0.02) * gauss(y, 1.588, 0.018) * sstep(0.06, 0.09, z) * 0.55;
  const nose = gauss(x, 0, 0.012) * gauss(y, 1.588, 0.01) * sstep(0.11, 0.125, z) * 0.35;
  const ears = sstep(0.078, 0.093, ax) * gauss(y, 1.622, 0.03) * sstep(0.04, -0.01, z) * 0.35;
  const red = lips + cheeks + nose + ears;
  // Inside the mouth: dark and red, so an open mouth reads as a mouth.
  const inside = sstep(MOUTH.z - 0.004, MOUTH.z - 0.009, z) * gauss(x, 0, 0.022) * gauss(y, MOUTH.y - 0.002, 0.014);
  return [(1 - 0.02 * red) * (1 - 0.62 * inside), (1 - 0.16 * red) * (1 - 0.86 * inside), (1 - 0.15 * red) * (1 - 0.84 * inside)];
}

export function bodyTint(x, y, z) {
  const ax = Math.abs(x);
  // Knuckles, elbows, knees and the tops of the shoulders warm up a little.
  let red = 0;
  for (const s of SIDES) {
    const E = REST[B("ForeArm", s)], K = REST[B("Leg", s)], Hd = REST[B("Hand", s)];
    red += 0.5 * Math.exp(-((x - E[0]) ** 2 + (y - E[1]) ** 2 + (z - E[2] + 0.04) ** 2) / 0.0012);
    red += 0.5 * Math.exp(-((x - K[0]) ** 2 + (y - K[1]) ** 2 + (z - K[2] - 0.05) ** 2) / 0.0015);
    red += 0.5 * Math.exp(-((x - Hd[0]) ** 2 + (y - Hd[1] + 0.09) ** 2 + (z - Hd[2]) ** 2) / 0.003);
  }
  red += 0.25 * gauss(ax, 0.19, 0.05) * gauss(y, 1.42, 0.03);
  red = Math.min(1, red);
  return [1 - 0.02 * red, 1 - 0.1 * red, 1 - 0.1 * red];
}

/** Front surface z of the (oval) face at (x, y), found by ray marching — for decals and eyewear. */
export function faceSurfaceZ(x, y, shape = "oval") {
  let z = 0.22;
  for (let i = 0; i < 160; i++) {
    const d = headD(shape, x, y, z);
    if (d < 0.0002) break;
    z -= Math.max(d * 0.8, 0.0002);
  }
  return z;
}

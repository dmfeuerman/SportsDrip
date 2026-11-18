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

/**
 * Body frame, 0 (masculine) … 1 (feminine). Like BUILD, the generator meshes
 * at 0 and samples the field at 1 to bake the `frameFem` blendshape:
 * narrower shoulders and ribs, a higher waist pinch, fuller chest, wider
 * hips, slimmer neck and limbs.
 */
let FRAME = 0;
export function setFrame(f) {
  FRAME = f;
}
export const getFrame = () => FRAME;
const fk = (k) => 1 + k * FRAME;
/**
 * Feminine hips: built round and full (the original feminine pelvis, hip and
 * thigh tops), then the torso and legs narrowed together by this smooth
 * horizontal scale — so the hip stays one soft curve from waist to thigh
 * instead of separate bumps. Fraction by which x is scaled in, by height.
 */
export const hipIn = (y) =>
  0.085 * gauss(y, 0.94, 0.13) + 0.045 * gauss(y, 0.76, 0.11);

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
  let v = SWEEPS.get(`${BUILD}|${FRAME}`);
  if (!v) {
    v = {
      ARM: Object.fromEntries(SIDES.map((s) => [s, limbSweep(arm(s, BUILD, FRAME), 64)])),
      LEG: Object.fromEntries(SIDES.map((s) => [s, limbSweep(leg(s, BUILD, FRAME), 72)])),
      MUSCLES: Object.fromEntries(SIDES.map((s) => [s, limbMuscles(s, BUILD, FRAME)])),
    };
    SWEEPS.set(`${BUILD}|${FRAME}`, v);
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
function limbMuscles(side, build, frame = 0) {
  const A = arm(side, build, frame);
  const L = leg(side, build, frame);
  const tE = A.tJoint;
  const tK = L.tJoint;
  // Athletic volume on the masculine frame; the feminine frame keeps smooth, toned limbs.
  const masc = 1 - frame;
  const m = (1 + 0.15 * build) * (1 - 0.24 * frame) * (0.94 + 0.1 * masc);
  const out = [];
  const axisRot = (sampler, t) => {
    const tan = sampler(t).tan;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().negate());
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    return rotation(e.x, e.y, e.z);
  };
  const r = (a, b, c) => [a * m, b, c * m];
  const armK = 0.016 + 0.024 * frame;
  // biceps (front), triceps (back), forearm (outer/front)
  out.push({ c: onLimb(A, tE * 0.52, 0.0135 * masc * (1 + 0.15 * build), 0), r: r(0.041, 0.074, 0.037), R: axisRot(A, tE * 0.52), k: armK });
  out.push({ c: onLimb(A, tE * 0.44, -0.0145 * masc * (1 + 0.15 * build), 0.004 * masc), r: r(0.043, 0.08, 0.038), R: axisRot(A, tE * 0.44), k: armK });
  out.push({ c: onLimb(A, tE + (1 - tE) * 0.26, 0.007 * masc, 0.0085 * masc), r: r(0.037, 0.072, 0.033), R: axisRot(A, tE + (1 - tE) * 0.26), k: armK });
  // quads (front), hamstrings (back), calf (back), knee cap
  out.push({ c: onLimb(L, tK * 0.52, 0.017 * m, 0.005 * masc), r: r(0.062, 0.132, 0.05), R: axisRot(L, tK * 0.52), k: 0.034 + 0.014 * frame });
  out.push({ c: onLimb(L, tK * 0.5, -0.013 * m, 0), r: r(0.06, 0.13, 0.047), R: axisRot(L, tK * 0.5), k: 0.04 });
  out.push({ c: onLimb(L, tK + (1 - tK) * 0.28, -0.016 * m, 0.003 * masc), r: r(0.047, 0.096, 0.043), R: axisRot(L, tK + (1 - tK) * 0.28), k: 0.032 + 0.01 * frame });
  out.push({ c: onLimb(L, tK - 0.012, 0.035, 0), r: [0.028, 0.03, 0.018], R: axisRot(L, tK), k: 0.03 });
  return out;
}
const muscleD = (m, x, y, z) => {
  const l = toLocal(m.R, m.c, x, y, z);
  return sdEllipsoid(l[0], l[1], l[2], m.r[0], m.r[1], m.r[2]);
};

function armD(s, x, y, z) {
  const { ARM, MUSCLES } = sweeps();
  if (!ARM[s].near(x, y, z, 0.08)) return 1;
  let d = ARM[s].eval(x, y, z).d;
  if (FRAME < 0.99) {
    const [bi, tri, fore] = MUSCLES[s];
    const m = smin(smin(d, muscleD(bi, x, y, z), bi.k), muscleD(tri, x, y, z), tri.k);
    const m2 = smin(m, muscleD(fore, x, y, z), fore.k);
    d = d + (m2 - d) * (1 - FRAME);
  }
  return d;
}

function legD(s, x, y, z) {
  if (FRAME) x *= 1 + FRAME * hipIn(y);
  const { LEG, MUSCLES } = sweeps();
  if (!LEG[s].near(x, y, z, 0.08)) return 1;
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
  const k = bk(0.12) * fk(-0.22) * (1 + 0.14 * (1 - FRAME));
  const l = toLocal(DELT_R[s], [(0.184 + 0.006 * BUILD - 0.024 * FRAME) * sgn(s), 1.367 - 0.02 * FRAME, -0.008], x, y, z);
  return sdEllipsoid(l[0], l[1], l[2], 0.0378 * k, 0.071 * bk(0.05) * fk(-0.18), 0.0432 * k);
}

/** The feminine frame's horizontal scale-in of the torso by height (x is multiplied by it): smooth athletic waist plus hipIn. */
export const femTorsoIn = (y) => 1 + 0.095 * gauss(y, 1.13, 0.095) + hipIn(y);

function torsoD(x, y, z) {
  if (y < 0.72 || y > 1.72 || Math.abs(x) > 0.38) return Math.max(0.09, Math.abs(y - 1.2) - 0.52);
  const x0 = x, ax0 = Math.abs(x);
  if (FRAME) x *= 1 + FRAME * (femTorsoIn(y) - 1);
  const ax = Math.abs(x);
  const w = bk(0.085) * fk(-0.14), dp = bk(0.07) * fk(-0.04);
  // Rib cage and upper chest give the V; the abdomen pinches the waist in.
  let d = sdEllipsoid(x, y - 1.268, z - 0.004, 0.136 * w, 0.158, 0.1 * dp);
  // Upper chest: broader on the masculine frame, sleek on the feminine frame.
  d = smin(d, sdEllipsoid(x, y - 1.345, z - 0.0, 0.148 * bk(0.1) * fk(-0.271), 0.066, 0.089 * dp), 0.05 + 0.02 * FRAME);
  const side = x >= 0 ? "L" : "R";
  const masc = 1 - FRAME;
  {
    const pk = bk(0.16) * fk(0.16);
    const l = toLocal(PEC_R[side], [0.062 * sgn(side) * w, 1.322 - 0.016 * FRAME, (0.05 + 0.012 * FRAME) * dp], x, y, z);
    // Fuller, sculpted masculine pecs with a crisp lower edge; smooth athletic bust on the feminine frame.
    d = smin(d, sdEllipsoid(l[0], l[1], l[2], 0.069 * pk * fk(-0.1) * (1 + 0.07 * masc), 0.051 * pk * fk(0.08) * (1 + 0.06 * masc), 0.042 * pk * fk(0.45) * (1 + 0.24 * masc)), 0.026 - 0.008 * masc);
  }
  d = smin(d, sdEllipsoid(ax - 0.094 * w, y - 1.24, z + 0.018, 0.056 * bk(0.16) * fk(-0.4) * (1 + 0.18 * masc), 0.13, 0.068), 0.044); // lats
  d = smin(d, sdEllipsoid(x, y - 1.1, z - 0.01, 0.121 * bk(0.11) * fk(-0.36) * (1 - 0.055 * masc), 0.13, 0.09 * bk(0.13) * fk(-0.16)), 0.075); // abdomen
  d = smin(d, sdEllipsoid(x, y - 0.95, z + 0.002, (0.124 + 0.032 * FRAME) * bk(0.07), 0.1 - 0.004 * FRAME, 0.1 * bk(0.07)), 0.1 + 0.02 * FRAME); // pelvis
  d = smin(d, sdEllipsoid(ax - 0.062 * bk(0.05), y - 0.918, z + 0.046 * bk(0.08), 0.072 * bk(0.08) * fk(0.1), 0.078, 0.064 * bk(0.08) * fk(0.16)), 0.04 + 0.02 * FRAME); // glutes
  d = smin(d, sdEllipsoid(ax - ((0.092 + 0.02 * FRAME) * bk(0.06) + 0.011 * FRAME), y - (0.935 + 0.005 * FRAME), z + 0.004, 0.04 + 0.022 * FRAME, 0.075 - 0.005 * FRAME, 0.066 + 0.004 * FRAME), 0.05 + 0.025 * FRAME); // hip flare
  d = smin(d, sdCone(ax, y, z, [0.03, 1.462 + 0.004 * BUILD - 0.016 * FRAME, -0.026], [(0.168 - 0.033 * FRAME) * bk(0.04), 1.41 - 0.004 * FRAME, -0.02], 0.033 * bk(0.18) * fk(-0.25), 0.033 * bk(0.12) * fk(-0.25)), 0.042);
  d = smin(d, deltoidD(side, x, y, z), 0.052);

  // Surface muscle definition (inward is positive).
  const front = sstep(0.0, 0.05, z);
  const back = sstep(0.0, -0.05, z);
  let dent = 0;
  // Linea alba (center vertical abdominal groove: defined on masculine, soft athletic line on feminine).
  dent += (0.0028 * masc + 0.0007 * FRAME) * front * gauss(x0, 0, 0.01) * sstep(0.99, 1.04, y) * sstep(1.28, 1.21, y);
  // Horizontal tendinous intersections (3 abdominal rows).
  const abRows = gauss(y, 1.202, 0.0085) + gauss(y, 1.144, 0.0085) + gauss(y, 1.086, 0.0085);
  dent += 0.0022 * masc * front * gauss(ax0, 0.034, 0.026) * abRows * sstep(0.04, 0.07, z);
  // Sculpted 6-pack rectus abdominis pads (outward muscle bellies between the tendinous intersections).
  const abPads = 0.85 * gauss(y, 1.23, 0.018) + 1.0 * gauss(y, 1.173, 0.019) + 0.95 * gauss(y, 1.115, 0.019) + 0.55 * gauss(y, 1.052, 0.022);
  dent -= 0.0024 * masc * front * gauss(ax0, 0.028, 0.015) * abPads * sstep(0.04, 0.075, z);
  // Linea semilunaris (outer border of the rectus abdominis framing the abs).
  dent += (0.0018 * masc + 0.0006 * FRAME) * front * gauss(ax0, 0.06 - 0.008 * FRAME, 0.011) * sstep(1.01, 1.06, y) * sstep(1.26, 1.2, y);
  // Iliac / external oblique V-taper crease.
  dent += 0.0016 * masc * front * gauss(y - (0.965 + 1.15 * (ax0 - 0.045)), 0, 0.012) * sstep(0.035, 0.058, ax0) * sstep(0.115, 0.09, ax0);
  // Navel.
  dent += 0.0038 * front * gauss(x0, 0, 0.007) * gauss(y, 1.025, 0.007);
  // Under-pec crease and central sternal groove.
  dent += (0.0016 + 0.0018 * masc) * front * gauss(y, 1.268, 0.015) * gauss(ax0, 0.068, 0.044);
  dent += 0.0022 * masc * front * gauss(x0, 0, 0.012) * sstep(1.23, 1.27, y) * sstep(1.39, 1.33, y);
  // Deltopectoral groove separating outer pec from anterior deltoid.
  dent += 0.0016 * masc * front * gauss(ax0 - (0.106 + 0.42 * (y - 1.3)), 0, 0.011) * sstep(1.28, 1.31, y) * sstep(1.4, 1.37, y);
  // Serratus / lateral rib definition.
  dent += 0.0011 * masc * sstep(-0.01, 0.05, z) * gauss(ax0, 0.098, 0.018) * (gauss(y - 0.25 * ax0, 1.195, 0.008) + gauss(y - 0.25 * ax0, 1.165, 0.008));
  // Spine groove, collarbones, and jugular notch.
  dent += 0.0026 * back * gauss(x0, 0, 0.018) * sstep(0.98, 1.06, y) * sstep(1.42, 1.34, y);
  dent -= 0.0017 * front * gauss(y, 1.418, 0.009) * gauss(ax0, 0.07, 0.04);
  dent += 0.0032 * front * gauss(x0, 0, 0.012) * gauss(y, 1.43, 0.012);
  return d + dent;
}

/** Neck: a column from the trapezius up inside the head, with the jaw crease done by the head mesh. */
function neckD(x, y, z) {
  if (y < 1.33 || y > 1.7 || Math.abs(x) > 0.12) return 1;
  const k = bk(0.08) * fk(-0.24);
  let d = sdCone(x, y, z, [0, 1.38, -0.018], [0, 1.62, -0.004], 0.057 * k, 0.048 * bk(0.05) * fk(-0.2));
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
 * phalanx lengths, radius, splay (rad), curl (rad)]. Clean separation and
 * natural relaxed arc so adjacent fingers never collapse into each other.
 */
const FINGERS = [
  [0.0315, 0.042, 0.026, 0.02, 0.0096, 0.045, 0.22],
  [0.0105, 0.045, 0.028, 0.021, 0.01, 0.0, 0.26],
  [-0.0105, 0.043, 0.027, 0.02, 0.0095, -0.028, 0.31],
  [-0.0305, 0.035, 0.022, 0.017, 0.0088, -0.065, 0.36],
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
  // Natural relaxed curl through three phalanges.
  for (const [w, l1, l2, l3, r, splay, curl] of FINGERS) {
    const k0 = [0.09, w, 0.0];
    const sx = Math.sin(splay);
    const seg = (p, l, th) => [p[0] + l * Math.cos(th), p[1] + l * sx, p[2] + l * Math.sin(th)];
    const k1 = seg(k0, l1, curl);
    const k2 = seg(k1, l2, curl * 1.9);
    const k3 = seg(k2, l3, curl * 2.5);
    const f = Math.min(sdCone(a, b, c, k0, k1, r, r * 0.94), sdCone(a, b, c, k1, k2, r * 0.94, r * 0.87), sdCone(a, b, c, k2, k3, r * 0.87, r * 0.76));
    d = smin(d, f, 0.0026);
  }
  const t0 = [0.022, 0.038, 0.006];
  const t1 = [0.052, 0.063, 0.025];
  const t2 = [0.077, 0.07, 0.042];
  d = smin(d, Math.min(sdCone(a, b, c, t0, t1, 0.0145, 0.012), sdCone(a, b, c, t1, t2, 0.0118, 0.01)), 0.01);
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
      if (y < 1.0 && Math.abs(x) > 0.25) return "hands";
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
      if (y > 0.945) return "waist";
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
      // Smooth blend in the armpit (slightly wider on feminine frame), soft over the deltoid.
      const kArm = 0.01 + 0.008 * FRAME + 0.04 * sstep(1.26, 1.4, y);
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
  const kLeg = (0.004 + 0.05 * sstep(0.8, 0.93, y)) * (0.3 + 0.7 * sstep(0.02, 0.09, Math.abs(x)));
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
 *   chin   chin width factor; chinY its centre height; chinZ its forward projection
 *   cheek  fullness of the cheeks (lower face mass width factor)
 *   jawR   jawline cone radius at the gonion
 */
export const FACE_SHAPE = {
  oval: { jawX: 0.06, jawY: 1.563, chin: 1.0, chinY: 1.524, chinZ: 0.088, cheek: 1.0, jawR: 0.0195 },
  round: { jawX: 0.068, jawY: 1.566, chin: 1.32, chinY: 1.529, chinZ: 0.086, cheek: 1.15, jawR: 0.023 },
  square: { jawX: 0.075, jawY: 1.547, chin: 1.68, chinY: 1.521, chinZ: 0.091, cheek: 1.05, jawR: 0.0235 },
  heart: { jawX: 0.05, jawY: 1.576, chin: 0.6, chinY: 1.518, chinZ: 0.089, cheek: 1.06, jawR: 0.0165 },
};

/** Eyeball centre and radius (left eye; mirror x for the right). */
export const EYE = { x: 0.0375, y: 1.64, z: 0.0922, r: 0.0175 };
/** How much larger the eyes (balls, lids, lashes) are on the feminine frame, about each eye's centre. */
export const EYE_FEM_SCALE = 1.12;
const EAR_R = Object.fromEntries(SIDES.map((s) => [s, rotation(0, sgn(s) * 0.38, sgn(s) * -0.08)]));
export const EAR_C = Object.fromEntries(SIDES.map((s) => [s, [0.096 * sgn(s), 1.626, -0.008]]));
const LIP_U = rotation(-0.3, 0, 0);
const LIP_L = rotation(0.28, 0, 0);
/** The mouth line (neutral mouth): centre height, depth and half-width. */
export const MOUTH = { y: 1.5595, z: 0.1085, w: 0.02 };
/** The resting smile: how far the mouth line lifts at x. */
export const smileAt = (x, w = MOUTH.w) => 0.0012 * Math.min(1.2, Math.abs(x) / w) ** 2;

/**
 * Nose and mouth options. Each head (face shape × nose shape) is meshed
 * directly so straight and broad noses have clean topology and distinct silhouettes.
 */
export const NOSE = {
  // Compact and slightly upturned (the default).
  button: { bridge: [[0, 1.636, 0.1185], [0, 1.606, 0.1275]], br: [0.0068, 0.0088], tip: [1.6025, 0.1272, 0.0102, 0.009, 0.0095], wing: [0.0108, 1.5975, 0.1185, 0.0072, 0.0065, 0.007] },
  // Longer, higher dorsum, tip further forward and lower: strong profile and longer bridge.
  straight: { bridge: [[0, 1.649, 0.122], [0, 1.595, 0.138]], br: [0.0056, 0.0078], tip: [1.593, 0.1362, 0.0098, 0.0096, 0.011], wing: [0.011, 1.592, 0.1208, 0.0068, 0.0064, 0.0072] },
  // Wider bridge, fuller rounded bulb tip and wider flared wings: clearly broader from the front.
  broad: { bridge: [[0, 1.635, 0.118], [0, 1.603, 0.1295]], br: [0.0096, 0.0136], tip: [1.5975, 0.13, 0.0184, 0.0124, 0.0114], wing: [0.0202, 1.594, 0.1168, 0.0122, 0.0092, 0.0095] },
};
/** Lip ellipsoids (half-width, height, depth). Fuller than the first v3 lips across the board, so lipsFull stays the fullest. */
export const MOUTH_SHAPE = {
  neutral: { w: 0.02, up: [0.0206, 0.0063, 0.0086], lo: [0.0188, 0.0078, 0.009], fwd: 0.0 },
  full: { w: 0.0208, up: [0.0213, 0.0074, 0.0086], lo: [0.0196, 0.0094, 0.0092], fwd: 0.0011 },
  wide: { w: 0.0238, up: [0.0242, 0.0056, 0.0072], lo: [0.0222, 0.007, 0.0074], fwd: 0.0 },
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
  // Around the high temple/ear rim (where banded headwear seats), all face shapes converge to the shared cranium width.
  const earZone = sstep(1.56, 1.595, y) * sstep(0.05, 0.005, z);
  const cheek = f.cheek + (1 - f.cheek) * earZone;
  const jawX = (f.jawX + (0.061 - f.jawX) * earZone) * fk(-0.1), chin = f.chin * fk(-0.16), chinY = f.chinY + 0.004 * FRAME;
  const chinZ = (f.chinZ ?? 0.086) - 0.002 * FRAME;
  const jawR = (f.jawR ?? 0.02) * fk(-0.12);
  let d = sdEllipsoid(x, y - 1.592, z - 0.03, 0.077 * cheek * fk(0.02), 0.067, 0.08);
  // Jaw line: from the gonion under the ear forward to the chin, with a smooth rounded mandible.
  const jaw = (sx) => sdCone(sx, y, z, [jawX, f.jawY + 0.004 * FRAME, -0.014], [0.018 * chin, chinY + 0.001, chinZ - 0.006], jawR, 0.0175 * fk(-0.14));
  d = smin(d, smin(jaw(x), jaw(-x), 0.022), 0.036 + 0.006 * FRAME);
  // Chin: soft rounded projection aligned cleanly with the lower lip.
  d = smin(d, sdEllipsoid(x, y - chinY, z - chinZ, 0.024 * chin * fk(-0.08), 0.02 * fk(-0.08), 0.023 * fk(-0.06)), 0.026);
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
  d = smin(d, sdEllipsoid(x, y - 1.695, z - 0.05, 0.081, 0.055, 0.06), 0.03);
  d = smin(d, sdEllipsoid(x, y - 1.664, z + 0.026, 0.086, 0.088, 0.088), 0.02);
  d = smin(d, lowerFaceD(x, y, z, f), 0.042);
  d = smin(d, sdEllipsoid(x, y - 1.578, z + 0.03, 0.06, 0.05, 0.05), 0.035);
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
  const f = FACE_SHAPE[shape];
  let d = skullD(shape, x, y, z);

  // Brow ridge: one broad, smooth mass over both eyes.
  d = smin(d, sdEllipsoid(ax - 0.03, y - 1.6705, z - 0.0965, 0.035, 0.0125, 0.0155), 0.026);
  // Glabella: fills between the brows so the forehead runs straight down into the nose bridge.
  d = smin(d, sdEllipsoid(x, y - 1.656, z - 0.1035, 0.013, 0.016, 0.009), 0.012);
  // Cheekbones: soft, full zygomatic contour blended smoothly into the lower cheeks.
  const zCheek = 1 + (f.cheek - 1) * 0.45 * sstep(0.01, 0.05, z);
  d = smin(d, sdEllipsoid(ax - 0.048 * zCheek, y - 1.602, z - 0.07, 0.032 * zCheek, 0.025, 0.036), 0.045);

  // Eye sockets: a soft bowl the eyeball and the lid meshes sit in.
  const ex = ax - EYE.x, ey = y - EYE.y;
  if (Math.abs(ex) < 0.045 && Math.abs(ey) < 0.035 && z > 0.06) {
    const es = 1 + (EYE_FEM_SCALE - 1) * FRAME;
    const socket = sdEllipsoid(ex + 0.0006 * es, ey + 0.0008 * es, z - (EYE.z + 0.0068 * es), 0.0222 * es, 0.0158 * es, 0.0163 * es);
    d = smax(d, -socket, 0.008);
    d = smax(d, -sdEllipsoid(ex + 0.0125 * es, ey + 0.0004, z - (EYE.z + 0.0125), 0.0075 * es, 0.0082 * es, 0.0115), 0.004);
    d = smax(d, -(Math.hypot(ex, ey, z - EYE.z) - (EYE.r * es + 0.0007)), 0.002);
  }

  // Nose: bridge, a rounded tip and soft wings.
  if (ax < 0.052 && y > 1.562 && y < 1.672 && z > 0.088) {
    const N = NOSE_SEL;
    const ns = fk(-0.14), nw = fk(-0.12);
    let n = sdCone(x, y, z, N.bridge[0], N.bridge[1], N.br[0] * ns, N.br[1] * ns);
    n = smin(n, sdEllipsoid(x, y - N.tip[0], z - N.tip[1] + 0.0015 * FRAME, N.tip[2] * ns, N.tip[3] * ns, N.tip[4] * ns), 0.008);
    n = smin(n, sdEllipsoid(ax - N.wing[0] * nw, y - N.wing[1], z - N.wing[2], N.wing[3] * nw, N.wing[4] * nw, N.wing[5] * nw), 0.007);
    const sw = (N.bridge[0][2] + N.bridge[1][2]) / 2 - 0.0085;
    n = smin(n, sdEllipsoid(x, y - (N.bridge[1][1] + 0.006), z - sw, (N.br[1] + 0.0058) * ns, 0.019, 0.0085), 0.008);
    n += 0.0007 * gauss(ax, N.wing[0] * nw + N.wing[3] * nw * 0.8, 0.0018) * gauss(y, N.wing[1] + 0.001, 0.0045);
    n = smax(n, -sdEllipsoid(ax - (N.wing[0] - 0.0046), y - (N.wing[1] - 0.0042), z - (N.wing[2] + 0.004), 0.0028, 0.0017, 0.0034), 0.0012); // nostrils
    d = smin(d, n, 0.014);
  }

  // Lips with a slight smile, parted by a soft slit into a mouth cavity (so jawOpen can open it).
  if (ax < 0.045 && y > 1.525 && y < 1.585 && z > 0.07) {
    const M = MOUTH_SEL;
    const sm = smileAt(x, M.w);
    const u = toLocal(LIP_U, [0, MOUTH.y + 0.0056 + sm, MOUTH.z - 0.0016 + M.fwd], x, y, z);
    const l = toLocal(LIP_L, [0, MOUTH.y - 0.0056 - (M.lo[1] - 0.0066) * 0.6 + sm * 0.6, MOUTH.z - 0.0034 + M.fwd], x, y, z);
    const lv = fk(0.22), lz = fk(0.1);
    let lips = smin(sdEllipsoid(u[0], u[1], u[2], M.up[0], M.up[1] * lv, M.up[2] * lz), sdEllipsoid(l[0], l[1], l[2], M.lo[0], M.lo[1] * lv, M.lo[2] * lz), 0.005);
    const outer = sstep(0.45, 1.05, ax / M.w);
    lips += 0.0026 * outer;
    const below = sstep(MOUTH.y - 0.002, MOUTH.y - 0.009, y);
    d = smin(d, lips, 0.006 + 0.0075 * outer + 0.0025 * below);
    const slit = sdEllipsoid(x, y - (MOUTH.y + sm), z - (MOUTH.z - 0.004), M.w * 0.9, 0.0006 * (1 - 0.5 * (ax / M.w) ** 2), 0.013);
    const inside = sdEllipsoid(x, y - (MOUTH.y - 0.003), z - (MOUTH.z - 0.021), 0.018, 0.0095, 0.011);
    d = smax(d, -smin(slit, inside, 0.003), 0.0014);
  }
  // Soft mentolabial contour between lower lip and chin.
  if (ax < 0.032 && y > 1.528 && y < 1.552 && z > 0.085) {
    d += 0.0006 * gauss(x, 0, 0.016) * gauss(y, 1.541, 0.0045) * sstep(0.085, 0.1, z);
  }
  // Philtrum: a shallow groove from under the nose to the upper lip's peak.
  if (ax < 0.012 && y > 1.565 && y < 1.6 && z > 0.09) d += 0.0006 * gauss(x, 0, 0.0035) * gauss(y, 1.5785, 0.006) * sstep(0.09, 0.1, z);

  // Ears.
  for (const s of SIDES) if (sgn(s) * x > 0.068 && y > 1.57 && y < 1.69 && z < 0.045) d = smin(d, earD(s, x, y, z), 0.006);
  return d;
}

/* ── skin tint (multiplied with the user's skin colour at runtime) ───────── */

/** Where stubble fades out down the neck. */
export const NECK_CUT = 1.5;
/**
 * Where the body mesh ends and every head mesh begins: one shared ring of
 * vertices round the neck (generate.mjs neckRing), so the two meet edge to
 * edge with identical positions, normals, shading, weights and blendshapes.
 */
export const NECK_SEAM = 1.47;

/**
 * The head's skin for one face shape, merged smoothly into the top of the
 * neck (under the jaw and at the nape), and becoming the body's own surface
 * by the seam, so the head's lower edge lies exactly on the body's.
 */
export function headSkinD(face, x, y, z) {
  const h = headD(face, x, y, z);
  if (y > 1.62) return h;
  const n = neckD(x, y, z);
  const k = 0.022;
  const hh = Math.max(k - Math.abs(h - n), 0) / k;
  const d = Math.min(h, n) - hh * hh * k * 0.25;
  if (y >= 1.505) return d;
  const b = bodyD(x, y, z, { hands: false, feet: false });
  return b + (d - b) * sstep(NECK_SEAM, 1.505, y);
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

/** How much a point on the body matters to the simplifier (generate.mjs buildBody): hands and toes 1.0, chest/abs 0.55, smooth limb shafts 0.22. */
export function bodyImportance(x, y, z) {
  const ax = Math.abs(x);
  const hands = sstep(0.24, 0.29, ax) * sstep(0.98, 0.91, y) * sstep(0.68, 0.74, y);
  const toes = sstep(0.09, 0.04, y) * sstep(0.05, 0.11, z);
  const torsoFront = 0.55 * sstep(-0.01, 0.04, z) * sstep(0.95, 1.02, y) * sstep(1.45, 1.38, y) * sstep(0.16, 0.11, ax);
  return 0.22 + 0.78 * Math.max(hands, toes, torsoFront);
}

/** How much a point on the head matters to the simplifier (generate.mjs buildHead): the face 1, the ears 0.5, the scalp 0.12. */
export function headImportance(x, y, z) {
  const face = sstep(-0.005, 0.045, z) * sstep(1.49, 1.525, y) * sstep(1.725, 1.69, y);
  const ears = 0.5 * sstep(0.066, 0.08, Math.abs(x)) * sstep(0.05, 0.02, z) * sstep(1.55, 1.58, y) * sstep(1.71, 1.68, y);
  return 0.12 + 0.88 * Math.max(face, ears);
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

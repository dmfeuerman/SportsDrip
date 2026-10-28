/**
 * The skeleton-facing description of the body: limb centre-lines, their
 * radius profiles and the skin-weight functions every mesh uses.
 *
 * The base body (character.mjs) is a signed-distance model built around these
 * centre-lines, and every skinned garment takes its weights from the same
 * functions (via the body's own regions), which is why body and clothes bend
 * together at the elbows, knees, shoulders and hips.
 */
import * as THREE from "three";
import { curve, mix, smoothstep } from "./geometry.mjs";
import { REST, sideBone as B } from "./rig.mjs";

const sgn = (side) => (side === "L" ? 1 : -1);

export function torsoWeights(p) {
  const y = p.y;
  const ax = Math.abs(p.x);
  const side = p.x >= 0 ? "L" : "R";
  let w = { Hips: 1 };
  w = mix(w, { Spine: 1 }, smoothstep(0.96, 1.04, y));
  w = mix(w, { Spine1: 1 }, smoothstep(1.06, 1.14, y));
  w = mix(w, { Spine2: 1 }, smoothstep(1.17, 1.25, y));
  // Collarbone/trapezius band rides the shoulder; the deltoid follows the arm.
  const sh = smoothstep(0.075, 0.17, ax) * smoothstep(1.3, 1.4, y);
  if (sh > 0) w = mix(w, { [B("Shoulder", side)]: 0.7, [B("Arm", side)]: 0.3 }, sh * 0.75);
  const nk = smoothstep(1.43, 1.5, y) * (1 - smoothstep(0.05, 0.11, ax));
  if (nk > 0) w = mix(w, { Neck: 1 }, nk);
  const lg = smoothstep(0.03, 0.1, ax) * smoothstep(0.95, 0.85, y) * 0.8;
  if (lg > 0) w = mix(w, { [B("UpLeg", side)]: 1 }, lg);
  return w;
}

/* ── limbs ───────────────────────────────────────────────────────────────── */

/** Arc-length parameter of the path point nearest `p`. */
function nearestT(path, p) {
  const q = new THREE.Vector3(...p);
  let best = 0, bd = Infinity;
  for (let i = 0; i <= 2000; i++) {
    const d = path.getPointAt(i / 2000).distanceToSquared(q);
    if (d < bd) [bd, best] = [d, i / 2000];
  }
  return best;
}

/** `profile(tJoint)` returns [rxKeys, rzKeys, weightFn] for the joint's arc-length position. */
function limb(points, joint, profile) {
  const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const tJ = nearestT(path, joint);
  const [rx, rz, weightFn] = profile(tJ);
  return Object.assign(
    (t) => ({ c: path.getPointAt(t), tan: path.getTangentAt(t), rx: curve(rx, t), rz: curve(rz, t), w: weightFn(t) }),
    { arcLength: path.getLength(), path, tJoint: tJ }
  );
}

const ARM_CACHE = {};
const LEG_CACHE = {};

const scaleKeys = (keys, k) => keys.map(([t, r]) => [t, r * k]);

/**
 * Arm centre-line from the top of the shoulder to the wrist; t: 0 shoulder → 1 wrist.
 * `build` (-1 slim … +1 broad) thickens the limb for the body-build blendshapes.
 */
export function arm(side, build = 0) {
  const key = `${side}${build}`;
  if (ARM_CACHE[key]) return ARM_CACHE[key];
  const s = sgn(side);
  const U = REST[B("Arm", side)], E = REST[B("ForeArm", side)], W = REST[B("Hand", side)];
  const pts = [[0.155 * s, 1.424, -0.012], U, [(U[0] + E[0]) / 2, (U[1] + E[1]) / 2, (U[2] + E[2]) / 2 + 0.002], E, W];
  const k = (1 + 0.11 * build) * 0.93;
  return (ARM_CACHE[key] = limb(pts, E, (tE) => [
    scaleKeys([[0, 0.06], [0.06, 0.061], [0.28, 0.057], [tE - 0.03, 0.045], [tE + 0.06, 0.046], [0.75, 0.042], [0.93, 0.032], [1, 0.03]], k),
    scaleKeys([[0, 0.06], [0.06, 0.059], [0.28, 0.056], [tE - 0.03, 0.044], [tE + 0.06, 0.044], [0.75, 0.037], [0.93, 0.025], [1, 0.023]], k),
    (t) => {
      let w = mix({ [B("Shoulder", side)]: 0.3, [B("Arm", side)]: 0.7 }, { [B("Arm", side)]: 1 }, smoothstep(0, 0.1, t));
      w = mix(w, { [B("ForeArm", side)]: 1 }, smoothstep(tE - 0.06, tE + 0.06, t));
      w = mix(w, { [B("Hand", side)]: 1 }, smoothstep(0.95, 1.0, t) * 0.4);
      return w;
    },
  ]));
}

/** Leg centre-line from the top of the hip to the ankle; t: 0 hip → 1 ankle. */
export function leg(side, build = 0) {
  const key = `${side}${build}`;
  if (LEG_CACHE[key]) return LEG_CACHE[key];
  const s = sgn(side);
  const H = REST[B("UpLeg", side)], K = REST[B("Leg", side)], A = REST[B("Foot", side)];
  const pts = [[0.086 * s, 0.985, 0], H, [(H[0] + K[0]) / 2, (H[1] + K[1]) / 2, 0.016], K, [(K[0] + A[0]) / 2, (K[1] + A[1]) / 2, -0.004], A];
  const k = (1 + 0.1 * build) * 0.95;
  return (LEG_CACHE[key] = limb(pts, K, (tK) => [
    scaleKeys([[0, 0.084], [0.08, 0.088], [0.3, 0.079], [tK - 0.05, 0.06], [tK, 0.057], [tK + 0.07, 0.057], [0.7, 0.056], [0.88, 0.043], [1, 0.037]], k),
    scaleKeys([[0, 0.08], [0.08, 0.086], [0.3, 0.08], [tK - 0.05, 0.06], [tK, 0.058], [tK + 0.07, 0.059], [0.7, 0.06], [0.88, 0.042], [1, 0.038]], k),
    (t) => {
      let w = mix({ Hips: 1 }, { [B("UpLeg", side)]: 1 }, smoothstep(0.0, 0.13, t));
      w = mix(w, { [B("Leg", side)]: 1 }, smoothstep(tK - 0.05, tK + 0.05, t));
      w = mix(w, { [B("Foot", side)]: 1 }, smoothstep(0.96, 1.0, t) * 0.3);
      return w;
    },
  ]));
}

/** Radius profile lookup for code that wants "how thick is the limb here". */
export const limbRadius = (sampler, t) => {
  const s = sampler(t);
  return [s.rx, s.rz];
};

export { sgn };

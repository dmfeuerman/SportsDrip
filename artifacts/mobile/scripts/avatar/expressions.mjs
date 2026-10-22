/**
 * Face expression blendshapes (ARKit names), as displacement fields in head
 * space. The generator samples them at every vertex of the heads, lids,
 * lashes and facial hair, so all of those move together:
 *
 *   eyeBlinkLeft / eyeBlinkRight    upper lid and lashes roll down over the eye
 *   mouthSmileLeft / mouthSmileRight  mouth corner up and back, cheek lifts
 *   jawOpen                         the jaw swings open about the hinge
 *
 * "Left" is the character's left (+x), as in ARKit.
 *
 * Each returns { d: [dx, dy, dz], r: [axis, angle] | null } — a translation,
 * and for rotation-like moves the rotation to apply to the normal.
 */
import { EYE, MOUTH, smileAt } from "./character.mjs";
import { EYE_SHAPE } from "./face.mjs";
import { sstep } from "./sdf.mjs";

const ZERO = { d: [0, 0, 0], r: null };

/** Rotates v about the X axis by a. */
export const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];

/* ── jaw ─────────────────────────────────────────────────────────────────── */

export const JAW = { pivot: [0, 1.588, -0.012], angle: 0.2 };

/** How much of the jaw's swing a point takes (0 upper face … 1 chin). */
export function jawWeight(x, y, z) {
  const ax = Math.abs(x);
  const line = MOUTH.y + smileAt(x);
  // At the lips the split is sharp (upper lip stays, lower lip goes)…
  const sharp = sstep(line + 0.0006, line - 0.0006, y);
  // …further out the cheek stretches over a broader band.
  const broad = sstep(MOUTH.y + 0.012, MOUTH.y - 0.022, y);
  const atMouth = sstep(MOUTH.w + 0.008, MOUTH.w - 0.002, ax) * sstep(MOUTH.z - 0.04, MOUTH.z - 0.025, z);
  let w = broad + (sharp - broad) * atMouth;
  w *= sstep(-0.035, 0.005, z); // nothing behind the jaw angle
  w *= sstep(0.098, 0.07, ax); // nor past it at the sides
  w *= sstep(1.468, 1.515, y); // the neck below stays with the body
  return w;
}

export function jawOpen(p) {
  const w = jawWeight(...p);
  if (w <= 0) return ZERO;
  const a = JAW.angle * w;
  const o = JAW.pivot;
  const q = rotX([p[0] - o[0], p[1] - o[1], p[2] - o[2]], a);
  return { d: [q[0] + o[0] - p[0], q[1] + o[1] - p[1], q[2] + o[2] - p[2]], r: ["x", a] };
}

/* ── smile ───────────────────────────────────────────────────────────────── */

export function mouthSmile(side, p) {
  const s = side === "L" ? 1 : -1;
  const [x, y, z] = p;
  if (x * s < -0.004) return ZERO;
  const g = (c, sig) => Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) / (2 * sig * sig));
  const corner = g([MOUTH.w * s, MOUTH.y + 0.003, MOUTH.z - 0.006], 0.0105);
  const cheek = g([0.044 * s, 1.588, 0.092], 0.014);
  const lip = g([MOUTH.w * 0.5 * s, MOUTH.y - 0.004, MOUTH.z], 0.009); // lower lip stretches a little
  return {
    d: [s * (0.0017 * corner + 0.0004 * cheek + 0.0006 * lip), 0.0039 * corner + 0.0023 * cheek + 0.0012 * lip, -0.0017 * corner + 0.0011 * cheek],
    r: null,
  };
}

/* ── blink ───────────────────────────────────────────────────────────────── */

const upper = (e, u) => e.top * Math.pow(Math.max(0, 1 - (u / e.w) ** 2), e.p) + e.tilt * u;
const R_LID = EYE.r + 0.0019;

/** Angle the upper lid rolls through to meet the lower one, for an eye shape. */
export const blinkAngle = (shape) => {
  const e = EYE_SHAPE[shape];
  return (Math.atan2(e.top, R_LID) + Math.atan2(e.bot, R_LID)) * 0.97;
};

/** Upper-lid roll for one eye: full at the lid margin, fading to nothing up under the brow. */
export function eyeBlink(shape, side, p, { lashes = false } = {}) {
  const s = side === "L" ? 1 : -1;
  const [x, y, z] = p;
  const cx = EYE.x * s;
  if ((x - cx) * s < -0.03 || Math.abs(x - cx) > 0.04) return ZERO;
  const e = EYE_SHAPE[shape];
  const u = (x - cx) * s, v = y - EYE.y;
  if (!lashes && v < e.tilt * u - 0.0005) return ZERO; // lower lid stays
  const w = lashes ? 1 : sstep(upper(e, u) + 0.013, upper(e, u) + 0.0035, v);
  if (w <= 0) return ZERO;
  const a = blinkAngle(shape) * w;
  const o = [cx, EYE.y, EYE.z];
  const q = rotX([x - o[0], y - o[1], z - o[2]], a);
  return { d: [q[0] + o[0] - x, q[1] + o[1] - y, q[2] + o[2] - z], r: ["x", a] };
}

export const EXPRESSION_FNS = {
  jawOpen: (p) => jawOpen(p),
  mouthSmileLeft: (p) => mouthSmile("L", p),
  mouthSmileRight: (p) => mouthSmile("R", p),
};

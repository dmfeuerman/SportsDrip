/**
 * Headwear fit volumes — the shared contract between hats and hair.
 *
 * Each hair mode ("capped", "covered", "helmet", "banded") describes the
 * region of the scalp a kind of headwear covers and how far its inside sits
 * off the scalp. Two things are built from the same numbers:
 *
 *  - every hat of that mode (templates.mjs) has its inner surface exactly
 *    `hatGap` off the scalp inside the covered region, so it can't float or
 *    sink, whichever face shape is worn (they share the cranium);
 *  - every hairstyle gets a variant for that mode (hair.mjs) in which hair
 *    under the covered region is pressed down to `hairGap` (just inside the
 *    hat) and flares back to its full shape below the hat's edge, so no hair
 *    pokes through and hair still shows naturally under the brim.
 *
 * Coordinates: polar angles about the cranium centre (rig.HEAD) — theta from
 * the crown (0) down, phi the azimuth from the front (0) toward the
 * character's left (+π/2).
 */
import { HAIR_MODES as RIG_HAIR_MODES, HEAD } from "./rig.mjs";
import { EAR_C, scalpUnionD } from "./character.mjs";
import { clamp, sstep } from "./sdf.mjs";

const [CX, CY, CZ] = HEAD.center;
const [RX, RY, RZ] = HEAD.radii;
/** Mean cranium radius, to turn angles into metres. */
export const R_MEAN = (RX + RY + RZ) / 3;

export function polar(x, y, z) {
  const u = (x - CX) / RX, v = (y - CY) / RY, w = (z - CZ) / RZ;
  const r = Math.hypot(u, v, w) || 1e-9;
  return { theta: Math.acos(clamp(v / r, -1, 1)), phi: Math.atan2(u, w), r };
}

/**
 * Distance off the scalp: the outermost skull over every face shape (ears,
 * eyes and nose excluded), so whatever is fitted to it fits every face.
 */
export const scalpD = (x, y, z) => scalpUnionD(x, y, z);

/** A point `off` metres off the scalp in direction (theta, phi). */
export function scalpPoint(theta, phi, off = 0) {
  const dir = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];
  const p = [CX + RX * dir[0], CY + RY * dir[1], CZ + RZ * dir[2]];
  const n = [dir[0] / RX, dir[1] / RY, dir[2] / RZ];
  const l = Math.hypot(...n);
  return [p[0] + (n[0] / l) * off, p[1] + (n[1] / l) * off, p[2] + (n[2] / l) * off];
}

/** Edge polar angle by azimuth, blending front / side / back values. */
export function edgeAngle({ front, side, back }, phi) {
  const f = Math.max(0, Math.cos(phi)) ** 2;
  const b = Math.max(0, -Math.cos(phi)) ** 2;
  const s = Math.sin(phi) ** 2;
  return (front * f + side * s + back * b) / (f + s + b);
}

/**
 * Fit modes. `edge` is the lower boundary of what the headwear covers,
 * `hatGap(v)` / `hairGap(v)` the inner-surface and pressed-hair heights off
 * the scalp at v = theta / edge (0 crown → 1 edge), and `flare` how fast hair
 * regains its thickness below the edge (metres of thickness per metre).
 */
export const HAT_FIT = {
  // Baseball cap: band across the forehead a couple of centimetres above the brows (where the
  // brim attaches), over the tops of the ears, low at the back.
  capped: {
    edge: { front: 1.12, side: 1.3, back: 1.52 },
    hatGap: (v) => 0.003 + 0.0085 * (1 - v * v),
    flare: 0.45,
  },
  // Beanie / bucket: lower all round, down to the nape at the back, just above the ears.
  covered: {
    edge: { front: 1.06, side: 1.4, back: 1.86 },
    hatGap: (v) => 0.0032 + 0.0058 * (1 - v * v),
    flare: 0.45,
  },
  // Hard shell with ear guards (batting helmet): padding keeps it a little further off.
  helmet: {
    edge: { front: 1.06, side: 1.82, back: 1.92 },
    hatGap: (v) => 0.008 + 0.004 * (1 - v * v),
    flare: 0.45,
  },
  // A headband strap over the crown from ear to ear (headphones).
  banded: {
    band: { halfWidth: 0.022, maxTheta: 1.3 },
    hatGap: () => 0.0045,
    flare: 0.6,
  },
};
/**
 * Headphone ear cups (banded mode): a disc over each ear, `r` in radius, its
 * inner face `out` metres outside the ear centre. Hair under a cup is pressed
 * like hair under the band, so the cups sit on the hair instead of inside it.
 */
export const CUP = { out: 0.019, dy: 0.002, dz: -0.004, r: 0.043 };
export const cupCentre = (s) => {
  const e = EAR_C[s > 0 ? "L" : "R"];
  return [e[0] + CUP.out * s, e[1] + CUP.dy, e[2] + CUP.dz];
};

export const HAIR_MODES = Object.keys(HAT_FIT);
if (HAIR_MODES.join() !== RIG_HAIR_MODES.join()) throw new Error("fit.mjs HAT_FIT and rig.mjs HAIR_MODES disagree");

/** How far pressed hair sits inside the hat's inner surface. */
export const HAIR_CLEARANCE = 0.0013;

/**
 * Coverage of a point by a mode, in metres: positive under the headwear,
 * negative below/outside its edge. `v` is the normalised position (0 crown →
 * 1 edge), clamped.
 */
export function coverage(mode, x, y, z) {
  const fit = HAT_FIT[mode];
  const { theta, phi } = polar(x, y, z);
  if (fit.band) {
    // Distance from the coronal band plane through the head centre (z = CZ, slightly forward).
    const across = Math.abs(z - (CZ - 0.004)) - fit.band.halfWidth;
    const below = (theta - fit.band.maxTheta) * R_MEAN * Math.abs(Math.sin(phi));
    let u = -Math.max(across, below);
    // The cups: inside a cup's disc (plus a little), on its side of the head.
    if (Math.abs(x) > 0.05) {
      const c = cupCentre(Math.sign(x));
      u = Math.max(u, CUP.r + 0.003 - Math.hypot(y - c[1], z - c[2]));
    }
    return { u, v: clamp(theta / fit.band.maxTheta, 0, 1) };
  }
  const e = edgeAngle(fit.edge, phi);
  return { u: (e - theta) * R_MEAN, v: clamp(theta / e, 0, 1) };
}

/**
 * The space hair may occupy under this headwear: negative inside. Intersect
 * (max) a hairstyle's field with it to get the pressed variant.
 */
export function hairAllowance(mode, x, y, z) {
  const fit = HAT_FIT[mode];
  const { u, v } = coverage(mode, x, y, z);
  const pressed = Math.max(0.0006, fit.hatGap(v) - HAIR_CLEARANCE);
  // Under the hat: pressed thickness. Below the edge: grows back with depth.
  const t = pressed + fit.flare * Math.max(0, -u) + (0.25 * Math.max(0, -u) ** 2) / 0.01;
  return scalpD(x, y, z) - t;
}

/** Inner surface of a hat of this mode: negative inside the headwear's inner space. */
export function hatInnerD(mode, x, y, z) {
  const { v } = coverage(mode, x, y, z);
  return scalpD(x, y, z) - HAT_FIT[mode].hatGap(v);
}

/** Smooth 0..1 weight: 1 well inside the covered region, 0 outside. */
export const covered = (mode, x, y, z, soft = 0.004) => sstep(-soft, soft, coverage(mode, x, y, z).u);

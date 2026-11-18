/**
 * Rigid face parts on the Head bone: eyeballs, irises, pupils, eyelids and
 * lashes for each eye shape, brows for each brow style, and the mouth line.
 *
 * Eye shapes are separate lid meshes over one pair of eyeballs, so changing
 * the eye shape never multiplies the head meshes, and the lids can later be
 * animated (blinks) without touching the head.
 */
import { EYE, headD, MOUTH } from "./character.mjs";
import { tube } from "./geometry.mjs";
import { gauss, smax, sstep } from "./sdf.mjs";

/**
 * Eye openings in the eye's front plane (u: outward from the nose, v: up),
 * metres. Upper and lower lid curves meet at the corners u = ±w; `tilt` lifts
 * the outer corner.
 */
export const EYE_SHAPE = {
  round: { w: 0.0179, top: 0.0122, bot: 0.0104, p: 0.55, q: 0.6, tilt: 0.04, lash: 1.0 },
  almond: { w: 0.0189, top: 0.0098, bot: 0.0069, p: 0.7, q: 0.75, tilt: 0.16, lash: 1.15 },
  sleepy: { w: 0.0181, top: 0.0064, bot: 0.0085, p: 0.85, q: 0.7, tilt: -0.04, lash: 0.85 },
};

const upper = (e, u) => e.top * Math.pow(Math.max(0, 1 - (u / e.w) ** 2), e.p) + e.tilt * u;
const lower = (e, u) => -e.bot * Math.pow(Math.max(0, 1 - (u / e.w) ** 2), e.q) + e.tilt * u;

/** Signed distance (approx.) to the eye opening in the (u, v) plane; negative inside. */
export function openingD(shape, u, v) {
  const e = EYE_SHAPE[shape];
  return Math.max(v - upper(e, u), lower(e, u) - v, Math.abs(u) - e.w);
}

/** One eye's lid field, in head space, for the eye whose centre has sign s (+1 left, -1 right). */
export function lidD(shape, s, x, y, z) {
  const cx = EYE.x * s;
  const dx = x - cx, dy = y - EYE.y, dz = z - EYE.z;
  const r = Math.hypot(dx, dy, dz);
  // Shell just over the eyeball, 2.2 mm thick, with a rounded margin.
  const shell = Math.abs(r - (EYE.r + 0.0019)) - 0.0011;
  const u = dx * s;
  const open = openingD(shape, u, dy);
  // Only the front of the eye; past the socket rim the shell is buried in the head anyway.
  const front = -(dz + 0.004);
  const extent = Math.hypot(u * 0.8, dy) - 0.03;
  return smax(smax(smax(shell, -open, 0.0016), front, 0.002), extent, 0.002);
}

export function lidBox(s) {
  const cx = EYE.x * s;
  return [[cx - 0.034, EYE.y - 0.032, EYE.z - 0.012], [cx + 0.034, EYE.y + 0.032, EYE.z + 0.028]];
}

/** Iris tint per vertex: dark limbal ring, lighter middle, fine radial fibres. */
export function irisShade(rho, ang) {
  const ring = sstep(0.72, 1.0, rho);
  const fibres = 0.07 * Math.sin(ang * 11) * sstep(0.35, 0.6, rho) * (1 - ring);
  const k = 1.08 - 0.55 * ring - 0.18 * gauss(rho, 0.42, 0.12) + fibres;
  return Math.max(0.25, Math.min(1.25, k));
}

/** A spherical cap on a sphere of radius R about the eye centre, out to angular radius `alpha`. */
function cap(b, c, R, alpha, rows, cols) {
  for (let i = 0; i <= rows; i++) {
    const a = (alpha * Math.max(i, 0.02)) / rows;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      b.vertex([c[0] + R * Math.sin(a) * Math.cos(ph), c[1] + R * Math.sin(a) * Math.sin(ph), c[2] + R * Math.cos(a)]);
    }
  }
  b.grid(rows + 1, cols, true);
}

export const IRIS_R = 0.01;
export const PUPIL_R = 0.0043;

export function eyeballs(b) {
  // Only the front shows through the lids; the back of the ball is inside the head.
  for (const s of [1, -1]) cap(b, [EYE.x * s, EYE.y, EYE.z], EYE.r, 1.95, 6, 24);
}

export function irises(b) {
  for (const s of [1, -1]) {
    const c = [EYE.x * s, EYE.y, EYE.z];
    const alpha = Math.asin(IRIS_R / (EYE.r + 0.0003));
    const start = b.count;
    cap(b, c, EYE.r + 0.0003, alpha, 4, 24);
    for (let v = start; v < b.count; v++) {
      const [x, y] = [b.pos[v * 3] - c[0], b.pos[v * 3 + 1] - c[1]];
      const k = irisShade(Math.hypot(x, y) / IRIS_R, Math.atan2(y, x));
      b.color(v, [k, k, k]);
    }
  }
}

export function pupils(b) {
  for (const s of [1, -1]) {
    const c = [EYE.x * s, EYE.y, EYE.z];
    cap(b, c, EYE.r + 0.00055, Math.asin(PUPIL_R / (EYE.r + 0.00055)), 2, 16);
  }
}

/** Upper lash line along the lid margin, thicker and flicked out toward the outer corner. */
export function lashes(b, shape) {
  const e = EYE_SHAPE[shape];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const u = -e.w * 0.92 + (2 * e.w * 0.97 * i) / 14; // inner → outer
      const v = upper(e, u) + 0.0004;
      const rr = EYE.r + 0.0031;
      const z = EYE.z + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
      const out = Math.max(0, u / e.w - 0.45) / 0.55; // 0 inside → 1 at the outer corner
      const flick = out * out * 0.0042 * e.lash;
      const r = (0.0007 + 0.0009 * out + 0.0003 * Math.sin((i / 14) * Math.PI)) * e.lash;
      pts.push({ c: [EYE.x * s + s * (u + flick * 0.7), EYE.y + v + flick * 0.6, z - flick * 0.2], rx: r, rz: r * 0.7, w: {} });
    }
    tube(b, pts, { steps: 1, radial: 4, capStart: true, capEnd: true });
  }
}

/* ── brows ───────────────────────────────────────────────────────────────── */

/** Brow strokes in face space: x along the brow (inner → outer), arch, thickness and taper. */
export const BROW_STYLE = {
  soft: { x0: 0.012, x1: 0.059, y: 1.6745, arch: 0.0042, th: 0.0042, tail: 0.5, slope: 0.0 },
  arched: { x0: 0.013, x1: 0.059, y: 1.6755, arch: 0.0085, th: 0.0038, tail: 0.35, slope: 0.002 },
  bold: { x0: 0.010, x1: 0.061, y: 1.674, arch: 0.0032, th: 0.0068, tail: 0.6, slope: -0.0015 },
};

/** Brow as a field: a stroke on the forehead, lifted just off the oval face's skin. */
export function browD(style, x, y, z) {
  const st = BROW_STYLE[style];
  const ax = Math.abs(x);
  if (ax < st.x0 - 0.006 || ax > st.x1 + 0.006 || Math.abs(y - st.y) > 0.02 || z < 0.06) return 1;
  const t = (ax - st.x0) / (st.x1 - st.x0); // 0 inner → 1 outer
  const tc = Math.max(0, Math.min(1, t));
  const centre = st.y + st.arch * Math.sin(Math.PI * Math.min(1, tc * 1.15)) + st.slope * tc - 0.003 * tc * tc;
  const half = (st.th * (1 - (1 - st.tail) * tc ** 1.5)) / 2 * (0.85 + 0.15 * Math.sin(Math.PI * Math.min(1, tc * 2)));
  const stroke = Math.max(Math.abs(y - centre) - half, Math.max(st.x0 - ax, ax - st.x1) * 0.6);
  const skin = headD("oval", x, y, z);
  const layer = Math.abs(skin - 0.0009) - 0.0009;
  return smax(layer, stroke, 0.0012);
}

export function browBox() {
  return [[-0.075, 1.65, 0.07], [0.075, 1.7, 0.135]];
}

/**
 * Upper teeth: a short arc of white just inside the upper lip — hidden at
 * rest, showing when the jaw opens.
 */
export function teethD(x, y, z) {
  const zc = MOUTH.z - 0.026;
  const R = 0.0205;
  const radial = Math.hypot(x, (z - zc) * 1.05);
  const a = Math.atan2(x, z - zc);
  let d = Math.max(Math.abs(radial - R) - 0.0019, Math.abs(y - (MOUTH.y + 0.0026)) - 0.0028, Math.abs(a) - 0.95);
  // A hint of separate teeth.
  d += 0.0003 * Math.abs(Math.sin(a * 11));
  return smax(d, -1, 0) ;
}
export const TEETH_BOX = [[-0.03, MOUTH.y - 0.004, MOUTH.z - 0.03], [0.03, MOUTH.y + 0.008, MOUTH.z]];

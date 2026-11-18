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
  // Upper lids sit a little lower over the iris (a relaxed, lidded look rather than a stare).
  round: { w: 0.0179, top: 0.0101, bot: 0.0093, p: 0.6, q: 0.6, tilt: 0.04, lash: 1.0 },
  almond: { w: 0.0189, top: 0.0092, bot: 0.0068, p: 0.75, q: 0.75, tilt: 0.16, lash: 1.15 },
  sleepy: { w: 0.0181, top: 0.0062, bot: 0.0084, p: 0.85, q: 0.7, tilt: -0.04, lash: 0.85 },
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
  const u = dx * s;
  const e = EYE_SHAPE[shape];
  // A thin shell hugging the eyeball (1.4 mm thick, its middle LID_GAP off the ball) with a
  // rounded margin, so the lids wrap the sclera instead of standing off it as a thick ledge that
  // catches the key light. The upper lid has a soft fold a few millimetres above its margin.
  const fold = 0.0008 * Math.exp(-(((dy - upper(e, u) - 0.0036) / 0.0022) ** 2)) * Math.max(0, 1 - (u / (e.w * 1.15)) ** 2);
  const shell = Math.abs(r - (EYE.r + LID_GAP + fold * 0.5)) - 0.0007 - fold * 0.5;
  const open = openingD(shape, u, dy);
  // Only the front of the eye; past the socket rim the shell is buried in the head anyway.
  const front = -(dz + 0.004);
  const extent = Math.hypot(u * 0.8, dy) - 0.03;
  return smax(smax(smax(shell, -open, 0.0012), front, 0.002), extent, 0.002);
}

/** Distance from the eyeball's surface to the middle of the lid shell (expressions.mjs blinks about it). */
export const LID_GAP = 0.0012;

export function lidBox(s) {
  const cx = EYE.x * s;
  return [[cx - 0.034, EYE.y - 0.032, EYE.z - 0.012], [cx + 0.034, EYE.y + 0.032, EYE.z + 0.028]];
}

/**
 * The irises and pupils turn this far toward the nose (rad, ≈ 0.45 mm at the cornea): a
 * slight convergence, so the eyes focus on the viewer instead of staring past them.
 */
export const GAZE_IN = 0.026;

/** Iris tint per vertex: dark limbal ring, lighter middle, fine radial fibres. */
export function irisShade(rho, ang) {
  const ring = sstep(0.72, 1.0, rho);
  const fibres = 0.07 * Math.sin(ang * 11) * sstep(0.35, 0.6, rho) * (1 - ring);
  const k = 1.08 - 0.55 * ring - 0.18 * gauss(rho, 0.42, 0.12) + fibres;
  return Math.max(0.25, Math.min(1.25, k));
}

/**
 * A spherical cap on a sphere of radius R about the eye centre, out to angular radius `alpha`,
 * its axis turned `yaw` about the vertical (0 = straight ahead). `shade(u, v)`, if given, colours
 * each vertex from its position in the cap's own frame.
 */
function cap(b, c, R, alpha, rows, cols, yaw = 0, shade = null) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i <= rows; i++) {
    const a = (alpha * Math.max(i, 0.02)) / rows;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const lx = R * Math.sin(a) * Math.cos(ph), ly = R * Math.sin(a) * Math.sin(ph), lz = R * Math.cos(a);
      const v = b.vertex([c[0] + lx * cy + lz * sy, c[1] + ly, c[2] - lx * sy + lz * cy]);
      if (shade) b.color(v, shade(lx, ly));
    }
  }
  b.grid(rows + 1, cols, true);
}

export const IRIS_R = 0.0108;
export const PUPIL_R = 0.0043;

export function eyeballs(b) {
  // Only the front shows through the lids; the back of the ball is inside the head.
  for (const s of [1, -1]) cap(b, [EYE.x * s, EYE.y, EYE.z], EYE.r, 1.95, 6, 24);
}

export function irises(b) {
  for (const s of [1, -1]) {
    const c = [EYE.x * s, EYE.y, EYE.z];
    const alpha = Math.asin(IRIS_R / (EYE.r + 0.0003));
    // Shaded in the cap's own frame, with x mirrored per eye so both irises match.
    cap(b, c, EYE.r + 0.0003, alpha, 4, 24, -s * GAZE_IN, (x, y) => {
      const k = irisShade(Math.hypot(x, y) / IRIS_R, Math.atan2(y, x * s));
      return [k, k, k];
    });
  }
}

export function pupils(b) {
  for (const s of [1, -1]) {
    const c = [EYE.x * s, EYE.y, EYE.z];
    cap(b, c, EYE.r + 0.00055, Math.asin(PUPIL_R / (EYE.r + 0.00055)), 2, 16, -s * GAZE_IN);
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
      const rr = EYE.r + LID_GAP + 0.0011;
      const z = EYE.z + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
      const out = Math.max(0, u / e.w - 0.45) / 0.55; // 0 inside → 1 at the outer corner
      const flick = out * out * 0.0042 * e.lash;
      const r = (0.00085 + 0.001 * out + 0.00035 * Math.sin((i / 14) * Math.PI)) * e.lash; // a bold lash line, like liner
      pts.push({ c: [EYE.x * s + s * (u + flick * 0.7), EYE.y + v + flick * 0.6, z - flick * 0.2], rx: r, rz: r * 0.7, w: {} });
    }
    tube(b, pts, { steps: 1, radial: 4, capStart: true, capEnd: true });
  }
}

/* ── brows ───────────────────────────────────────────────────────────────── */

/** Brow strokes in face space: x along the brow (inner → outer), arch, thickness and taper. */
export const BROW_STYLE = {
  // Sculpted game brows: a full, squared inner head low over the inner eye, a clean upper and
  // lower edge, the peak about two-thirds out and a tail tapering to a point on the brow ridge.
  // `head` is how much fuller the inner head is than the body of the brow.
  soft: { x0: 0.0105, x1: 0.0605, y: 1.6735, arch: 0.0042, th: 0.0066, tail: 0.28, slope: 0.0004, head: 0.22 },
  arched: { x0: 0.0115, x1: 0.0605, y: 1.6745, arch: 0.0082, th: 0.006, tail: 0.24, slope: 0.002, head: 0.18 },
  bold: { x0: 0.009, x1: 0.0625, y: 1.6728, arch: 0.0034, th: 0.0092, tail: 0.36, slope: -0.0012, head: 0.25 },
};

/** Brow as a field: a stroke on the forehead, lifted just off the oval face's skin. */
export function browD(style, x, y, z) {
  const st = BROW_STYLE[style];
  const ax = Math.abs(x);
  if (ax < st.x0 - 0.006 || ax > st.x1 + 0.006 || Math.abs(y - st.y) > 0.02 || z < 0.06) return 1;
  const t = (ax - st.x0) / (st.x1 - st.x0); // 0 inner → 1 outer
  const tc = Math.max(0, Math.min(1, t));
  // Arch peaks ~65 % of the way out, then the tail drops away.
  const centre = st.y + st.arch * Math.sin(Math.PI * Math.min(1, tc * 0.77)) ** 1.3 + st.slope * tc - 0.0042 * sstep(0.62, 1, tc);
  // Full at the inner head, tapering over the outer half to a pointed tail.
  const half = (st.th * (1 - (1 - st.tail) * sstep(0.4, 1, tc) ** 1.2)) / 2 * (1 + st.head * (1 - sstep(0.0, 0.32, tc)));
  // The inner head drops a little below the body's line, as real brows do.
  const c2 = centre - 0.0011 * (1 - sstep(0, 0.3, tc));
  const stroke = Math.max(Math.abs(y - c2) - half, Math.max((st.x0 - ax) * 1.4, (ax - st.x1) * 0.6));
  const skin = headD("oval", x, y, z);
  // A real volume off the skin, domed across the stroke: sculpted, not a painted line.
  const dome = sstep(0, -half, Math.abs(y - c2) - half);
  const lift = (0.0011 + 0.0009 * dome) * (1 - 0.35 * sstep(0.6, 1, tc));
  const layer = Math.abs(skin - lift) - lift;
  return smax(layer, stroke, 0.0008);
}

export function browBox() {
  return [[-0.075, 1.65, 0.07], [0.075, 1.7, 0.135]];
}

/**
 * Upper teeth: a short arc of white just inside the upper lip — hidden at
 * rest, showing when the jaw opens.
 */
export function teethD(x, y, z) {
  // (Set back far enough that the closed lips' slit never shows a line of white.)
  const zc = MOUTH.z - 0.0285;
  const R = 0.0205;
  const radial = Math.hypot(x, (z - zc) * 1.05);
  const a = Math.atan2(x, z - zc);
  let d = Math.max(Math.abs(radial - R) - 0.0019, Math.abs(y - (MOUTH.y + 0.0026)) - 0.0028, Math.abs(a) - 0.95);
  // A hint of separate teeth.
  d += 0.0003 * Math.abs(Math.sin(a * 11));
  return smax(d, -1, 0) ;
}
export const TEETH_BOX = [[-0.03, MOUTH.y - 0.004, MOUTH.z - 0.03], [0.03, MOUTH.y + 0.008, MOUTH.z]];

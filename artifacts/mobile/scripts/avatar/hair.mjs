/**
 * Hairstyles and facial hair as signed-distance fields over the shared
 * cranium, sculpted in chunky, stylised clumps.
 *
 * Every style is one field; the variants a hat needs are the same field
 * intersected with that hat mode's allowance (fit.mjs), so hair under a cap
 * is pressed flat inside it and flares back out under the brim — no clipping,
 * no floating hats, and nothing hand-tuned per hat.
 */
import { HEAD } from "./rig.mjs";
import { bodyD, EYE, headD, headSkinD, MOUTH } from "./character.mjs";
import { coverage, edgeAngle, hairAllowance, polar, R_MEAN, scalpD } from "./fit.mjs";
import { clamp, gauss, sdCone, sdEllipsoid, smax, smin, sstep } from "./sdf.mjs";

const [CX, CY, CZ] = HEAD.center;

/* ── noise ───────────────────────────────────────────────────────────────── */

function hash3(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth value noise in [-1, 1]. */
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const n = (a, b, c) => hash3(i + a, j + b, k + c);
  return 2 * l(l(l(n(0, 0, 0), n(1, 0, 0), u), l(n(0, 1, 0), n(1, 1, 0), u), v), l(l(n(0, 0, 1), n(1, 0, 1), u), l(n(0, 1, 1), n(1, 1, 1), u), v), w) - 1;
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

/**
 * Polar angle of the hairline by azimuth: `front` at the forehead, `side`
 * arching over the ears, dropping right behind them to `back` at the nape;
 * with an optional sideburn dip in front of the ears.
 */
function hairline({ front = 0.95, side = 1.48, back = 2.05, burn = 0.22 } = {}, phi) {
  const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  let th = edgeAngle({ front, side, back: side }, Math.min(a, Math.PI / 2));
  th += (back - th) * sstep(1.8, 2.25, a);
  th += burn * Math.exp(-(((a - 1.2) / 0.1) ** 2));
  return th;
}

/**
 * A shell over the scalp: `thick(theta, phi)` off the scalp, inside the
 * hairline, with a rounded edge. The part inside the head is buried.
 */
function shell(x, y, z, line, thick, edgeRound = 0.003) {
  const { theta, phi } = polar(x, y, z);
  const lineTheta = hairline(line, phi);
  const out = (theta - lineTheta) * R_MEAN; // > 0 below the hairline
  // Hair thins toward the hairline instead of ending in a thick ledge.
  const t = Math.min(thick(theta, phi, Math.min(1, theta / lineTheta)), 0.0018 + 1.1 * Math.max(0, -out));
  // Over the skull, and at the nape over the skin where the neck blends into it.
  const base = y < 1.63 ? Math.min(scalpD(x, y, z), headSkinD("oval", x, y, z)) : scalpD(x, y, z);
  return smax(base - t, out, edgeRound);
}

/** Clump grooves running along meridians (combed out from the crown). */
function combed(theta, phi, n, depth, seed = 0) {
  const a = phi * n * 0.5 / Math.PI;
  const cell = Math.round(a);
  const f = a - cell;
  const jitter = 0.6 + 0.4 * hash3(cell, seed, 7);
  const groove = Math.pow(Math.abs(Math.sin(Math.PI * f)), 0.6);
  return depth * jitter * (1 - groove) * sstep(0.12, 0.45, theta);
}

/** Keeps hair out of the face, the body and the eyes. */
function clearOfBody(d, x, y, z, gap = 0.004) {
  if (y < 1.62) d = smax(d, -(bodyD(x, y, z) - gap), 0.004);
  return d;
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const front = (phi) => Math.max(0, Math.cos(phi));

export const HAIR = {
  buzz: (x, y, z) => shell(x, y, z, { front: 0.98, side: 1.5, back: 2.36, burn: 0.12 }, () => 0.0026, 0.0018),

  short_crop: (x, y, z) =>
    shell(
      x, y, z,
      { front: 0.94, side: 1.46, back: 2.38, burn: 0.18 },
      (th, ph, v) => {
        let t = 0.0135 * (1 - 0.5 * v * v) + 0.005 * front(ph) * sstep(0.5, 0.85, th) * (1 - sstep(0.9, 1.0, th));
        t -= combed(th, ph, 30, 0.003, 1);
        return Math.max(0.0025, t);
      }
    ),

  fade: (x, y, z) =>
    shell(
      x, y, z,
      { front: 0.93, side: 1.48, back: 2.36, burn: 0.1 },
      (th, ph) => {
        const top = 1 - sstep(0.7, 1.02, th + 0.12 * front(ph));
        let t = 0.0022 + 0.026 * top * (0.8 + 0.2 * front(ph));
        t -= top * combed(th, ph, 26, 0.004, 2);
        return t;
      },
      0.004
    ),

  curls: (x, y, z) => {
    let d = shell(x, y, z, { front: 0.92, side: 1.5, back: 2.38, burn: 0.16 }, (th, ph, v) => 0.019 * (1 - 0.4 * v * v) + 0.004, 0.006);
    // Tight coils: rounded bumps all over the surface.
    const n = noise3(x * 140, y * 140, z * 140) + 0.5 * noise3(x * 300 + 3, y * 300, z * 300);
    return d - 0.0035 * Math.max(-0.4, n);
  },

  afro: (x, y, z) => {
    const { theta, phi } = polar(x, y, z);
    const line = hairline({ front: 0.9, side: 1.56, back: 2.36, burn: 0.1 }, phi);
    const r = Math.hypot(x - CX, (y - (CY + 0.03)) * 0.98, z - (CZ - 0.012));
    let d = r - 0.172; // a round mass a bit above and behind the head centre
    d = smax(d, (theta - line) * R_MEAN, 0.018);
    // Keep the face and ears open.
    d = smax(d, -(scalpD(x, y, z) - 0.002), 0.004);
    d = clearOfBody(d, x, y, z, 0.006);
    const n = noise3(x * 70, y * 70, z * 70) + 0.45 * noise3(x * 160 + 7, y * 160, z * 160);
    return d - 0.005 * n;
  },

  braids: (x, y, z) => {
    // Cornrows: raised rows from the hairline back to the nape.
    const { theta, phi } = polar(x, y, z);
    const s = Math.atan2(x - CX, y - (CY - 0.075)); // side-to-side angle, rows meeting below the nape
    const rows = 7;
    const f = (s * rows) / Math.PI;
    const ridge = Math.pow(Math.abs(Math.cos((Math.PI * f) / 1)), 0.5);
    const plait = 0.0012 * Math.sin(theta * 70 + (Math.round(f) % 2) * 1.5);
    let d = shell(x, y, z, { front: 0.94, side: 1.5, back: 2.36, burn: 0.12 }, () => 0.0025 + 0.0052 * ridge + plait, 0.002);
    // Braids hanging from the nape.
    for (let i = 0; i < 5; i++) {
      const bx = (i - 2) * 0.03;
      const top = [bx, 1.6, -0.108 + 0.01 * Math.abs(i - 2.5) ** 1.2 * 0];
      for (let k = 0; k < 9; k++) {
        const yy = 1.6 - k * 0.022;
        const sway = 0.003 * Math.sin(k * 1.9 + i);
        const ii = i - 2;
        const zc = -0.106 - 0.014 * sstep(1.6, 1.52, yy) + 0.012 * Math.abs(ii) * 0.5;
        const c = [bx * (1 + 0.15 * sstep(1.6, 1.45, yy)) + sway, yy, zc];
        const rr = 0.0105 * (1 - k * 0.035);
        d = smin(d, sdEllipsoid(x - c[0], y - c[1], z - c[2], rr, 0.016, rr * 0.92), 0.007);
      }
      void top;
    }
    return clearOfBody(d, x, y, z, 0.003);
  },

  long: (x, y, z) => {
    const ax = Math.abs(x);
    const top = (th, ph) => {
      let t = 0.0145 + 0.0045 * Math.abs(Math.sin(ph)) * sstep(0.6, 1.2, th);
      // Middle part.
      t -= 0.004 * gauss(Math.sin(ph) * Math.sin(th), 0, 0.012) * sstep(0.8, 0.3, th) * front(ph);
      t -= combed(th, ph, 34, 0.0025, 3);
      return t;
    };
    let d = shell(x, y, z, { front: 0.92, side: 1.62, back: 2.4, burn: 0.0 }, top, 0.004);
    // A full bob: the head's widest section dropped straight down the back and
    // sides, flaring a little, ends turned under at the jaw / nape.
    const Y0 = 1.65;
    if (y < Y0 + 0.01 && y > 1.47 && z < 0.1) {
      const a = Math.atan2(x, -(z - CZ)); // 0 at the back
      const yBot = 1.505 + 0.032 * Math.sin(a) ** 2 * sstep(0.4, 1.2, Math.abs(a));
      const k = sstep(Y0, yBot, y);
      const T = 0.0185 + 0.009 * k - 0.007 * sstep(yBot + 0.025, yBot, y);
      const s0 = scalpD(x, Y0, z);
      let fall = s0 - T;
      fall = smax(fall, -(s0 - T + 0.026), 0.008); // hollow inside
      fall = smax(fall, yBot - y, 0.012);
      // Open at the front for the face; side locks reach forward past the ears.
      const open = z - (0.02 + 0.075 * sstep(0.05, 0.1, ax) * sstep(1.51, 1.6, y));
      fall = smax(fall, open, 0.012);
      // Strands running down.
      fall -= 0.0022 * Math.abs(Math.sin(a * 18 + noise3(x * 60, y * 15, z * 60) * 1.4)) * sstep(Y0, Y0 - 0.03, y);
      d = smin(d, fall, 0.012);
    }
    // Not over the face, the ears' fronts or the body.
    d = smax(d, -(scalpD(x, y, z) - 0.0012), 0.003);
    if (y < 1.66 && z > 0.0) d = smax(d, -(headD("round", x, y, z) - 0.003), 0.004);
    return clearOfBody(d, x, y, z, 0.005);
  },

  ponytail: (x, y, z) => {
    let d = smin(ponytailCapD(x, y, z), ponytailTailD(null, x, y, z), 0.01);
    return clearOfBody(d, x, y, z, 0.004);
  },
};

/**
 * Styles whose free shape can't be pressed under a hat: the afro's 17 cm
 * sphere cut by a hat's allowance left a jagged, flaring skirt. Under any
 * headwear it is tucked instead: a dense coiled layer that follows the head
 * and fills out a little below the edge.
 */
export const HAIR_UNDER_HAT = {
  afro: (x, y, z) => {
    let d = shell(x, y, z, { front: 0.9, side: 1.56, back: 2.36, burn: 0.1 }, (th, ph, v) => 0.017 * (1 - 0.35 * v * v) + 0.004, 0.006);
    const n = noise3(x * 140, y * 140, z * 140) + 0.5 * noise3(x * 300 + 3, y * 300, z * 300);
    d -= 0.003 * Math.max(-0.4, n);
    return clearOfBody(d, x, y, z, 0.005);
  },
};

/** The ponytail's scalp layer: hair pulled back tight to the tie. */
export const ponytailCapD = (x, y, z) => shell(x, y, z, { front: 0.95, side: 1.52, back: 2.34, burn: 0.1 }, (th, ph) => 0.0062 - combed(th, ph, 40, 0.0012, 4), 0.003);

/**
 * Where the ponytail is tied, per headwear mode. Free hair is tied high on
 * the crown; under a hat the tie drops to just below the hat's back edge, so
 * the tail hangs from the hair under the hat instead of being cut off by it
 * (which left the lower half floating behind the neck).
 */
export const PONY_TIE = {
  free: [0, 1.676, -0.134],
  capped: [0, 1.622, -0.127],
  covered: [0, 1.575, -0.117],
  helmet: [0, 1.566, -0.114],
  banded: [0, 1.676, -0.134],
};
const tieOf = (mode) => PONY_TIE[mode ?? "free"];

/** The tail, hanging from the tie to just above the shoulders; anything a hat covers is cut away. */
export function ponytailTailD(mode, x, y, z) {
  const [tx, ty, tz] = tieOf(mode);
  // The free tail's shape, re-rooted at this mode's tie and shortened to keep the same end point.
  const end = 1.47;
  const k = (ty - end) / (1.676 - end);
  const at = (dy, dz) => [tx, ty - dy * k, tz + dz];
  const pts = [at(0, 0.004), at(0.025, -0.024), at(0.09, -0.034), at(0.155, -0.024), [tx, end, tz - 0.008]];
  const rad = [0.021, 0.027, 0.025, 0.017, 0.007];
  if (Math.abs(x) > 0.06 || y > ty + 0.04 || y < end - 0.02 || z > tz + 0.04 || z < tz - 0.08) return 0.03;
  let tail = 1;
  for (let i = 0; i < pts.length - 1; i++) tail = smin(tail, sdCone(x, y, z, pts[i], pts[i + 1], rad[i], rad[i + 1]), 0.008);
  tail -= 0.0015 * Math.abs(Math.sin(Math.atan2(x, z + 0.15) * 14 + y * 40));
  if (mode && mode !== "banded") tail = smax(tail, coverage(mode, x, y, z).u + 0.004, 0.004);
  return tail;
}

/** The ponytail under a hat of this mode: pressed scalp layer plus the re-rooted tail. */
export function ponytailPressedD(mode, x, y, z) {
  const capPart = Math.max(ponytailCapD(x, y, z), hairAllowance(mode, x, y, z));
  return clearOfBody(smin(capPart, ponytailTailD(mode, x, y, z), 0.01), x, y, z, 0.004);
}

/** The ponytail's tie, its own material. */
export function ponytailTieD(x, y, z, mode = null) {
  const [tx, ty, tz] = tieOf(mode);
  let d = sdEllipsoid(x - tx, y - ty, z - tz, 0.026, 0.012, 0.022);
  if (mode && mode !== "banded") d = smax(d, coverage(mode, x, y, z).u + 0.003, 0.003);
  return d;
}

/** Simplification tolerance per style (m): bumpy styles keep their silhouette, not every bump. */
export const HAIR_ERROR = { afro: 0.0011, curls: 0.0008, braids: 0.0006, long: 0.0007, ponytail: 0.0005 };

export const HAIR_BOX = {
  default: [[-0.16, 1.5, -0.18], [0.16, 1.84, 0.16]],
  afro: [[-0.2, 1.48, -0.21], [0.2, 1.88, 0.18]],
  long: [[-0.17, 1.39, -0.2], [0.17, 1.84, 0.16]],
  braids: [[-0.16, 1.38, -0.18], [0.16, 1.84, 0.16]],
  ponytail: [[-0.16, 1.4, -0.2], [0.16, 1.84, 0.16]],
};

/* ── strands (normal-map detail and anisotropy flow) ─────────────────────── */

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** v with its component along the head's normal at p removed (≈ the hair surface's tangent plane). */
function tangential(v, x, y, z, c = [CX, CY, CZ]) {
  const n = unit([x - c[0], y - c[1], z - c[2]]);
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  return unit([v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]);
}
/** Combed out from a pole (by default the top of the head) along great circles. */
const fromPole = (x, y, z, pole = [CX, CY + HEAD.radii[1], CZ]) => tangential([x - pole[0], y - pole[1], z - pole[2]], x, y, z);
/** Falling straight down. */
const down = (x, y, z) => tangential([0, -1, 0], x, y, z);
const mixDir = (a, b, k) => unit([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);

/** Azimuth of p about an axis through c (radians). */
function azimuth(x, y, z, c, axis) {
  const a = unit(axis);
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = unit([a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]]);
  const w = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  const p = [x - c[0], y - c[1], z - c[2]];
  return Math.atan2(p[0] * w[0] + p[1] * w[1] + p[2] * w[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
}

/**
 * Strand grooves across an angle coordinate: `n` strand clumps around the
 * full turn, each a rounded ridge, depth `amp`, wandering a little along
 * their length so they don't read as ruled lines.
 */
function strands(angle, n, amp, x, y, z, wander = 0.35) {
  const s = (angle * n) / (2 * Math.PI) + wander * noise3(x * 90, y * 90, z * 90);
  const ridge = Math.pow(Math.abs(Math.sin(Math.PI * s)), 0.7);
  const vary = 0.75 + 0.25 * noise3(x * 40 + 5, y * 40, z * 40);
  return amp * (ridge - 0.6) * vary;
}
/** Strands combed from the top of the head: fine ones over broader clumps, fading at the whorl. */
const combedStrands = (x, y, z, fine = 170, amp = 0.0006) => {
  const { theta, phi } = polar(x, y, z);
  const atWhorl = sstep(0.06, 0.3, theta);
  return atWhorl * (strands(phi, fine, amp, x, y, z) + strands(phi, fine * 0.33, amp * 1.6, x + 1, y, z, 0.2));
};
/** Straight-down strands (around the vertical axis). */
const fallingStrands = (x, y, z, fine = 190, amp = 0.0007) => {
  const a = Math.atan2(x - CX, z - CZ);
  return strands(a, fine, amp, x, y, z, 0.25) + strands(a, fine * 0.3, amp * 1.4, x + 2, y, z, 0.15);
};
/** Tight coils: small round bumps. */
const coils = (x, y, z, f = 420, amp = 0.0008) => amp * (noise3(x * f, y * f, z * f) + 0.5 * noise3(x * f * 2.1 + 3, y * f * 2.1, z * f * 2.1));

const TIE = [0, 1.676, -0.134];
const LONG_Y0 = 1.65;
const NAPE = [CX, CY - 0.075, CZ];

/**
 * Per style: the normal-map detail (metres, outward) and the strand flow
 * [dx, dy, dz, anisotropy strength] for the anisotropic highlight.
 */
export const HAIR_DETAIL = {
  buzz: (x, y, z) => 0.00025 * noise3(x * 500, y * 500, z * 500),
  short_crop: (x, y, z) => combedStrands(x, y, z, 170, 0.0006),
  fade: (x, y, z) => combedStrands(x, y, z, 170, 0.0006) * sstep(1.62, 1.68, y) + 0.0002 * noise3(x * 500, y * 500, z * 500),
  curls: (x, y, z) => coils(x, y, z, 380, 0.0009),
  afro: (x, y, z) => coils(x, y, z, 330, 0.0011),
  braids: (x, y, z) => {
    // Along the rows: grooves across them follow the row angle.
    const a = Math.atan2(x - NAPE[0], y - NAPE[1]);
    return y > 1.6 ? strands(a, 260, 0.0004, x, y, z, 0.1) : fallingStrands(x, y, z, 260, 0.0004);
  },
  long: (x, y, z) => (y > LONG_Y0 + 0.01 ? combedStrands(x, y, z, 180, 0.0006) : fallingStrands(x, y, z, 200, 0.0007)) ,
  ponytail: (x, y, z) => {
    if (z < -0.13 && y < 1.68) return fallingStrands(x, y, z, 120, 0.0006);
    return strands(azimuth(x, y, z, [CX, CY, CZ], [TIE[0] - CX, TIE[1] - CY, TIE[2] - CZ]), 200, 0.0005, x, y, z, 0.2);
  },
};

export const HAIR_FLOW = {
  buzz: (x, y, z) => [...fromPole(x, y, z), 0.25],
  short_crop: (x, y, z) => [...fromPole(x, y, z), 0.7],
  fade: (x, y, z) => [...fromPole(x, y, z), 0.6],
  curls: (x, y, z) => {
    const a = noise3(x * 60, y * 60, z * 60) * Math.PI;
    const f = fromPole(x, y, z), n = unit([x - CX, y - CY, z - CZ]);
    const g = unit([n[1] * f[2] - n[2] * f[1], n[2] * f[0] - n[0] * f[2], n[0] * f[1] - n[1] * f[0]]);
    return [...unit([f[0] * Math.cos(a) + g[0] * Math.sin(a), f[1] * Math.cos(a) + g[1] * Math.sin(a), f[2] * Math.cos(a) + g[2] * Math.sin(a)]), 0.25];
  },
  afro: (x, y, z) => [...fromPole(x, y, z), 0.15],
  braids: (x, y, z) => (y > 1.6 ? [...tangential([x - NAPE[0], y - NAPE[1], 0], x, y, z), 0.6] : [...down(x, y, z), 0.6]),
  long: (x, y, z) => [...mixDir(fromPole(x, y, z), down(x, y, z), sstep(LONG_Y0 + 0.03, LONG_Y0 - 0.02, y)), 0.85],
  ponytail: (x, y, z) => {
    if (z < -0.13 && y < 1.68) return [...down(x, y, z), 0.7];
    return [...tangential([TIE[0] - x, TIE[1] - y, TIE[2] - z], x, y, z), 0.7];
  },
};

/** Beard hair: fine strands growing down, over a coarse wiry texture. */
export function beardDetail(x, y, z) {
  return strands(x * 40, 26, 0.0004, x, y * 0.3, z, 0.5) + 0.00008 * noise3(x * 300, y * 300, z * 300);
}
export const beardFlow = (x, y, z) => [...tangential([0, -1, 0.25], x, y, z, [0, 1.6, -0.01]), 0.4];

/* ── facial hair ─────────────────────────────────────────────────────────── */

/**
 * Where facial hair grows on a face shape: negative inside the region.
 *
 * The cheek line runs on a diagonal, from the sideburn in front of the ear
 * down to the mouth corner, the way real growth does; the mustache sits under
 * the nose. The back edge stops in front of the ear and follows the jaw angle
 * down, so the beard wraps the jaw instead of ending in a flat plate.
 */
export function beardRegion(style, x, y, z) {
  const ax = Math.abs(x);
  const lipsOut = Math.max(Math.abs(y - (MOUTH.y + 0.0008)) - 0.0075, ax - (MOUTH.w + 0.002)); // lips stay bare
  if (style === "beard" || style === "stubble") {
    // Seen from the side it's a diagonal: 1.632 at the sideburn in front of the ear, down to
    // 1.586 at the mouth corner; the mustache fills in under the nose.
    const side = sstep(0.028, 0.042, ax);
    const cheekLine = 1.586 + side * 0.046 * sstep(0.088, 0.012, z);
    // In front of the ear at the top, dropping back to the jaw angle under it.
    const zBack = 0.012 - 0.036 * sstep(1.6, 1.52, y);
    let r = Math.max(y - cheekLine, zBack - z);
    r = Math.max(r, -lipsOut);
    // Over the whole chin (front and underside) and onto the top of the throat, no further:
    // a little lower at the front than behind the jaw angle, where it stops at the neck.
    r = Math.max(r, 1.505 - y - 0.011 * sstep(0.0, 0.05, z));
    return r;
  }
  // Goatee: chin and a mustache joined at the mouth corners.
  // Wraps the point of the chin and its underside (chins bottom out at y ≈ 1.504–1.508).
  const chin = Math.max(ax - 0.026 - 0.004 * sstep(1.56, 1.53, y), y - (MOUTH.y - 0.006), 1.497 - y, 0.042 - z);
  const stache = Math.max(ax - (MOUTH.w + 0.005), Math.abs(y - (MOUTH.y + 0.0125)) - 0.0055, 0.1 - z);
  const corners = Math.max(Math.abs(ax - (MOUTH.w + 0.004)) - 0.0035, Math.abs(y - MOUTH.y) - 0.012, 0.09 - z);
  return Math.max(Math.min(chin, stache, corners), -lipsOut);
}

/** Full thickness off the skin, before the taper at the edges. */
const BEARD_THICK = {
  stubble: () => 0.0005,
  goatee: (x, y) => 0.003 + 0.0025 * sstep(MOUTH.y - 0.01, 1.52, y),
  // Close on the cheeks, fuller over the chin and under the jaw.
  beard: (x, y, z) => 0.0034 + 0.0038 * sstep(1.585, 1.535, y) * sstep(0.075, 0.02, Math.abs(x)) + 0.001 * sstep(0.02, 0.07, z) * sstep(1.56, 1.52, y),
};
/** How far in from the region's edge the hair reaches full thickness. */
const BEARD_TAPER = { stubble: 0.004, goatee: 0.008, beard: 0.012 };

export const FACIAL_HAIR_STYLES = ["stubble", "goatee", "beard"];

/** Facial hair over one face shape (and the top of the neck under the jaw). */
export function beardD(style, face, x, y, z) {
  if (y > 1.64 || y < 1.47 || z < -0.06 || Math.abs(x) > 0.13) return 0.05;
  const skin = Math.min(headD(face, x, y, z), y < 1.56 ? bodyD(x, y, z) : 1);
  // Thins out to almost nothing at its edge, so it grows from the skin instead of sitting on it like a mask.
  const region = beardRegion(style, x, y, z);
  const ramp = sstep(0, -BEARD_TAPER[style], region);
  const t = 0.0012 + (BEARD_THICK[style](x, y, z) - 0.0012) * ramp;
  let d = smax(skin - t, region, style === "stubble" ? 0.002 : 0.0025);
  if (style !== "stubble") {
    // Clumps (the strands themselves are in the normal map).
    const n = noise3(x * 160, y * 90, z * 160);
    d -= 0.0009 * n * sstep(0.003, 0.006, t);
  }
  // Not inside the skin: the shell's inner side is buried.
  return smax(d, -(skin + 0.0002), 0.0006);
}

export const BEARD_BOX = [[-0.13, 1.47, -0.06], [0.13, 1.64, 0.15]];

/** Eyes stay clear of everything. */
export const eyeClear = (x, y, z) => Math.hypot(Math.abs(x) - EYE.x, y - EYE.y, z - EYE.z) - (EYE.r + 0.004);
void clamp;

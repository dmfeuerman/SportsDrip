/**
 * Hairstyles and facial hair as signed-distance fields over the shared
 * cranium, sculpted in natural, stylised volumes.
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
 * arching over the ears, dropping smoothly behind them to `back` at the nape;
 * with a natural sideburn contour in front of the ears.
 */
function hairline({ front = 0.95, side = 1.48, back = 2.05, burn = 0.22 } = {}, phi) {
  const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  let th = edgeAngle({ front, side, back: side }, Math.min(a, Math.PI / 2));
  th += (back - th) * sstep(1.75, 2.35, a);
  th += burn * Math.exp(-(((a - 1.18) / 0.13) ** 2));
  return th;
}

/**
 * A shell over the scalp: `thick(theta, phi)` off the scalp, inside the
 * hairline, with a rounded edge. The part inside the head is buried.
 */
function shell(x, y, z, line, thick, edgeRound = 0.003, { edgeMin = 0.0024, edgeRamp = 2.1 } = {}) {
  const { theta, phi } = polar(x, y, z);
  const lineTheta = hairline(line, phi);
  const out = (theta - lineTheta) * R_MEAN; // > 0 below the hairline
  const t = Math.min(thick(theta, phi, Math.min(1, theta / lineTheta)), edgeMin + edgeRamp * Math.max(0, -out));
  const base = y < 1.63 ? Math.min(scalpD(x, y, z), headSkinD("oval", x, y, z)) : scalpD(x, y, z);
  return smax(base - t, out, edgeRound);
}

/** Clump grooves running along meridians (combed out from the crown). */
function combed(theta, phi, n, depth, seed = 0) {
  const a = (phi * n * 0.5) / Math.PI;
  const cell = Math.round(a);
  const f = a - cell;
  const jitter = 0.6 + 0.4 * hash3(cell, seed, 7);
  const groove = Math.pow(Math.abs(Math.sin(Math.PI * f)), 0.6);
  return depth * jitter * (1 - groove) * sstep(0.12, 0.45, theta);
}

/**
 * Long, low-relief sculpted lock waves flowing out from the crown, giving
 * natural directional flow without breaking the silhouette into scales.
 */
export function locks(theta, phi, { n = 16, rows = 2, len = 0.65, start = 0.08, amp = 0.0022, sweep = 0.24, width = 0.72, lift = 0.35, seed = 0 } = {}) {
  let best = 0;
  for (let k = 0; k < rows; k++) {
    const nk = n + 2 * k;
    const a = (phi * nk) / (2 * Math.PI) + 0.5 * k + 0.17 * k * k;
    const c0 = Math.floor(a);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const id = ((c % nk) + nk) % nk;
      const j = hash3(id, k, seed), j2 = hash3(id, k, seed + 11);
      const root = start + k * len * 0.48 + 0.08 * (j - 0.5);
      const L = len * (0.88 + 0.24 * j2);
      const s = (theta - root) / L; // 0 root → 1 tip
      if (s < -0.2 || s > 1) continue;
      const f = a - (c + 0.5 + 0.18 * (j2 - 0.5) + sweep * (j - 0.5) * s * s);
      const w = width * (1 - 0.65 * sstep(0.35, 1, s));
      const q = Math.abs(f) / w;
      if (q >= 1) continue;
      const along = sstep(-0.2, 0.15, s) * (1 - 0.75 * sstep(0.78, 1.0, s));
      best = Math.max(best, (1 - Math.pow(q, 1.5)) * along * amp * (1 - lift + lift * s));
    }
  }
  return best;
}

/**
 * Curl clumps: soft, organic overlapping curl waves over the crown.
 */
const CURL_ROW = 0.28;
export function curlCell(theta, phi, { n = 16, amp = 0.0038, radius = 0.76 } = {}) {
  let best = { h: 0, q: 1, ang: 0 };
  const r0 = Math.round(theta / CURL_ROW);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0) continue;
    const th = r * CURL_ROW;
    const nr = Math.max(1, Math.round(n * Math.sin(Math.max(th, 0.3))));
    const a = (phi * nr) / (2 * Math.PI) + 0.5 * (r % 2);
    const c0 = Math.round(a);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const id = ((c % nr) + nr) % nr;
      const j = hash3(id, r, 31);
      const du = ((a - c - 0.2 * (j - 0.5)) * ((2 * Math.PI * Math.sin(Math.max(th, 0.3))) / nr)) / CURL_ROW;
      const dv = (theta - th - 0.06 * (hash3(id, r, 37) - 0.5)) / CURL_ROW / 1.18;
      const q = Math.hypot(du, dv) / (radius * (0.9 + 0.2 * j));
      if (q >= 1) continue;
      const h = amp * Math.pow(1 - q * q, 0.75) * (0.85 + 0.3 * j);
      if (h > best.h) best = { h, q, ang: Math.atan2(dv, du) };
    }
  }
  return best;
}

/** Keeps hair out of the face, the body and the eyes. */
function clearOfBody(d, x, y, z, gap = 0.004) {
  if (y < 1.62) d = smax(d, -(bodyD(x, y, z) - gap), 0.004);
  return d;
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const front = (phi) => Math.max(0, Math.cos(phi));

export const HAIR = {
  buzz: (x, y, z) => shell(x, y, z, { front: 0.96, side: 1.48, back: 2.28, burn: 0.12 }, () => 0.0026, 0.0018),

  // Textured short crop: natural continuous cranial volume with forward-swept crown waves,
  // a soft sculpted front fringe, and a clean barbered taper down the sides and nape.
  short_crop: (x, y, z) => {
    const line = { front: 0.92, side: 1.45, back: 2.22, burn: 0.15 };
    const d = shell(
      x,
      y,
      z,
      line,
      (th, ph, v) => {
        const f = front(ph);
        const top = 1 - sstep(0.56, 0.92, th - 0.12 * f);
        const sideTaper = 0.002 + 0.0048 * (1 - sstep(0.62, 1.0, v));
        const crownVol = top * (0.0056 + 0.0034 * f * gauss(th, 0.76, 0.16));
        const flow = locks(th, ph, { n: 15, rows: 1, len: 0.85, start: 0.08, amp: 0.0008, sweep: 0.22, width: 0.85, lift: 0.25, seed: 1 }) * (0.3 + 0.7 * top) - combed(th, ph, 26, 0.0007, 1) * (0.35 + 0.65 * top);
        return sideTaper + crownVol + flow;
      },
      0.0035,
      { edgeMin: 0.0008, edgeRamp: 0.75 }
    );
    return clearOfBody(d, x, y, z, 0.003);
  },

  // Modern athletic fade: fuller forward-swept top and front quiff transitioning smoothly
  // at the parietal ridge into a close skin-fade taper along the temples and nape.
  fade: (x, y, z) => {
    const line = { front: 0.9, side: 1.44, back: 2.18, burn: 0.09 };
    const d = shell(
      x,
      y,
      z,
      line,
      (th, ph, v) => {
        const f = front(ph);
        const top = 1 - sstep(0.52, 0.84, th - 0.14 * f);
        const skinFade = 0.0007 + 0.0026 * (1 - sstep(0.5, 1.0, v));
        const topVol = top * (0.0086 + 0.005 * Math.pow(f, 1.25) * gauss(th, 0.72, 0.15));
        const flow = locks(th, ph, { n: 14, rows: 1, len: 0.85, start: 0.08, amp: 0.0009, sweep: 0.26, width: 0.85, lift: 0.3, seed: 2 }) * top - combed(th, ph, 24, 0.0008, 2) * top;
        return skinFade + topVol + flow;
      },
      0.0035,
      { edgeMin: 0.0006, edgeRamp: 0.55 }
    );
    return clearOfBody(d, x, y, z, 0.003);
  },

  // Natural curly top: soft, organic coil waves across a full rounded crown, tapering
  // cleanly into the temples and nape without isolated blisters.
  curls: (x, y, z) =>
    shell(
      x,
      y,
      z,
      { front: 0.9, side: 1.46, back: 2.22, burn: 0.14 },
      (th, ph, v) => {
        const top = 1 - sstep(0.62, 0.96, v);
        return 0.0018 + 0.0034 * (1 - sstep(0.72, 1.0, v)) + top * (0.0095 * (1 - 0.25 * v * v)) + (0.25 + 0.75 * top) * curlCell(th, ph).h;
      },
      0.004,
      { edgeMin: 0.0009, edgeRamp: 0.85 }
    ),

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
    const { theta } = polar(x, y, z);
    const s = Math.atan2(x - CX, y - (CY - 0.075)); // side-to-side angle, rows meeting below the nape
    const rows = 7;
    const f = (s * rows) / Math.PI;
    const ridge = Math.pow(Math.abs(Math.cos((Math.PI * f) / 1)), 0.75);
    const plait = 0.0012 * Math.sin(theta * 70 + (Math.round(f) % 2) * 1.5);
    let d = shell(x, y, z, { front: 0.94, side: 1.5, back: 2.36, burn: 0.12 }, () => 0.002 + 0.0062 * ridge + plait, 0.002);
    // Braids hanging from the nape.
    for (let i = 0; i < 5; i++) {
      const bx = (i - 2) * 0.03;
      for (let k = 0; k < 9; k++) {
        const yy = 1.6 - k * 0.022;
        const sway = 0.003 * Math.sin(k * 1.9 + i);
        const ii = i - 2;
        const zc = -0.106 - 0.014 * sstep(1.6, 1.52, yy) + 0.012 * Math.abs(ii) * 0.5;
        const c = [bx * (1 + 0.15 * sstep(1.6, 1.45, yy)) + sway, yy, zc];
        const rr = 0.0105 * (1 - k * 0.035);
        d = smin(d, sdEllipsoid(x - c[0], y - c[1], z - c[2], rr, 0.016, rr * 0.92), 0.007);
      }
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
      const open = z - (0.02 + 0.075 * sstep(0.05, 0.1, ax) * sstep(1.51, 1.6, y));
      fall = smax(fall, open, 0.012);
      fall -= 0.0022 * Math.abs(Math.sin(a * 18 + noise3(x * 60, y * 15, z * 60) * 1.4)) * sstep(Y0, Y0 - 0.03, y);
      d = smin(d, fall, 0.012);
    }
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
 * Styles whose free shape can't be pressed under a hat: under any headwear the
 * afro is tucked into a dense coiled layer that follows the head.
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
export const ponytailCapD = (x, y, z) => shell(x, y, z, { front: 0.94, side: 1.5, back: 2.28, burn: 0.1 }, (th, ph) => 0.0062 - combed(th, ph, 40, 0.0012, 4), 0.003);

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

/** Simplification tolerance per style (m). */
export const HAIR_ERROR = { short_crop: 0.0014, fade: 0.0014, curls: 0.0016 };

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

function strands(angle, n, amp, x, y, z, wander = 0.35) {
  const s = (angle * n) / (2 * Math.PI) + wander * noise3(x * 90, y * 90, z * 90);
  const ridge = Math.pow(Math.abs(Math.sin(Math.PI * s)), 0.7);
  const vary = 0.75 + 0.25 * noise3(x * 40 + 5, y * 40, z * 40);
  return amp * (ridge - 0.6) * vary;
}
/** Strands combed from the top of the head: fine ones over broader clumps, fading at the whorl. */
const combedStrands = (x, y, z, fine = 170, amp = 0.0005) => {
  const { theta, phi } = polar(x, y, z);
  const atWhorl = sstep(0.06, 0.3, theta);
  return atWhorl * (strands(phi, fine, amp * 1.1, x, y, z) + strands(phi, fine * 0.32, amp * 1.8, x + 1, y, z, 0.2));
};
/** Straight-down strands (around the vertical axis). */
const fallingStrands = (x, y, z, fine = 190, amp = 0.0007) => {
  const a = Math.atan2(x - CX, z - CZ);
  return strands(a, fine, amp, x, y, z, 0.25) + strands(a, fine * 0.3, amp * 1.4, x + 2, y, z, 0.15);
};
/** Strands spiralling round each curl clump (curlCell). */
const curlStrands = (x, y, z, amp = 0.00032) => {
  const { theta, phi } = polar(x, y, z);
  const c = curlCell(theta, phi);
  const g = Math.pow(Math.abs(Math.sin(c.ang * 5 + c.q * 3)), 0.7) - 0.6;
  return amp * 0.5 * g * (1 - c.q) + strands(phi, 220, 0.00016, x, y, z, 0.3);
};
/** Fine strands combed straight out from the crown (short sides, buzz cuts). */
const shortStrands = (x, y, z, fine = 300, amp = 0.0002) => {
  const { phi } = polar(x, y, z);
  return strands(phi, fine, amp, x, y, z, 0.15);
};
/** Tight coils: small round bumps. */
const coils = (x, y, z, f = 420, amp = 0.0008) => amp * (noise3(x * f, y * f, z * f) + 0.5 * noise3(x * f * 2.1 + 3, y * f * 2.1, z * f * 2.1));

const TIE = [0, 1.676, -0.134];
const LONG_Y0 = 1.65;
const NAPE = [CX, CY - 0.075, CZ];

export const HAIR_DETAIL = {
  buzz: (x, y, z) => shortStrands(x, y, z, 320, 0.00022),
  short_crop: (x, y, z) => combedStrands(x, y, z, 180, 0.00048),
  fade: (x, y, z) => combedStrands(x, y, z, 165, 0.0005) * sstep(1.62, 1.68, y) + shortStrands(x, y, z) * sstep(1.68, 1.62, y),
  curls: (x, y, z) => curlStrands(x, y, z),
  afro: (x, y, z) => coils(x, y, z, 330, 0.0011),
  braids: (x, y, z) => {
    const a = Math.atan2(x - NAPE[0], y - NAPE[1]);
    return y > 1.6 ? strands(a, 260, 0.0004, x, y, z, 0.1) : fallingStrands(x, y, z, 260, 0.0004);
  },
  long: (x, y, z) => (y > LONG_Y0 + 0.01 ? combedStrands(x, y, z, 180, 0.0006) : fallingStrands(x, y, z, 200, 0.0007)),
  ponytail: (x, y, z) => {
    if (z < -0.13 && y < 1.68) return fallingStrands(x, y, z, 120, 0.0006);
    return strands(azimuth(x, y, z, [CX, CY, CZ], [TIE[0] - CX, TIE[1] - CY, TIE[2] - CZ]), 200, 0.0005, x, y, z, 0.2);
  },
};

export const HAIR_FLOW = {
  buzz: (x, y, z) => [...fromPole(x, y, z), 0.25],
  short_crop: (x, y, z) => [...fromPole(x, y, z), 0.7],
  fade: (x, y, z) => [...fromPole(x, y, z), 0.65],
  curls: (x, y, z) => {
    const { theta, phi } = polar(x, y, z);
    const a = curlCell(theta, phi).ang + Math.PI / 2;
    const f = fromPole(x, y, z), n = unit([x - CX, y - CY, z - CZ]);
    const g = unit([n[1] * f[2] - n[2] * f[1], n[2] * f[0] - n[0] * f[2], n[0] * f[1] - n[1] * f[0]]);
    return [...unit([f[0] * Math.sin(a) + g[0] * Math.cos(a), f[1] * Math.sin(a) + g[1] * Math.cos(a), f[2] * Math.sin(a) + g[2] * Math.cos(a)]), 0.35];
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
  return strands(x * 40, 26, 0.0005, x, y * 0.3, z, 0.5) + strands(x * 40, 9, 0.0005, x + 3, y * 0.3, z, 0.3) + 0.00008 * noise3(x * 300, y * 300, z * 300);
}
export const beardFlow = (x, y, z) => [...tangential([0, -1, 0.25], x, y, z, [0, 1.6, -0.01]), 0.4];

/* ── facial hair ─────────────────────────────────────────────────────────── */

export function beardRegion(style, x, y, z) {
  const ax = Math.abs(x);
  const lipsOut = Math.max(Math.abs(y - (MOUTH.y + 0.0008)) - 0.0075, ax - (MOUTH.w + 0.002)); // lips stay bare
  if (style === "beard" || style === "stubble") {
    const side = sstep(0.028, 0.042, ax);
    const cheekLine = 1.586 + side * 0.046 * sstep(0.088, 0.012, z);
    const zBack = 0.012 - 0.036 * sstep(1.6, 1.52, y);
    let r = Math.max(y - cheekLine, zBack - z);
    r = Math.max(r, -lipsOut);
    r = Math.max(r, 1.505 - y - 0.011 * sstep(0.0, 0.05, z));
    return r;
  }
  const chin = smax(smax(ax - 0.026 - 0.004 * sstep(1.56, 1.53, y), y - (MOUTH.y - 0.006), 0.005), Math.max(1.497 - y, 0.042 - z), 0.003);
  const stache = smax(smax(ax - (MOUTH.w + 0.005), Math.abs(y - (MOUTH.y + 0.0125)) - 0.0055, 0.004), 0.1 - z, 0.002);
  const corners = smax(Math.abs(ax - (MOUTH.w + 0.004)) - 0.0035, Math.max(Math.abs(y - MOUTH.y) - 0.012, 0.09 - z), 0.003);
  return Math.max(smin(smin(chin, stache, 0.004), corners, 0.004), -lipsOut);
}

const BEARD_THICK = {
  stubble: () => 0.0005,
  goatee: (x, y) => 0.003 + 0.0025 * sstep(MOUTH.y - 0.01, 1.52, y),
  beard: (x, y, z) => 0.0034 + 0.0038 * sstep(1.585, 1.535, y) * sstep(0.075, 0.02, Math.abs(x)) + 0.001 * sstep(0.02, 0.07, z) * sstep(1.56, 1.52, y),
};
const BEARD_TAPER = { stubble: 0.005, goatee: 0.011, beard: 0.014 };

export const FACIAL_HAIR_STYLES = ["stubble", "goatee", "beard"];

/** Facial hair over one face shape (and the top of the neck under the jaw). */
export function beardD(style, face, x, y, z) {
  if (y > 1.64 || y < 1.47 || z < -0.06 || Math.abs(x) > 0.13) return 0.05;
  const skin = Math.min(headD(face, x, y, z), y < 1.56 ? bodyD(x, y, z) : 1);
  const region = beardRegion(style, x, y, z);
  const ramp = sstep(0, -BEARD_TAPER[style], region);
  const t = 0.0011 + (BEARD_THICK[style](x, y, z) - 0.0011) * ramp;
  let d = smax(skin - t, region, style === "stubble" ? 0.002 : 0.003);
  if (style !== "stubble") {
    const n = noise3(x * 160, y * 90, z * 160);
    d -= 0.0009 * n * sstep(0.0025, 0.006, t);
  }
  return smax(d, -(skin + 0.0002), 0.0006);
}

export const BEARD_BOX = [[-0.13, 1.47, -0.06], [0.13, 1.64, 0.15]];

/** Eyes stay clear of everything. */
export const eyeClear = (x, y, z) => Math.hypot(Math.abs(x) - EYE.x, y - EYE.y, z - EYE.z) - (EYE.r + 0.004);
void clamp;

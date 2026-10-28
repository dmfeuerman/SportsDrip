/**
 * Garment templates. A template is a silhouette; catalog items pick a
 * template and colours, so "MVP Jersey" and "Flame Jersey" share one model.
 *
 * Skinned clothing is the body's own surface pushed out by a layer offset and
 * cut to a region (sleeve ends, hems, necklines), so it follows the real
 * silhouette and takes the body's skin weights. Headwear is fitted to the
 * shared fit volumes in fit.mjs. Rigid wearables are authored in their
 * socket's space (rig.SOCKETS) and placed by their attachment (attachments.mjs).
 *
 * Part kinds:
 *   cloth(material, field, box, opts)   skinned, meshed from a distance field
 *   rigid(material, field, box, opts)   on the template's socket, meshed from a field
 *   built(material, build, opts)        on the socket, built from primitives (MeshBuilder)
 *
 * Material names are the tint contract the runtime understands: primary,
 * secondary, primary_dark, secondary_dark, metal, lens, sole, laces, plastic.
 */
import { LAYER_OFFSET as L, REST, sideBone as B } from "./rig.mjs";
import { bodyD, drapeD, EAR_C, EYE, faceSurfaceZ, headD, limbParam, PARTS } from "./character.mjs";
import { arm, leg, sgn } from "./anatomy.mjs";
import { coverage, CUP, cupCentre, edgeAngle, HAT_FIT, hatInnerD, polar, R_MEAN, scalpD } from "./fit.mjs";
import { noise3 } from "./hair.mjs";
import { ellipsoid, torus, tube } from "./geometry.mjs";
import { clamp, gauss, sdCone, sdEllipsoid, sdRoundBox, smax, smin, sstep } from "./sdf.mjs";

const SIDES = ["L", "R"];
const lerp = (a, b, t) => a + (b - a) * t;

const cloth = (material, field, box, opts = {}) => ({ material, kind: "skinned", field, box, h: opts.h ?? 0.0026, keep: opts.keep ?? null, ao: opts.ao ?? true, error: opts.error ?? 0.0004, tris: opts.tris ?? 12000, look: opts.look ?? null });
const rigid = (material, field, box, opts = {}) => ({ material, kind: "rigid", field, box, h: opts.h ?? 0.0012, keep: opts.keep ?? null, ao: opts.ao ?? true, error: opts.error ?? 0.0003, tris: opts.tris ?? 7000, look: opts.look ?? null });
const built = (material, build, opts = {}) => ({ material, kind: "built", build, skinned: opts.skinned ?? false });

/* ── regions (negative inside the garment) ───────────────────────────────── */

const ARM_LEN = arm("L").arcLength;
const LEG_LEN = leg("L").arcLength;

/** Signed distance along an arm past parameter t1 (positive = beyond, i.e. cut), for points on an arm. */
function armPast(t1, x, y, z, slack = 0) {
  for (const s of SIDES) {
    if (sgn(s) * x < 0.1 || y < 0.7) continue;
    const p = limbParam("arm", s, x, y, z);
    if (p.t < 0 || p.d > PARTS.torsoD(x, y, z) + slack) continue;
    return (p.t - t1) * ARM_LEN;
  }
  return -1;
}

/** Same for the legs (t: 0 hip → 1 ankle). */
function legPast(t1, x, y, z) {
  for (const s of SIDES) {
    if (sgn(s) * x < -0.02 || y > 1.0) continue;
    const p = limbParam("leg", s, x, y, z);
    if (p.t < 0 || p.t < 0.08) continue;
    return (p.t - t1) * LEG_LEN;
  }
  return -1;
}

/** Arm parameter for points on an arm, else -1. */
function armT(x, y, z) {
  for (const s of SIDES) {
    if (sgn(s) * x < 0.1 || y < 0.7) continue;
    const p = limbParam("arm", s, x, y, z);
    if (p.t >= 0 && p.d < PARTS.torsoD(x, y, z)) return p.t;
  }
  return -1;
}
function legT(x, y, z) {
  for (const s of SIDES) {
    if (sgn(s) * x < -0.02 || y > 1.02) continue;
    const p = limbParam("leg", s, x, y, z);
    if (p.t >= 0.06) return p.t;
  }
  return -1;
}

/**
 * Neck opening: a soft cylinder around the neck, open above `front` at the
 * front and `back` at the back. `vee` deepens it to a V at the front.
 * Returns a region term (positive inside the opening = no cloth).
 */
function neckOpening({ r = 0.07, front = 1.42, back = 1.45, vee = 0 }, x, y, z) {
  const zc = -0.012;
  const radial = Math.hypot(x, (z - zc) * 0.92);
  const fz = sstep(-0.06, 0.06, z);
  let yOpen = lerp(back, front, fz);
  if (vee) yOpen = Math.min(yOpen, front - vee + 1.6 * Math.abs(x)) * fz + yOpen * (1 - fz);
  return -Math.max(radial - r, yOpen - y);
}

/** Distance of a point from the edge of a neck opening (for collar bands). */
function collarBand(o, x, y, z, width) {
  return Math.abs(neckOpening(o, x, y, z)) - width;
}

/** A top's offset: `off`, plus the waist allowance as it comes down over the bottoms' waistband. */
const overWaist = (off) => (x, y, z) => off + L.waist * sstep(1.06, 0.99, y);

/** A garment field: the body pushed out by `off`, intersected with `region`. */
function inflate(off, region, { hands = false, feet = false, k = 0.004, detail = null, drape = drapeD } = {}) {
  return (x, y, z) => {
    const r = region(x, y, z);
    if (r > 0.03) return r; // far outside the region: cheap early out
    const o = typeof off === "function" ? off(x, y, z) : off;
    let b = bodyD(x, y, z, { hands, feet });
    if (drape) b = smin(b, drape(x, y, z), 0.01);
    let d = b - o;
    if (detail) d -= detail(x, y, z);
    return smax(d, r, k);
  };
}

/** Rib knit: fine grooves around a cuff or band. */
const rib = (x, z, n = 70, depth = 0.0008) => depth * Math.abs(Math.sin(Math.atan2(x, z) * n));
/** Gentle fabric folds, so cloth doesn't read as painted on. */
const folds = (x, y, z, amp = 0.0011, f = 38) => amp * noise3(x * f, y * f * 0.7, z * f);

const TOP_BOX = [[-0.5, 0.82, -0.19], [0.5, 1.56, 0.21]];
const BOTTOM_BOX = [[-0.25, 0.0, -0.2], [0.25, 1.06, 0.2]];
const SHOE_BOX = [[-0.22, -0.01, -0.14], [0.22, 0.22, 0.25]];

/* ── tops ────────────────────────────────────────────────────────────────── */

const CREW = { r: 0.086, front: 1.402, back: 1.452 };

function torsoAndSleeves({ off, hem, sleeve, neck, extra = null }) {
  return (x, y, z) => {
    let r = hem - y;
    r = Math.max(r, neckOpening(neck, x, y, z));
    if (sleeve !== null) r = Math.max(r, armPast(sleeve, x, y, z));
    if (extra) r = Math.max(r, extra(x, y, z));
    return r;
  };
}

function sleeveBand(t0, t1, x, y, z) {
  const t = armT(x, y, z);
  if (t < 0) return 1;
  return Math.max((t0 - t) * ARM_LEN, (t - t1) * ARM_LEN);
}

const tee = (off, hem, sleeve) =>
  inflate(off, torsoAndSleeves({ off, hem, sleeve, neck: CREW }), { detail: (x, y, z) => folds(x, y, z) - 0.002 * sstep(sleeve * 0.75, sleeve, Math.max(0, armT(x, y, z))) * 0 });

/* Jersey: sleeveless, deep armholes, V-neck, side panels and a number. */
const JERSEY_NECK = { r: 0.09, front: 1.4, back: 1.452, vee: 0.075 };
function armhole(x, y, z) {
  if (armT(x, y, z) >= 0) return 0.01;
  if (y < 1.12) return -1;
  const sx = Math.abs(x);
  const xa = 0.13 + 0.03 * sstep(1.22, 1.42, y) - 0.012 * gauss(y, 1.26, 0.04);
  return sx - xa;
}
/** "10" in chunky block digits on the chest and back: 2D field in (u, v) metres. */
function numberD(u, v) {
  const seg = (cx, cy, hx, hy) => sdRoundBox(u - cx, v - cy, 0, hx, hy, 1, 0.006);
  const one = Math.min(seg(-0.042, 0, 0.0095, 0.052), seg(-0.052, 0.04, 0.012, 0.009));
  const zero = Math.max(seg(0.03, 0, 0.034, 0.052), -sdRoundBox(u - 0.03, v, 0, 0.014, 0.032, 1, 0.006));
  return Math.min(one, zero);
}
const jerseyRegion = (x, y, z) => Math.max(0.915 - y, neckOpening(JERSEY_NECK, x, y, z), armhole(x, y, z));
const sidePanel = (x, y, z) => Math.abs(z - 0.0) - 0.035 - 0.012 * sstep(1.2, 0.95, y);

/* Hoodie: hood behind the neck, kangaroo pocket, drawstrings, ribbed cuffs and hem. */
const HOOD_NECK = { r: 0.094, front: 1.42, back: 1.465 };
function hoodD(x, y, z) {
  // A soft fold of fabric lying around the back and sides of the neck.
  const c = [0, 1.475, -0.07];
  let d = Math.abs(sdEllipsoid(x - c[0], y - c[1], z - c[2], 0.125, 0.07, 0.08)) - 0.007;
  d = smax(d, z - (0.03 - 0.06 * sstep(0.12, 0.0, Math.abs(x))), 0.01); // open at the front
  d = smax(d, -(bodyD(x, y, z) - 0.012), 0.006);
  d = smax(d, -(scalpD(x, y, z) - 0.004), 0.006);
  return d;
}
function pocketRegion(x, y, z) {
  if (z < 0) return 1;
  const ax = Math.abs(x);
  const top = 1.075 - 0.0, bot = 0.945;
  const w = 0.11 - 0.035 * sstep(bot + 0.03, top, y); // slanted hand openings
  return Math.max(ax - w, y - top, bot - y);
}

/* ── outerwear ───────────────────────────────────────────────────────────── */

const JACKET_NECK = { r: 0.1, front: 1.425, back: 1.46 };
const zipLine = (x, y, z) => Math.max(Math.abs(x) - 0.004, -z);

function standCollar(off, height = 0.035) {
  // A band of rib knit standing around the neck opening.
  return (x, y, z) => {
    const o = JACKET_NECK;
    const zc = -0.012;
    const radial = Math.hypot(x, (z - zc) * 0.92);
    const fz = sstep(-0.06, 0.06, z);
    const y0 = lerp(o.back, o.front, fz);
    const ring = Math.abs(radial - (o.r + off * 0.6)) - 0.0055;
    let d = Math.max(ring, y0 - 0.012 - y, y - (y0 + height));
    d = smax(d, -(bodyD(x, y, z) - 0.004), 0.004);
    return d - rib(x, z, 90, 0.0007);
  };
}

const quilt = (y, pitch = 0.062, depth = 0.0075) => depth * (1 - Math.pow(Math.abs(Math.cos((Math.PI * y) / pitch)), 0.35));

/* ── bottoms ─────────────────────────────────────────────────────────────── */

const WAIST = 1.005;
/** Bottoms hang from the hips but don't web across the crotch: drape only above it. */
const hipDrape = (x, y, z) => (y > 0.93 ? drapeD(x, y, z) : 0.1);
function bottomsRegion(legEnd, waist = WAIST) {
  return (x, y, z) => Math.max(y - waist, legPast(legEnd, x, y, z));
}
function legBand(t0, t1, x, y, z) {
  const t = legT(x, y, z);
  if (t < 0) return 1;
  return Math.max((t0 - t) * LEG_LEN, (t - t1) * LEG_LEN);
}
/** Outer side of a leg: positive away from the stripe. */
function legStripe(x, y, z, half = 0.009) {
  for (const s of SIDES) {
    if (sgn(s) * x < 0.02) continue;
    const p = limbParam("leg", s, x, y, z);
    if (p.t < 0) continue;
    const c = leg(s)(clamp(p.t, 0, 1)).c;
    const a = Math.atan2(z - c.z, (x - c.x) * sgn(s)); // 0 = straight out to the side
    return Math.abs(a) * 0.08 - half;
  }
  return 1;
}

/* ── shoes ───────────────────────────────────────────────────────────────── */

const footLocal = (s, x, y, z) => [(x - REST[B("Foot", s)][0]) * sgn(s), y, z]; // lx: + outward

function shoeUpper(s, x, y, z, collar) {
  const [lx] = footLocal(s, x, y, z);
  let foot = PARTS.footD(s, x, y, z);
  // The ankle, so the collar wraps it.
  const lg = limbParam("leg", s, x, y, z);
  if (lg.t > 0.8) foot = smin(foot, lg.d + 0.003, 0.03);
  // Toe box: a touch fuller and rounder than the foot.
  foot = smin(foot, sdEllipsoid(lx - 0.002, y - 0.036, z - 0.13, 0.052, 0.034, 0.06), 0.02);
  let d = foot - L.shoes;
  d = smax(d, y - collar(z), 0.012);
  // The sole carries the bottom 2.4 cm (more at the toe spring).
  d = smax(d, 0.022 + 0.01 * sstep(0.12, 0.2, z) - y, 0.004);
  return d;
}

const upperTop = new Map();
/** Height of a shoe upper's top surface at (x, z) — where laces sit. */
function upperY(s, z, collar) {
  const key = `${s}:${z.toFixed(4)}:${collar}`;
  if (upperTop.has(key)) return upperTop.get(key);
  const x = REST[B("Foot", s)][0] - sgn(s) * 0.002;
  const c = collar === "high" ? () => 0.2 : () => 0.13;
  let y = 0.22;
  for (let i = 0; i < 400; i++) {
    const d = shoeUpper(s, x, y, z, c);
    if (d < 0.0002) break;
    y -= Math.max(0.0003, d * 0.8);
  }
  upperTop.set(key, y);
  return y;
}

function soleD(s, x, y, z) {
  const [lx] = footLocal(s, x, y, z);
  const spring = 0.012 * sstep(0.11, 0.2, z) + 0.004 * sstep(-0.03, -0.09, z);
  const yy = y - spring;
  // Footprint: the foot's outline at ankle height, a little wider.
  const print = PARTS.footD(s, x, 0.03, z) * 0.9 - 0.0155;
  let d = smax(print, Math.abs(yy - 0.0135) - 0.0135, 0.005);
  d -= 0.0012 * sstep(0.004, 0.0, Math.abs(yy - 0.02)); // midsole line
  void lx;
  return d;
}

function lacesD(s, x, y, z, from, to, n, collar = "low") {
  const cx = REST[B("Foot", s)][0] - sgn(s) * 0.002;
  let d = 1;
  for (let i = 0; i < n; i++) {
    const zz = lerp(from, to, i / (n - 1));
    const yy = upperY(s, zz, collar) + 0.0012;
    // Each bar follows the instep's slope a little.
    d = Math.min(d, sdRoundBox(x - cx, y - yy - 0.18 * (z - zz), z - zz, 0.018, 0.0026, 0.0042, 0.0024));
  }
  return d;
}

function shoeStripe(s, x, y, z) {
  const [lx] = footLocal(s, x, y, z);
  if (Math.abs(lx) < 0.02) return 1;
  // Two parallel slanted bands on each side of the shoe.
  const u = z + 0.55 * (y - 0.03);
  const a = Math.abs(u - 0.035) - 0.0075;
  const b = Math.abs(u - 0.062) - 0.0075;
  return Math.max(Math.min(a, b), 0.022 - y, y - 0.085);
}

/* ── headwear ────────────────────────────────────────────────────────────── */

/** A hat shell: from the fit mode's inner surface out by `thick`, inside its coverage, rounded at the edge. */
function hatShell(mode, thick, { extra = 0 } = {}) {
  return (x, y, z) => {
    const { u, v } = coverage(mode, x, y, z);
    const inner = scalpD(x, y, z) - HAT_FIT[mode].hatGap(v);
    const t = thick + (typeof extra === "function" ? extra(x, y, z, v) : extra);
    const d = Math.max(inner - t, -inner);
    return smax(d, -u, 0.0025);
  };
}

/** Polar angle of the cap's front edge, for the brim. */
const CAP = HAT_FIT.capped;
function capBrimD(x, y, z) {
  if (z < 0.0 || y < 1.6 || y > 1.78) return 0.05;
  // The brim leaves the front edge of the crown, pitched down ~13°, curved down at the sides.
  // Its root sits inside the crown's front wall, just above the wall's lower edge, so crown and
  // brim meet with no forehead showing between them (the root used to sit ~1.5 cm below a
  // higher crown edge, leaving a window onto the forehead).
  const e = edgeAngle(CAP.edge, 0);
  const [cx, cy, cz] = [0, 1.648, 0.004];
  const edgeY = cy + 0.127 * Math.cos(e) + 0.004;
  const rootZ = cz + 0.115 * Math.sin(e);
  const pitch = Math.tan(0.24);
  const curl = 3.4;
  const plane = y - (edgeY - pitch * Math.max(0, z - rootZ) - curl * x * x * sstep(0.04, 0.12, z + 0.04));
  const thick = Math.abs(plane) - 0.0034;
  // Outline: a D-shape — the crown's front at the back, an ellipse at the front.
  const reach = Math.hypot(x / 0.102, (z - 0.088) / 0.118) - 1;
  const inner = -(scalpD(x, y, z) - CAP.hatGap(1) - 0.002);
  const outline = Math.max(reach * 0.09, -z + 0.05);
  return smax(smax(thick, outline, 0.004), inner, 0.003) + 0 * (cx + cz);
}

/* ── fabric textures (normal-map detail, bake.mjs) ───────────────────────── */

/** Around-the-body arc coordinate for patterns: metres along the surface, roughly. */
const around = (x, z) => Math.atan2(x, z + 0.012) * 0.14;
const TEXTURE = {
  /** Plain cotton jersey: a faint irregular slub. */
  cotton: (x, y, z) => 0.00009 * noise3(x * 260, y * 260, z * 260),
  /** Athletic mesh: a grid of small perforations. */
  mesh: (x, y, z) => {
    const p = 0.0048;
    const u = around(x, z) / p, v = y / p + 0.5 * (Math.round(around(x, z) / p) & 1);
    const d = Math.hypot(u - Math.round(u), v - Math.round(v)) * p;
    return -0.00045 * sstep(0.0013, 0.0007, d);
  },
  /** Brushed fleece: soft, uneven pile. */
  fleece: (x, y, z) => 0.00016 * noise3(x * 220, y * 220, z * 220),
  /** Nylon shell: fine crinkles. */
  nylon: (x, y, z) => 0.00018 * (noise3(x * 140, y * 90, z * 140) + 0.5 * noise3(x * 300 + 3, y * 300, z * 300)),
  /** Twill (denim, canvas): diagonal wales. */
  twill: (x, y, z) => 0.00012 * Math.sin((2 * Math.PI * (around(x, z) * 0.8 + y)) / 0.0045) + 0.00006 * noise3(x * 300, y * 300, z * 300),
  /** Knit: rows of stitches over the ribs. */
  knit: (x, y, z) => 0.00028 * Math.abs(Math.sin((Math.PI * y) / 0.0042 + 1.4 * Math.abs(Math.sin(Math.atan2(x, z) * 56)))),
};

/* ── the templates ───────────────────────────────────────────────────────── */

/**
 * `hides`: body regions the garment covers completely, so the runtime stops
 * drawing that skin (measured by `fitcheck.mjs --hides`, which also fails the
 * build if a garment stops covering a region it claims).
 */
export const TEMPLATES = {
  /* ── tops ── */
  top_tee: {
    slot: "top",
    hides: ["chest", "abdomen"],
    look: "cotton",
    texture: TEXTURE.cotton,
    parts: [
      cloth("primary", inflate(overWaist(L.top), torsoAndSleeves({ hem: 0.925, sleeve: 0.33, neck: CREW }), { detail: folds }), TOP_BOX),
      cloth("secondary", inflate(L.top + L.trim, (x, y, z) => Math.max(collarBand(CREW, x, y, z, 0.0075), -neckOpening(CREW, x, y, z))), TOP_BOX, { h: 0.0018 }),
      cloth("secondary", inflate(L.top + L.trim, (x, y, z) => sleeveBand(0.305, 0.33, x, y, z)), TOP_BOX, { h: 0.002 }),
    ],
  },
  top_longsleeve: {
    slot: "top",
    hides: ["chest", "abdomen"],
    look: "cotton",
    texture: TEXTURE.cotton,
    parts: [
      cloth("primary", inflate(overWaist(L.top), torsoAndSleeves({ hem: 0.925, sleeve: 0.95, neck: CREW }), { detail: (x, y, z) => folds(x, y, z) + 0.0012 * gauss(armT(x, y, z), 0.55, 0.05) * Math.sin(y * 260) }), TOP_BOX),
      cloth("secondary", inflate(L.top + L.trim, (x, y, z) => Math.max(collarBand(CREW, x, y, z, 0.0075), -neckOpening(CREW, x, y, z))), TOP_BOX, { h: 0.0018 }),
      cloth("secondary", inflate(L.top + L.trim, (x, y, z) => sleeveBand(0.89, 0.95, x, y, z), { detail: (x, y, z) => -rib(x - 0.3 * Math.sign(x), z, 50, 0.0006) }), TOP_BOX, { h: 0.002 }),
    ],
  },
  top_jersey: {
    slot: "top",
    hides: [],
    look: "mesh",
    texture: TEXTURE.mesh,
    parts: [
      cloth("primary", inflate(overWaist(L.top + 0.003), (x, y, z) => Math.max(jerseyRegion(x, y, z), -sidePanel(x, y, z)), { detail: folds }), TOP_BOX),
      cloth("secondary", inflate(overWaist(L.top + 0.003), (x, y, z) => Math.max(jerseyRegion(x, y, z), sidePanel(x, y, z))), TOP_BOX),
      // Trim around the neck and armholes.
      cloth("secondary", inflate(L.top + 0.003 + L.trim, (x, y, z) => Math.max(Math.min(Math.abs(neckOpening(JERSEY_NECK, x, y, z)) - 0.008, Math.abs(armhole(x, y, z)) - 0.008), 0.915 - y, neckOpening(JERSEY_NECK, x, y, z), armhole(x, y, z))), TOP_BOX, { h: 0.0018 }),
      // Number, front and back.
      cloth("secondary", inflate(L.top + 0.003 + L.trim, (x, y, z) => {
        if (Math.abs(z) < 0.04) return 1;
        const u = z > 0 ? x : -x; // reads left-to-right from the front, and from behind
        return Math.max(numberD(u, y - (z > 0 ? 1.205 : 1.24)), jerseyRegion(x, y, z));
      }), [[-0.13, 1.1, -0.2], [0.13, 1.33, 0.2]], { h: 0.0016 }),
    ],
  },
  top_hoodie: {
    slot: "top",
    hides: ["chest", "abdomen", "waist"],
    look: "fleece",
    texture: TEXTURE.fleece,
    parts: [
      cloth("primary", inflate(overWaist(L.top + 0.005), torsoAndSleeves({ hem: 0.9, sleeve: 0.915, neck: HOOD_NECK }), { detail: (x, y, z) => folds(x, y, z, 0.0016, 30) }), TOP_BOX),
      cloth("primary", hoodD, [[-0.17, 1.38, -0.17], [0.17, 1.58, 0.06]], { h: 0.0022 }),
      cloth("primary_dark", inflate(overWaist(L.top + 0.005 + L.trim + 0.001), (x, y, z) => Math.max(pocketRegion(x, y, z), 0.9 - y)), [[-0.15, 0.92, 0.0], [0.15, 1.1, 0.18]], { h: 0.002 }),
      cloth("primary_dark", inflate(L.top + 0.005 + L.trim, (x, y, z) => sleeveBand(0.865, 0.92, x, y, z), { detail: (x, y, z) => -rib(x - 0.3 * Math.sign(x), z, 50, 0.0007) }), TOP_BOX, { h: 0.002 }),
      cloth("primary_dark", inflate(overWaist(L.top + 0.005 + L.trim), (x, y, z) => Math.max(y - 0.935, 0.895 - y, neckOpening(HOOD_NECK, x, y, z)), { detail: (x, y, z) => -rib(x, z, 120, 0.0007) }), [[-0.22, 0.86, -0.17], [0.22, 0.97, 0.18]], { h: 0.002 }),
      built("secondary", (b) => {
        for (const s of [1, -1]) {
          const x = 0.03 * s;
          const z0 = 0.075;
          const pts = [[x, 1.425, z0], [x * 1.05, 1.36, z0 + 0.03], [x * 1.1, 1.3, z0 + 0.04]].map((p) => onCloth(p, L.top + 0.005 + L.trim + 0.001));
          tube(b, pts.map((c) => ({ c, rx: 0.0032, rz: 0.0032, w: { Spine2: 1 } })), { steps: 6, radial: 8, capEnd: true });
          ellipsoid(b, { c: pts[2].map((v, i) => v + [0, -0.008, 0.001][i]), r: [0.004, 0.009, 0.004], rows: 6, cols: 10, w: { Spine2: 1 } });
        }
      }, { skinned: true }),
    ],
  },

  /* ── outerwear ── */
  outerwear_bomber: {
    slot: "outerwear",
    hides: ["chest"],
    look: "nylon",
    texture: TEXTURE.nylon,
    parts: [
      cloth("primary", inflate(L.outer, torsoAndSleeves({ hem: 0.955, sleeve: 0.91, neck: JACKET_NECK }), { detail: (x, y, z) => folds(x, y, z, 0.0022, 26) + 0.004 * sstep(0.2, 0.6, Math.max(0, armT(x, y, z))) }), TOP_BOX, { h: 0.003 }),
      cloth("primary_dark", inflate(L.outer + 0.004, (x, y, z) => Math.max(y - 0.975, 0.93 - y), { detail: (x, y, z) => -rib(x, z, 110, 0.0009) }), [[-0.24, 0.9, -0.19], [0.24, 1.0, 0.2]], { h: 0.0022 }),
      cloth("primary_dark", inflate(L.outer + L.trim, (x, y, z) => sleeveBand(0.87, 0.93, x, y, z), { detail: (x, y, z) => -rib(x - 0.3 * Math.sign(x), z, 50, 0.0008) }), TOP_BOX, { h: 0.0022 }),
      cloth("primary_dark", standCollar(L.outer), [[-0.13, 1.39, -0.12], [0.13, 1.52, 0.12]], { h: 0.0018 }),
      cloth("metal", inflate(L.outer + L.trim, (x, y, z) => Math.max(zipLine(x, y, z), 0.95 - y, y - 1.46)), [[-0.02, 0.92, 0.05], [0.02, 1.48, 0.2]], { h: 0.0012 }),
      // Utility pocket on the left sleeve.
      cloth("primary_dark", inflate(L.outer + 0.0045, (x, y, z) => {
        if (x < 0.15) return 1;
        const t = armT(x, y, z);
        if (t < 0) return 1;
        return Math.max(Math.abs(t - 0.24) * ARM_LEN - 0.03, Math.abs(z - 0.0) - 0.024);
      }), [[0.15, 1.15, -0.08], [0.32, 1.38, 0.08]], { h: 0.0018 }),
    ],
  },
  outerwear_varsity: {
    slot: "outerwear",
    hides: ["shoulders", "chest", "abdomen", "elbows"],
    look: "suede",
    parts: [
      cloth("primary", inflate(L.outer, (x, y, z) => Math.max(torsoAndSleeves({ hem: 0.955, sleeve: 0.91, neck: JACKET_NECK })(x, y, z), armT(x, y, z) >= 0.03 ? 0.02 : -1), { detail: (x, y, z) => folds(x, y, z, 0.0018, 26) }), TOP_BOX, { h: 0.003 }),
      cloth("secondary", inflate(L.outer - 0.001, (x, y, z) => Math.max(armT(x, y, z) >= 0.03 ? -1 : 0.02, armPast(0.91, x, y, z)), { detail: (x, y, z) => folds(x, y, z, 0.0018, 26) }), TOP_BOX, { h: 0.003, look: "leather" }),
      cloth("primary_dark", inflate(L.outer + 0.004, (x, y, z) => Math.max(y - 0.975, 0.93 - y), { detail: (x, y, z) => -rib(x, z, 110, 0.0009) - 0.0016 * gauss(y, 0.953, 0.0035) }), [[-0.24, 0.9, -0.19], [0.24, 1.0, 0.2]], { h: 0.0018 }),
      cloth("primary_dark", inflate(L.outer + L.trim, (x, y, z) => sleeveBand(0.87, 0.93, x, y, z), { detail: (x, y, z) => -rib(x - 0.3 * Math.sign(x), z, 50, 0.0008) }), TOP_BOX, { h: 0.0022 }),
      cloth("primary_dark", standCollar(L.outer, 0.028), [[-0.13, 1.39, -0.12], [0.13, 1.52, 0.12]], { h: 0.0018 }),
      // Snaps down the front.
      cloth("metal", inflate(L.outer + 0.004, (x, y, z) => {
        if (z < 0.05) return 1;
        let d = 1;
        for (let i = 0; i < 5; i++) d = Math.min(d, Math.hypot(x, y - (1.0 + i * 0.09)) - 0.0065);
        return d;
      }), [[-0.02, 0.97, 0.05], [0.02, 1.4, 0.2]], { h: 0.001 }),
      // Felt chest patch.
      cloth("secondary", inflate(L.outer + 0.004, (x, y, z) => (z < 0.03 ? 1 : sdRoundBox(x - 0.075, y - 1.27, 0, 0.032, 0.036, 1, 0.012))), [[0.02, 1.2, 0.03], [0.13, 1.34, 0.2]], { h: 0.0015 }),
    ],
  },
  outerwear_puffer: {
    slot: "outerwear",
    hides: ["chest"],
    look: "nylon",
    texture: TEXTURE.nylon,
    parts: [
      cloth("primary", inflate((x, y, z) => L.outer + 0.012 + 0.006 * sstep(1.0, 1.3, y), torsoAndSleeves({ hem: 0.94, sleeve: 0.9, neck: { r: 0.11, front: 1.43, back: 1.46 } }), {
        detail: (x, y, z) => {
          const t = armT(x, y, z);
          return t >= 0 ? -quilt(t * ARM_LEN, 0.07, 0.007) : -quilt(y);
        },
        k: 0.008,
      }), TOP_BOX, { h: 0.0032 }),
      // High collar.
      cloth("primary_dark", (x, y, z) => {
        const radial = Math.hypot(x, (z + 0.012) * 0.92);
        let d = Math.max(Math.abs(radial - 0.088) - 0.011, 1.415 - y, y - 1.525);
        d = smax(d, -(bodyD(x, y, z) - 0.006), 0.006);
        return d - quilt(y, 0.045, 0.004);
      }, [[-0.14, 1.38, -0.14], [0.14, 1.55, 0.14]], { h: 0.0022 }),
      cloth("primary_dark", inflate(L.outer + 0.012 + L.trim, (x, y, z) => sleeveBand(0.88, 0.925, x, y, z), { detail: (x, y, z) => -rib(x - 0.3 * Math.sign(x), z, 50, 0.0008) }), TOP_BOX, { h: 0.0022 }),
      cloth("metal", inflate(L.outer + 0.0215, (x, y, z) => Math.max(zipLine(x, y, z), 0.945 - y, y - 1.5)), [[-0.02, 0.92, 0.05], [0.02, 1.52, 0.22]], { h: 0.0012 }),
    ],
  },

  /* ── bottoms ── */
  bottom_shorts: {
    slot: "bottom",
    hides: ["hips"],
    look: "mesh",
    texture: TEXTURE.mesh,
    parts: [
      cloth("primary", inflate((x, y, z) => L.bottom + 0.004 + 0.02 * sstep(0.12, 0.5, Math.max(0, legT(x, y, z))), bottomsRegion(0.5, WAIST - 0.02), { drape: hipDrape, detail: (x, y, z) => folds(x, y, z, 0.0016, 30) }), BOTTOM_BOX),
      cloth("secondary", inflate(L.bottom + 0.004 + L.trim, (x, y, z) => Math.max(y - WAIST, WAIST - 0.035 - y), { drape: hipDrape, detail: (x, y, z) => -rib(x, z, 100, 0.0006) }), [[-0.22, 0.94, -0.17], [0.22, 1.03, 0.17]], { h: 0.0018 }),
      cloth("secondary", inflate((x, y, z) => L.bottom + 0.004 + L.trim + 0.02 * sstep(0.12, 0.5, Math.max(0, legT(x, y, z))), (x, y, z) => Math.max(legStripe(x, y, z, 0.007), bottomsRegion(0.5, WAIST - 0.03)(x, y, z), legT(x, y, z) < 0.07 ? 0.01 : -1), { drape: hipDrape }), BOTTOM_BOX, { h: 0.0018 }),
    ],
  },
  bottom_pants: {
    slot: "bottom",
    hides: ["hips", "thighs", "knees"],
    look: "canvas",
    texture: TEXTURE.twill,
    parts: [
      cloth("primary", inflate((x, y, z) => L.bottom + 0.006 + 0.008 * sstep(0.3, 0.9, Math.max(0, legT(x, y, z))), bottomsRegion(0.965, WAIST - 0.02), { drape: hipDrape, detail: (x, y, z) => folds(x, y, z, 0.0018, 30) + 0.0008 * gauss(legT(x, y, z), 0.53, 0.05) * Math.sin(y * 160 + 4 * noise3(x * 30, 0, z * 30)) }), BOTTOM_BOX, { h: 0.0028 }),
      // Belt with a buckle.
      cloth("secondary_dark", inflate(L.bottom + 0.006 + L.trim, (x, y, z) => Math.max(y - WAIST, WAIST - 0.03 - y), { drape: hipDrape }), [[-0.22, 0.95, -0.17], [0.22, 1.03, 0.17]], { h: 0.0018 }),
      cloth("metal", inflate(L.bottom + 0.006 + L.trim + 0.002, (x, y, z) => (z < 0.05 ? 1 : Math.max(sdRoundBox(x, y - (WAIST - 0.015), 0, 0.022, 0.017, 1, 0.003), -sdRoundBox(x, y - (WAIST - 0.015), 0, 0.014, 0.009, 1, 0.002)))), [[-0.04, 0.96, 0.05], [0.04, 1.03, 0.17]], { h: 0.001 }),
      // Cargo pockets.
      cloth("secondary", inflate((x, y, z) => L.bottom + 0.0115 + 0.008 * sstep(0.3, 0.9, Math.max(0, legT(x, y, z))), (x, y, z) => {
        const t = legT(x, y, z);
        if (t < 0) return 1;
        return Math.max(Math.abs(t - 0.36) * LEG_LEN - 0.065, legStripe(x, y, z, 0.03));
      }, { drape: null, detail: (x, y, z) => -0.0012 * sstep(0.004, 0, Math.abs(y - 0.775)) }), BOTTOM_BOX, { h: 0.002 }),
    ],
  },
  bottom_joggers: {
    slot: "bottom",
    hides: ["hips", "thighs", "knees"],
    look: "fleece",
    texture: TEXTURE.fleece,
    parts: [
      cloth("primary", inflate((x, y, z) => L.bottom + 0.006 + 0.003 * sstep(0.1, 0.3, Math.max(0, legT(x, y, z))) - 0.007 * sstep(0.6, 0.93, Math.max(0, legT(x, y, z))), bottomsRegion(0.93, WAIST - 0.02), { drape: hipDrape, detail: (x, y, z) => folds(x, y, z, 0.0018, 30) + 0.0009 * sstep(0.75, 0.9, legT(x, y, z)) * Math.sin(y * 260) }), BOTTOM_BOX, { h: 0.0028 }),
      cloth("secondary", inflate(L.bottom + 0.012, (x, y, z) => legBand(0.9, 0.97, x, y, z), { drape: null, detail: (x, y, z) => -rib(x - 0.1 * Math.sign(x), z, 60, 0.0007) }), BOTTOM_BOX, { h: 0.002 }),
      cloth("secondary", inflate(L.bottom + 0.006 + L.trim, (x, y, z) => Math.max(y - WAIST, WAIST - 0.035 - y), { drape: hipDrape, detail: (x, y, z) => -rib(x, z, 100, 0.0006) }), [[-0.22, 0.94, -0.17], [0.22, 1.03, 0.17]], { h: 0.0018 }),
      cloth("secondary", inflate((x, y, z) => L.bottom + 0.006 + L.trim + 0.003 * sstep(0.1, 0.3, Math.max(0, legT(x, y, z))) - 0.007 * sstep(0.6, 0.93, Math.max(0, legT(x, y, z))), (x, y, z) => Math.max(legStripe(x, y, z, 0.006), bottomsRegion(0.9, WAIST - 0.035)(x, y, z), legT(x, y, z) < 0.07 ? 0.01 : -1), { drape: hipDrape }), BOTTOM_BOX, { h: 0.0018 }),
    ],
  },

  /* ── shoes ── */
  shoes_sneaker: {
    slot: "shoes",
    look: "leather",
    parts: [
      cloth("primary", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) d = Math.min(d, shoeUpper(s, x, y, z, (zz) => 0.098 + 0.03 * sstep(0.02, 0.1, zz) + 0.01 * sstep(-0.02, -0.06, zz)));
        return d - folds(x, y, z, 0.0006, 60);
      }, SHOE_BOX, { h: 0.0018 }),
      cloth("sole", (x, y, z) => Math.min(soleD("L", x, y, z), soleD("R", x, y, z)), SHOE_BOX, { h: 0.0018 }),
      cloth("secondary", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) {
          const up = shoeUpper(s, x, y, z, (zz) => 0.098 + 0.03 * sstep(0.02, 0.1, zz) + 0.01 * sstep(-0.02, -0.06, zz)) - 0.0018;
          d = Math.min(d, smax(up, shoeStripe(s, x, y, z), 0.002));
          // Heel tab.
          d = Math.min(d, smax(up - 0.001, Math.max(z + 0.035, -(z + 0.08), 0.06 - y, y - 0.112, Math.abs(x - REST[B("Foot", s)][0]) - 0.016), 0.002));
        }
        return d;
      }, SHOE_BOX, { h: 0.0015 }),
      cloth("laces", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) d = Math.min(d, lacesD(s, x, y, z, 0.035, 0.1, 4));
        return d;
      }, SHOE_BOX, { h: 0.001 }),
    ],
  },
  shoes_hightop: {
    slot: "shoes",
    hides: ["feet"],
    look: "canvas",
    texture: TEXTURE.twill,
    parts: [
      cloth("primary", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) d = Math.min(d, shoeUpper(s, x, y, z, (zz) => 0.175 - 0.012 * sstep(0.0, 0.06, zz) + 0.0 * zz));
        return d - folds(x, y, z, 0.0006, 60);
      }, SHOE_BOX, { h: 0.0018 }),
      cloth("sole", (x, y, z) => Math.min(soleD("L", x, y, z), soleD("R", x, y, z)), SHOE_BOX, { h: 0.0018 }),
      // Padded collar and an ankle strap.
      cloth("secondary", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) {
          const up = shoeUpper(s, x, y, z, () => 0.2) - 0.0035;
          d = Math.min(d, smax(up, Math.abs(y - 0.162) - 0.014 - 0.006 * sstep(0.0, 0.05, -z), 0.003));
          d = Math.min(d, smax(up + 0.0005, Math.abs(y - 0.122 - 0.25 * Math.max(0, z - 0.02)) - 0.011, 0.002));
          d = Math.min(d, smax(up - 0.0002, shoeStripe(s, x, y, z), 0.002));
        }
        return d;
      }, SHOE_BOX, { h: 0.0015 }),
      cloth("laces", (x, y, z) => {
        let d = 1;
        for (const s of SIDES) d = Math.min(d, lacesD(s, x, y, z, 0.02, 0.105, 5, "high"));
        return d;
      }, SHOE_BOX, { h: 0.001 }),
    ],
  },

  /* ── headwear (rigid, on the HeadTop socket) ── */
  hat_cap: {
    slot: "hat",
    look: "canvas",
    texture: TEXTURE.twill,
    hairMode: "capped",
    socket: "HeadTop",
    parts: [
      rigid("primary", (x, y, z) => {
        let d = hatShell("capped", 0.0034)(x, y, z);
        // Six panels: seams along meridians, and the snapback opening at the back.
        const { theta, phi } = polar(x, y, z);
        const seam = Math.abs(Math.sin(phi * 3)) ;
        d += 0.0009 * sstep(0.08, 0.0, seam) * sstep(0.15, 0.4, theta);
        const back = Math.abs(Math.atan2(Math.sin(phi - Math.PI), Math.cos(phi - Math.PI)));
        const above = (edgeAngle(CAP.edge, phi) - theta) * R_MEAN; // height above the back edge
        const opening = Math.hypot(back * R_MEAN * 0.95, Math.max(0, above - 0.006)) - 0.03;
        d = smax(d, -opening, 0.003);
        return d;
      }, [[-0.13, 1.6, -0.15], [0.13, 1.8, 0.14]], { h: 0.0011 }),
      rigid("secondary", capBrimD, [[-0.12, 1.6, 0.0], [0.12, 1.76, 0.22]], { h: 0.001 }),
      // Snapback strap across the opening, and the top button.
      rigid("secondary", (x, y, z) => {
        const { phi } = polar(x, y, z);
        const back = Math.abs(Math.atan2(Math.sin(phi - Math.PI), Math.cos(phi - Math.PI)));
        const { u } = coverage("capped", x, y, z);
        const band = Math.max(Math.abs(u + 0.0) - 0.0065, back * R_MEAN - 0.04);
        const inner = scalpD(x, y, z) - CAP.hatGap(1);
        let d = smax(band, Math.abs(inner - 0.002) - 0.0018, 0.002);
        const top = [0, 1.648 + 0.128 + CAP.hatGap(0) + 0.0034, 0.004];
        d = Math.min(d, sdEllipsoid(x - top[0], y - top[1], z - top[2], 0.0085, 0.004, 0.0085));
        return d;
      }, [[-0.08, 1.6, -0.15], [0.08, 1.8, 0.0]], { h: 0.001 }),
    ],
  },
  hat_beanie: {
    slot: "hat",
    look: "knit",
    texture: TEXTURE.knit,
    hairMode: "covered",
    socket: "HeadTop",
    parts: [
      rigid("primary", (x, y, z) => {
        let d = hatShell("covered", 0.0045, { extra: (x, y, z, v) => 0.011 * (1 - v) ** 2 })(x, y, z);
        d = smax(d, 0.012 - coverage("covered", x, y, z).u, 0.002); // starts under the cuff
        const { phi, theta } = polar(x, y, z);
        d += 0.0009 * Math.abs(Math.sin(phi * 28)) * sstep(0.2, 0.5, theta); // knit ribs
        return d;
      }, [[-0.14, 1.56, -0.15], [0.14, 1.8, 0.14]], { h: 0.0012, error: 0.0004, tris: 9000 }),
      // Folded cuff.
      rigid("secondary", (x, y, z) => {
        const { u, v } = coverage("covered", x, y, z);
        const inner = scalpD(x, y, z) - HAT_FIT.covered.hatGap(v);
        let d = Math.max(inner - 0.0095, -inner + 0.0025, u - 0.036, -u);
        d = smax(d, 0, 0) ;
        const { phi } = polar(x, y, z);
        d += 0.0008 * Math.abs(Math.sin(phi * 34));
        return d - 0.0016;
      }, [[-0.14, 1.56, -0.15], [0.14, 1.74, 0.14]], { h: 0.0012, error: 0.0004, tris: 5000 }),
    ],
  },
  hat_bucket: {
    slot: "hat",
    look: "canvas",
    texture: TEXTURE.twill,
    hairMode: "covered",
    socket: "HeadTop",
    parts: [
      rigid("primary", (x, y, z) => {
        // Crown: the fitted shell, carried up into a low, tapered crown (a straight-sided
        // drum read as a top hat).
        const { u, v } = coverage("covered", x, y, z);
        const inner = scalpD(x, y, z) - HAT_FIT.covered.hatGap(v);
        const r = 0.113 - 0.3 * Math.max(0, y - 1.715);
        const drum = Math.max(Math.hypot(x / 1.0, (z - 0.004) * 0.98) - r, y - 1.792);
        const outer = smin(inner - 0.004, drum, 0.03);
        let d = Math.max(outer, -inner, -u + 0.0);
        d = smax(d, -u, 0.002);
        // A stitched band around the base of the crown.
        d -= 0.0008 * sstep(0.004, 0, Math.abs(u - 0.02));
        return d;
      }, [[-0.14, 1.58, -0.15], [0.14, 1.82, 0.14]], { h: 0.0012 }),
      rigid("primary", (x, y, z) => {
        // Brim: a sloping ring from the crown's edge, 5.5 cm wide, pitched down ~28°.
        const { u } = coverage("covered", x, y, z);
        const { phi } = polar(x, y, z);
        const e = edgeAngle(HAT_FIT.covered.edge, phi);
        const ring = -u; // distance below the edge
        const slope = Math.tan(0.5);
        const edgeY = 1.648 + 0.128 * Math.cos(e);
        const r0 = Math.hypot(x, z - 0.004);
        const target = edgeY - slope * Math.max(0, r0 - 0.105) + 0.006;
        let d = Math.abs(y - target) - 0.0025;
        d = smax(d, r0 - 0.168, 0.004);
        d = smax(d, -(scalpD(x, y, z) - 0.006), 0.003);
        d = smax(d, ring - 0.07, 0.003);
        d = smax(d, -ring - 0.006, 0.003);
        return d;
      }, [[-0.18, 1.54, -0.19], [0.18, 1.72, 0.19]], { h: 0.0013 }),
    ],
  },
  hat_helmet: {
    slot: "hat",
    look: "plastic",
    hairMode: "helmet",
    socket: "HeadTop",
    parts: [
      rigid("primary", (x, y, z) => {
        const shell = hatShell("helmet", 0.007)(x, y, z);
        // Ear guards: the shell swells out over the ears, with a hole.
        let d = shell;
        for (const s of [1, -1]) {
          const c = EAR_C[s === 1 ? "L" : "R"];
          const e = sdEllipsoid(x - (c[0] + 0.012 * s), y - c[1], z - c[2], 0.034, 0.046, 0.04);
          d = smin(d, Math.max(e, -e - 0.007), 0.012);
          d = smax(d, -(Math.hypot(y - c[1], z - c[2]) - 0.012 + Math.max(0, -(x * s - 0.1)) * 10), 0.002);
        }
        d = smax(d, -(scalpD(x, y, z) - HAT_FIT.helmet.hatGap(1)), 0.002);
        // Vents on the top.
        const { phi, theta } = polar(x, y, z);
        for (const ph of [-0.5, 0, 0.5]) d = smax(d, -(Math.hypot(theta - 0.55, (phi - ph) * Math.sin(theta)) * R_MEAN - 0.006), 0.003);
        return d;
      }, [[-0.17, 1.52, -0.16], [0.17, 1.82, 0.15]], { h: 0.0013 }),
      // Short visor.
      rigid("secondary", (x, y, z) => {
        if (z < 0.0) return 0.05;
        const e = edgeAngle(HAT_FIT.helmet.edge, 0);
        const edgeY = 1.648 + 0.128 * Math.cos(e) - 0.002;
        const plane = y - (edgeY - Math.tan(0.18) * Math.max(0, z - 0.07) - 2.4 * x * x);
        let d = Math.abs(plane) - 0.0035;
        d = smax(d, Math.hypot(x / 0.1, (z - 0.06) / 0.075) - 1, 0.004);
        d = smax(d, -(scalpD(x, y, z) - HAT_FIT.helmet.hatGap(1) - 0.004), 0.003);
        return d;
      }, [[-0.12, 1.66, 0.0], [0.12, 1.76, 0.16]], { h: 0.001 }),
    ],
  },
  hat_crown: {
    slot: "hat",
    // Eight points, balls and a flared band: it needs more than a plain hat to keep its edges.
    tris: 2800,
    hairMode: null,
    socket: "HeadTop",
    // Sits on top of the hair, so its height comes from the hairstyle (attachments.mjs).
    parts: [
      rigid("metal", (x, y, z) => crownD(x, y, z), [[-0.1, 1.73, -0.1], [0.1, 1.86, 0.1]], { h: 0.0008 }),
      rigid("secondary", (x, y, z) => crownGemsD(x, y, z), [[-0.1, 1.73, -0.1], [0.1, 1.86, 0.1]], { h: 0.0006 }),
    ],
  },

  /* ── eyewear (Face socket) ── */
  eyewear_shades: {
    slot: "eyewear",
    look: "plastic",
    socket: "Face",
    parts: [
      rigid("lens", (x, y, z) => shadesLensD(x, y, z), [[-0.075, 1.6, 0.08], [0.075, 1.68, 0.16]], { h: 0.0007, ao: false }),
      rigid("primary", (x, y, z) => shadesFrameD(x, y, z), [[-0.125, 1.6, -0.06], [0.125, 1.69, 0.16]], { h: 0.0008 }),
    ],
  },

  /* ── accessories ── */
  acc_chain: {
    slot: "accessory",
    socket: "Neck",
    parts: [
      built("metal", (b) => chainLinks(b)),
      rigid("secondary", (x, y, z) => pendantD(x, y, z), [[-0.03, 1.24, 0.07], [0.03, 1.33, 0.16]], { h: 0.0007 }),
    ],
  },
  acc_watch: {
    slot: "accessory",
    look: "rubber",
    socket: "Wrist_L",
    parts: [
      rigid("primary", (x, y, z) => watchStrapD(x, y, z), [[0.29, 0.86, -0.05], [0.42, 0.98, 0.07]], { h: 0.0008 }),
      rigid("metal", (x, y, z) => watchCaseD(x, y, z), [[0.29, 0.86, -0.05], [0.42, 0.98, 0.07]], { h: 0.0006 }),
      rigid("lens", (x, y, z) => watchFaceD(x, y, z), [[0.29, 0.86, -0.05], [0.42, 0.98, 0.07]], { h: 0.0005, ao: false }),
    ],
  },
  acc_headphones: {
    slot: "accessory",
    look: "plastic",
    hairMode: "banded",
    excludes: ["hat"],
    socket: "HeadTop",
    parts: [
      rigid("primary", (x, y, z) => headbandD(x, y, z), [[-0.15, 1.58, -0.04], [0.15, 1.8, 0.04]], { h: 0.0011 }),
      rigid("secondary", (x, y, z) => cupsD(x, y, z), [[-0.16, 1.56, -0.07], [0.16, 1.7, 0.06]], { h: 0.0011 }),
    ],
  },
};

/* ── crown ───────────────────────────────────────────────────────────────── */

/** The crown's ring sits at this height above the HeadTop socket before per-hair offsets. */
export const CROWN = { y: 1.748, r: 0.074, ez: 1.14 }; // ez: front-to-back stretch, the cranium's own (rig.HEAD radii z / x)
function crownD(x, y, z) {
  const zc = 0.004;
  const a = Math.atan2(x, z - zc);
  const rr = Math.hypot(x, (z - zc) / CROWN.ez);
  const yy = y - CROWN.y;
  // Band: a slightly flared ring 2.4 cm tall.
  const R = CROWN.r + 0.08 * Math.max(0, yy);
  let d = Math.max(Math.abs(rr - R) - 0.0026, Math.abs(yy - 0.012) - 0.012);
  // Points: eight, rising 3 cm from the band, each tipped with a ball.
  const k = 8;
  const f = (a * k) / (2 * Math.PI);
  const cell = Math.round(f);
  const fa = Math.abs(f - cell); // 0 at a point's centre
  const peak = 0.024 + 0.03 * Math.max(0, 1 - fa * 2.2);
  const points = Math.max(Math.abs(rr - R) - 0.0024, yy - peak, -yy);
  d = smin(d, points, 0.003);
  const pa = ((cell) * 2 * Math.PI) / k;
  const tipY = CROWN.y + 0.024 + 0.03 + 0.003;
  const tipR = CROWN.r + 0.08 * (tipY - CROWN.y);
  d = Math.min(d, Math.hypot(x - tipR * Math.sin(pa), y - tipY, z - zc - tipR * Math.cos(pa)) - 0.0055);
  // Beading along the base.
  d -= 0.0008 * sstep(0.003, 0.0, Math.abs(yy - 0.004)) * Math.abs(Math.sin(a * 40));
  return d;
}
function crownGemsD(x, y, z) {
  const zc = 0.004;
  let d = 1;
  for (let i = 0; i < 8; i++) {
    const a = (i * 2 * Math.PI) / 8;
    const R = CROWN.r + 0.08 * 0.012 + 0.0025;
    d = Math.min(d, sdEllipsoid(x - R * Math.sin(a), y - (CROWN.y + 0.012), z - zc - R * Math.cos(a), 0.0055, 0.0065, 0.0055));
  }
  return d;
}

/* ── shades ──────────────────────────────────────────────────────────────── */

const LENS = { y: 1.643, w: 0.024, h: 0.0182, x: 0.0385 };
/** Lens plane depth: clear of the brow ridge and cheek around the eye (the eye opening itself is a hole in the head field). */
function lensZ(x, y) {
  let z = 0;
  for (const shape of ["oval", "round", "square", "heart"]) z = Math.max(z, faceSurfaceZ(x, y + 0.026, shape), faceSurfaceZ(x, y - 0.024, shape));
  return z + 0.012 - 0.12 * (x * x);
}
const LENS_Z = Object.fromEntries([1, -1].map((s) => [s, lensZ(LENS.x * s, LENS.y)]));
function lensShape(s, x, y) {
  const u = (x - LENS.x * s) * s, v = y - LENS.y;
  // Rounded aviator-ish shape, wider at the top outer corner.
  const top = LENS.h * (1 + 0.15 * u / LENS.w);
  return Math.max(Math.hypot(u / LENS.w, Math.max(0, v) / top + Math.min(0, v) / (LENS.h * 1.05) * -1 * 0 + (v < 0 ? -v / (LENS.h * 1.05) : 0)) - 1, 0) * 0.02 + Math.max(Math.abs(u) - LENS.w, Math.abs(v) - top) * 0;
}
function lensPlane(s, x, y, z) {
  const zc = LENS_Z[s] - 0.25 * ((x - LENS.x * s) * s) * 0.2;
  // Gently curved lens surface.
  return z - (zc - 0.9 * (x - LENS.x * s) ** 2 - 0.6 * (y - LENS.y) ** 2);
}
function shadesLensD(x, y, z) {
  const s = x >= 0 ? 1 : -1;
  const u = (x - LENS.x * s) * s, v = y - LENS.y;
  const outline = Math.hypot(u / LENS.w, v / (LENS.h * (v > 0 ? 1.0 : 1.08))) - 1;
  return smax(Math.abs(lensPlane(s, x, y, z)) - 0.0014, outline * 0.02, 0.0008);
}
function shadesFrameD(x, y, z) {
  const s = x >= 0 ? 1 : -1;
  const u = (x - LENS.x * s) * s, v = y - LENS.y;
  const outline = (Math.hypot(u / LENS.w, v / (LENS.h * (v > 0 ? 1.0 : 1.08))) - 1) * 0.02;
  let d = smax(Math.abs(lensPlane(s, x, y, z)) - 0.0032, Math.abs(outline + 0.0005) - 0.0016, 0.0008);
  // Bridge.
  const bz = LENS_Z[1] + 0.001;
  d = Math.min(d, sdCone(Math.abs(x), y, z, [0.0, LENS.y + 0.012, bz + 0.002], [0.017, LENS.y + 0.011, bz - 0.002], 0.0022, 0.0024));
  // Temples back to the ears.
  for (const ss of [1, -1]) {
    const ear = EAR_C[ss === 1 ? "L" : "R"];
    const p0 = [ss * (LENS.x + LENS.w - 0.002), LENS.y + 0.008, LENS_Z[ss] - 0.004];
    const p1 = [ss * (Math.abs(ear[0]) + 0.004), LENS.y + 0.012, ear[2] + 0.018];
    const p2 = [ss * (Math.abs(ear[0]) - 0.002), ear[1] + 0.012, ear[2] - 0.016];
    d = Math.min(d, sdCone(x, y, z, p0, p1, 0.0021, 0.0019), sdCone(x, y, z, p1, p2, 0.0019, 0.0017));
  }
  void sstep;
  return d;
}
void lensShape;

/* ── chain ───────────────────────────────────────────────────────────────── */

/** Moves p along the body's normal until it sits `off` above the skin. */
function onBody(p, off) {
  let [x, y, z] = p;
  for (let i = 0; i < 8; i++) {
    const d = bodyD(x, y, z);
    const e = 0.0005;
    const g = [bodyD(x + e, y, z) - bodyD(x - e, y, z), bodyD(x, y + e, z) - bodyD(x, y - e, z), bodyD(x, y, z + e) - bodyD(x, y, z - e)];
    const n = Math.hypot(...g) || 1;
    x += (g[0] / n) * (off - d);
    y += (g[1] / n) * (off - d);
    z += (g[2] / n) * (off - d);
  }
  return [x, y, z];
}
/** On the tee layer — attachments.mjs moves it out over thicker tops. */
export const CHAIN_OFF = L.top + 0.0045;
export function chainPath() {
  const half = [
    [0, 1.468, -0.07],
    [0.05, 1.462, -0.045],
    [0.075, 1.44, 0.0],
    [0.074, 1.405, 0.06],
    [0.052, 1.36, 0.1],
    [0.026, 1.33, 0.12],
    [0, 1.322, 0.125],
  ];
  return [...half.map(([x, y, z]) => [-x, y, z]).reverse(), ...half.slice(1)].map((p) => onBody(p, CHAIN_OFF));
}
function chainLinks(b) {
  const pts = chainPath();
  // Resample by arc length, then a link every 7 mm, alternating orientation.
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    seg.push(l);
    total += l;
  }
  const at = (s) => {
    let i = 0;
    while (i < seg.length - 1 && s > seg[i]) s -= seg[i++];
    const t = Math.min(1, s / seg[i]);
    const a = pts[i], c = pts[i + 1];
    return [[a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]];
  };
  const step = 0.0105;
  const n = Math.floor(total / step);
  for (let i = 0; i < n; i++) {
    const [mid, dir] = at(i * step + step / 2);
    // Every link back on the offset surface: a straight run between control points cuts into the neck–shoulder hollow.
    const c = onBody(mid, CHAIN_OFF);
    const l = Math.hypot(...dir);
    const t = dir.map((v) => v / l);
    // Rotation taking +X to the tangent; alternate links turn 90° about it.
    const yaw = Math.atan2(-t[2], t[0]);
    const pitch = Math.asin(clamp(t[1], -1, 1));
    torus(b, { c, R: 0.0056, Rz: 0.0044, r: 0.0016, rot: [i % 2 ? Math.PI / 2 : 0, yaw, pitch], seg: 5, tubeSeg: 3 });
  }
}
function pendantD(x, y, z) {
  const c = onBody([0, 1.29, 0.13], CHAIN_OFF + 0.002);
  let d = sdRoundBox(x - c[0], y - c[1], z - c[2], 0.013, 0.017, 0.0028, 0.004);
  // A bevelled star-ish emboss.
  d -= 0.0012 * sstep(0.008, 0.0, Math.hypot(x - c[0], y - c[1])) * sstep(c[2], c[2] + 0.003, z);
  return d;
}

/* ── watch ───────────────────────────────────────────────────────────────── */

function wristFrame() {
  const s = arm("L")(0.935);
  return { c: s.c, t: s.tan.clone().normalize(), rx: s.rx, rz: s.rz };
}
const WF = wristFrame();
function wristLocal(x, y, z) {
  const q = [x - WF.c.x, y - WF.c.y, z - WF.c.z];
  const along = q[0] * WF.t.x + q[1] * WF.t.y + q[2] * WF.t.z;
  const px = q[0] - along * WF.t.x, py = q[1] - along * WF.t.y, pz = q[2] - along * WF.t.z;
  return { along, radial: Math.hypot(px / (WF.rx + 0.004), pz / (WF.rz + 0.004)), p: [px, py, pz] };
}
function watchStrapD(x, y, z) {
  const { along, radial } = wristLocal(x, y, z);
  const r = Math.min(WF.rx, WF.rz) + 0.004;
  return Math.max(Math.abs(radial - 1) * r - 0.003, Math.abs(along) - 0.0105);
}
function watchCaseD(x, y, z) {
  // On the back of the wrist (outer side, +X for the left arm).
  const c = [WF.c.x + WF.rx + 0.006, WF.c.y, WF.c.z];
  return sdRoundBox(x - c[0], y - c[1], z - c[2], 0.0045, 0.0165, 0.0155, 0.004);
}
function watchFaceD(x, y, z) {
  const c = [WF.c.x + WF.rx + 0.0108, WF.c.y, WF.c.z];
  return sdRoundBox(x - c[0], y - c[1], z - c[2], 0.0009, 0.0125, 0.0118, 0.0009);
}

/* ── headphones ──────────────────────────────────────────────────────────── */

const BAND = HAT_FIT.banded;
function headbandD(x, y, z) {
  // A padded band over the crown from ear to ear, its inside resting at the banded gap.
  const inner = scalpD(x, y, z) - BAND.hatGap();
  let d = Math.max(inner - 0.009, -inner);
  d = smax(d, Math.abs(z + 0.002) - 0.016, 0.004);
  d = smax(d, 1.63 - y, 0.004);
  return d;
}
function cupsD(x, y, z) {
  let d = 1;
  for (const s of [1, -1]) {
    const c = cupCentre(s); // inner face on the side of the head, the ear inside the cup (fit.mjs CUP)
    const lx = (x - c[0]) * s;
    const cyl = Math.max(Math.hypot(y - c[1], z - c[2]) - CUP.r, Math.abs(lx) - 0.014);
    d = Math.min(d, smin(sdRoundBox(lx, y - c[1], z - c[2], 0.014, CUP.r, CUP.r, 0.012), cyl + 0.004, 0.002));
    // Yoke from cup to band.
    d = Math.min(d, sdCone(x, y, z, [c[0], c[1] + 0.035, c[2]], [c[0] - 0.006 * s, 1.655, c[2] + 0.002], 0.006, 0.0055));
  }
  return d;
}

/** The point on the outermost cloth for a template's layer — used by built parts. */
function onCloth(p, off) {
  return onBody(p, off);
}

void [lerp, gauss, coverage, hatInnerD, EYE, headD, sstep, legBand];

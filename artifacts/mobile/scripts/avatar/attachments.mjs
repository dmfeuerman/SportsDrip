/**
 * Attachment configuration for rigid wearables (hats, eyewear, jewellery,
 * watches, headphones).
 *
 * Each rigid template is authored in the space of one socket (rig.SOCKETS)
 * and placed at runtime by an attachment spec:
 *
 *   {
 *     socket: "HeadTop",              // rig socket the item hangs from
 *     bone: "Head",                   // the socket's bone (fallback if a base lacks the socket)
 *     position: [x, y, z],            // metres, socket space
 *     rotation: [x, y, z],            // degrees, XYZ order
 *     scale: 1 | [x, y, z],
 *     perHair: { afro: { position: [0, 0.06, 0] }, ... },   // by hairstyle
 *     perFace: { square: { scale: [1.02, 1, 1] }, ... },    // by face shape
 *     with:    { top_hoodie: { scale: 1.08 }, outerwear: { hidden: true } },
 *              // by another worn item's template id or slot (template wins)
 *   }
 *
 * Offsets compose: positions and rotations add, scales multiply. The spec is
 * written into each GLB's metadata (`sdAvatar.attach`), so a hand-made asset
 * carries its own, and a catalog document may override any of it with an
 * `attach` field — no app release needed to nudge one item.
 *
 * The values below that depend on other assets (how high a crown sits on each
 * hairstyle, how far a chain must move out over a hoodie) are measured from
 * those assets' fields when the GLBs are generated, never hand-tuned.
 */
import { BONES, HAIR_STYLES, LAYER_OFFSET, SOCKETS } from "./rig.mjs";
import { arm } from "./anatomy.mjs";
import { bodyD } from "./character.mjs";
import { scalpD } from "./fit.mjs";
import { HAIR } from "./hair.mjs";
import { CHAIN_OFF, chainPath, CROWN, TEMPLATES } from "./templates.mjs";

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Topmost surface height of field f along a vertical line at (x, z), searching down from y0. */
function topAt(f, x, z, y0 = 1.95, y1 = 1.6) {
  let y = y0;
  for (let i = 0; i < 400 && y > y1; i++) {
    const d = f(x, y, z);
    if (d < 0.0003) return y;
    y -= Math.max(0.0004, Math.min(d * 0.7, 0.01));
  }
  return -Infinity;
}

/**
 * How high the crown's ring sits for each hairstyle. The ring follows the
 * cranium's oval (CROWN.ez); on bare or buzzed heads it rests on the highest
 * point under it, on fuller hair it settles into the fullest parts (up to
 * 3.5 mm) rather than balancing on one tuft and floating over the rest.
 */
export function crownSeats() {
  const out = {};
  const inner = CROWN.r - 0.0026;
  const topsFor = (f) => {
    const tops = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      tops.push(topAt(f, inner * Math.sin(a), 0.004 + inner * CROWN.ez * Math.cos(a)));
    }
    return tops.sort((p, q) => p - q);
  };
  for (const style of HAIR_STYLES) {
    const f = style === "bald" ? scalpD : (x, y, z) => Math.min(HAIR[style](x, y, z), scalpD(x, y, z));
    const tops = topsFor(f);
    const top = tops[tops.length - 1];
    out[style] = style === "bald" || style === "buzz" ? top : Math.max(tops[Math.floor(tops.length * 0.6)], top - 0.0035);
  }
  return { seats: out };
}

/** Distance along the body normal from the skin to a field's surface, starting from `from` and searching outward. */
function layerAt(f, p, from = 0, to = 0.07) {
  // March outward along the body normal from p (on the skin).
  const e = 0.0005;
  const [x, y, z] = p;
  const g = [bodyD(x + e, y, z) - bodyD(x - e, y, z), bodyD(x, y + e, z) - bodyD(x, y - e, z), bodyD(x, y, z + e) - bodyD(x, y, z - e)];
  const n = Math.hypot(...g) || 1;
  let last = null;
  for (let o = from; o <= to; o += 0.0005) {
    const q = [x + (g[0] / n) * o, y + (g[1] / n) * o, z + (g[2] / n) * o];
    const d = f(...q);
    if (last !== null && last < 0 && d >= 0) return o;
    last = d;
  }
  return last !== null && last < 0 ? to : 0;
}

/** Skin point under a point that sits `off` off the body. */
function toSkin(p) {
  let [x, y, z] = p;
  for (let i = 0; i < 6; i++) {
    const d = bodyD(x, y, z);
    const e = 0.0005;
    const g = [bodyD(x + e, y, z) - bodyD(x - e, y, z), bodyD(x, y + e, z) - bodyD(x, y - e, z), bodyD(x, y, z + e) - bodyD(x, y, z - e)];
    const n = Math.hypot(...g) || 1;
    x -= (g[0] / n) * d;
    y -= (g[1] / n) * d;
    z -= (g[2] / n) * d;
  }
  return [x, y, z];
}

/** Union of a template's cloth parts as one field (each only inside the box it's meshed in). */
function clothField(key) {
  const parts = TEMPLATES[key].parts.filter((p) => p.kind === "skinned" && p.field);
  const inBox = ([lo, hi], x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
  return (x, y, z) => {
    let d = 1;
    for (const p of parts) if (inBox(p.box, x, y, z)) d = Math.min(d, p.field(x, y, z));
    return d;
  };
}

/**
 * Chain over thicker tops: how far its path needs to move out from the tee
 * layer for each top/outerwear template, as a scale about the Neck socket.
 */
export function chainFits() {
  const path = chainPath();
  const skin = path.map(toSkin);
  const S = SOCKETS.Neck.position;
  const out = {};
  for (const key of Object.keys(TEMPLATES)) {
    const t = TEMPLATES[key];
    if (t.slot !== "top" && t.slot !== "outerwear") continue;
    const f = clothField(key);
    // Only the front matters: round the back of the neck the chain may run under a hood or collar.
    let need = 0;
    skin.forEach((p) => {
      if (p[2] < 0.03) return;
      const layer = layerAt(f, p, 0, 0.08);
      need = Math.max(need, layer + 0.0045 - CHAIN_OFF);
    });
    if (need <= 0.001) continue;
    if (need > 0.03) {
      // Thick, high-collared jackets: the chain is worn under them.
      out[key] = { hidden: true };
      continue;
    }
    // Spread the path outward: horizontal scale about the socket, plus a little lift at the back of the neck.
    let mean = 0;
    for (const p of path) mean += Math.hypot(p[0] - S[0], p[2] - S[2]);
    mean /= path.length;
    const k = 1 + (need * 1.15) / mean;
    out[key] = { scale: [r4(k), 1, r4(k)], position: [0, r4(need * 0.35), r4(need * 0.25)] };
  }
  return out;
}

/**
 * Watch vs sleeves that reach the wrist: slid down the forearm, just past the
 * cuff, as far as the wrist allows; worn under the sleeve when even that
 * isn't enough (a cuff over the hand).
 */
export function watchFits() {
  const A = arm("L");
  const T0 = 0.935; // where the watch is authored
  const ringAt = (tt) => {
    const s = A(tt);
    const t = s.tan.clone().normalize();
    const side = new t.constructor(0, 0, 1).cross(t).normalize(); // outward, across the arm
    const front = t.clone().cross(side).normalize();
    const ring = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const c = Math.cos(a) * s.rx, sn = Math.sin(a) * s.rz;
      ring.push(toSkin([s.c.x + side.x * c + front.x * sn, s.c.y + side.y * c + front.y * sn, s.c.z + side.z * c + front.z * sn]));
    }
    return { s, ring };
  };
  const out = {};
  for (const key of Object.keys(TEMPLATES)) {
    const tp = TEMPLATES[key];
    if (tp.slot !== "top" && tp.slot !== "outerwear") continue;
    const f = clothField(key);
    // A sleeve sits within 2 cm of the wrist; further out is the hem of the top beside the hand.
    const clear = (tt) => ringAt(tt).ring.every((p) => layerAt(f, p, 0, 0.02) <= 0.0015);
    if (clear(T0)) continue;
    let tt = T0;
    while (tt < 0.972 && !clear(tt)) tt += 0.004;
    if (tt >= 0.972) {
      out[key] = { hidden: true };
      continue;
    }
    // Along the forearm by the arc length between, plus 3 mm off the cuff.
    const a = A(T0).c, b = A(tt).c;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const l = Math.hypot(...d);
    const k = (l + 0.003) / l;
    out[key] = { position: d.map((v) => r4(v * k)) };
  }
  return out;
}

/** The full attachment spec per rigid template. */
export function attachmentSpecs() {
  const boneOf = (socket) => SOCKETS[socket].bone;
  const specs = {};
  for (const [key, t] of Object.entries(TEMPLATES)) {
    if (!t.socket) continue;
    specs[key] = { socket: t.socket, bone: boneOf(t.socket), position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
  }
  // Crown: rides on the hair.
  {
    const { seats } = crownSeats();
    const perHair = {};
    for (const [style, seat] of Object.entries(seats)) perHair[style] = { position: [0, r4(seat - CROWN.y), 0] };
    specs.hat_crown.perHair = perHair;
  }
  const chain = chainFits();
  for (const key of Object.keys(specs)) if (key.startsWith("acc_chain")) specs[key].with = chain;
  specs.acc_watch.with = watchFits();
  return specs;
}

export { LAYER_OFFSET, BONES };

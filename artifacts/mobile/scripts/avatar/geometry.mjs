/**
 * Mesh construction for the avatar generator: a vertex buffer that carries
 * skin weights, plus the handful of parametric primitives the character and
 * its clothes are made of. Everything is plain arrays until `toGeometry`.
 */
import * as THREE from "three";
import { BONE_NAMES } from "./rig.mjs";

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

/** Catmull-Rom through scalar keys [[x, value], ...] (x ascending). */
export function curve(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (x >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (keys[i + 1][0] < x) i++;
  const p0 = keys[Math.max(0, i - 1)][1];
  const p1 = keys[i][1];
  const p2 = keys[i + 1][1];
  const p3 = keys[Math.min(n - 1, i + 2)][1];
  const t = (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Blend two weight maps: (1-t)*a + t*b. */
export function mix(a, b, t) {
  const out = {};
  for (const [k, v] of Object.entries(a)) out[k] = (out[k] ?? 0) + v * (1 - t);
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v * t;
  return out;
}

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
    this.weights = [];
    /** Optional per-vertex RGB (0..1), set with `color()`; exported as a vertex colour attribute. */
    this.cols = null;
  }

  color(v, rgb) {
    this.cols ??= [];
    this.cols[v] = rgb;
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(p, w) {
    this.pos.push(p[0], p[1], p[2]);
    this.weights.push(w ?? { Root: 1 });
    return this.count - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /** Grid of rows × cols vertices, `wrap` closes the columns into a ring. */
  grid(rows, cols, wrap, keep = () => true, flip = false) {
    const base = this.count - rows * cols;
    const ncols = wrap ? cols : cols - 1;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < ncols; c++) {
        if (!keep(r, c)) continue;
        const a = base + r * cols + c;
        const b = base + r * cols + ((c + 1) % cols);
        const d = base + (r + 1) * cols + c;
        const e = base + (r + 1) * cols + ((c + 1) % cols);
        if (flip) {
          this.tri(a, b, d);
          this.tri(b, e, d);
        } else {
          this.tri(a, d, b);
          this.tri(b, d, e);
        }
      }
    }
  }

  /** Drops triangles whose centroid fails `test`. Vertices are left in place. */
  filterTriangles(test) {
    const out = [];
    for (let i = 0; i < this.idx.length; i += 3) {
      const [a, b, c] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      const cy = (this.pos[a * 3 + 1] + this.pos[b * 3 + 1] + this.pos[c * 3 + 1]) / 3;
      const cx = (this.pos[a * 3] + this.pos[b * 3] + this.pos[c * 3]) / 3;
      const cz = (this.pos[a * 3 + 2] + this.pos[b * 3 + 2] + this.pos[c * 3 + 2]) / 3;
      if (test([cx, cy, cz])) out.push(a, b, c);
    }
    this.idx = out;
  }

  clone() {
    const m = new MeshBuilder();
    m.pos = [...this.pos];
    m.idx = [...this.idx];
    m.weights = this.weights.map((w) => ({ ...w }));
    return m;
  }

  /** Builds an indexed BufferGeometry, dropping unused vertices. */
  toGeometry({ skinned = true, origin = [0, 0, 0] } = {}) {
    const used = new Map();
    const pos = [];
    const sIdx = [];
    const sW = [];
    const idx = [];
    const col = [];
    for (const v of this.idx) {
      if (!used.has(v)) {
        used.set(v, used.size);
        pos.push(this.pos[v * 3] - origin[0], this.pos[v * 3 + 1] - origin[1], this.pos[v * 3 + 2] - origin[2]);
        if (this.cols) {
          const c = this.cols[v] ?? [1, 1, 1];
          col.push(Math.round(255 * Math.min(1, c[0])), Math.round(255 * Math.min(1, c[1])), Math.round(255 * Math.min(1, c[2])), 255);
        }
        if (skinned) {
          const entries = Object.entries(this.weights[v])
            .filter(([, w]) => w > 1e-4)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
          const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
          for (let i = 0; i < 4; i++) {
            const e = entries[i];
            const bi = e ? BONE_INDEX[e[0]] : 0;
            if (e && bi === undefined) throw new Error(`unknown bone ${e[0]}`);
            sIdx.push(bi);
            sW.push(e ? e[1] / total : 0);
          }
        }
      }
      idx.push(used.get(v));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (skinned) {
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(sIdx, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sW, 4));
    }
    if (this.cols) g.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(col), 4, true));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

/* ── primitives ──────────────────────────────────────────────────────────── */

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * A tube along a polyline of control points. Each point: { c, rx, rz, w }.
 * Cross-sections are superellipses in the plane normal to the path, with
 * `rx` across the body (side) and `rz` front-to-back. The path is resampled
 * with Catmull-Rom so knees and elbows bend smoothly.
 *
 * opts: steps per segment, radial count, exp (2 = ellipse, >2 boxier),
 *       capStart/capEnd, arc [a0, a1] (partial cross-section, radians, 0 = +side),
 *       radial(theta, s) extra radius, weight(s, theta, point) override.
 */
export function tube(b, points, opts = {}) {
  const { steps = 8, radial = 24, exp = 2, capStart = false, capEnd = false, arc = null, radialFn = null, weight = null, capScale = 1 } = opts;
  const samples = [];
  const n = points.length;
  const curvePt = new THREE.CatmullRomCurve3(points.map((p) => v3(p.c)), false, "centripetal");
  const total = (n - 1) * steps;
  for (let i = 0; i <= total; i++) {
    const s = i / total; // 0..1 along the whole tube
    const seg = Math.min(n - 2, Math.floor(s * (n - 1)));
    const lt = s * (n - 1) - seg;
    const a = points[seg];
    const c = points[seg + 1];
    const k = lt * lt * (3 - 2 * lt);
    samples.push({
      s,
      c: curvePt.getPoint(s),
      t: curvePt.getTangent(s).normalize(),
      rx: lerp(a.rx, c.rx, k),
      rz: lerp(a.rz, c.rz, k),
      w: mix(a.w, c.w, k),
    });
  }

  const front0 = new THREE.Vector3(0, 0, 1);
  const ringOf = (sm) => {
    const side = new THREE.Vector3().crossVectors(front0, sm.t);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const front = new THREE.Vector3().crossVectors(sm.t, side).normalize();
    if (front.z < 0) front.negate();
    return { side, front };
  };

  const full = !arc;
  const a0 = arc ? arc[0] : 0;
  const a1 = arc ? arc[1] : Math.PI * 2;
  const cols = full ? radial : radial + 1;
  const e = 2 / exp;
  const sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), e);

  const ring = (sm, scale, offsetAlong) => {
    const { side, front } = ringOf(sm);
    for (let j = 0; j < cols; j++) {
      const th = a0 + ((a1 - a0) * j) / (full ? radial : radial);
      const extra = radialFn ? radialFn(th, sm.s) : 0;
      const x = (sm.rx + extra) * sp(Math.cos(th)) * scale;
      const z = (sm.rz + extra) * sp(Math.sin(th)) * scale;
      const p = sm.c.clone().addScaledVector(side, x).addScaledVector(front, z).addScaledVector(sm.t, offsetAlong);
      b.vertex([p.x, p.y, p.z], weight ? weight(sm.s, th, p) : sm.w);
    }
  };

  const capRings = 5;
  let rows = 0;
  if (capStart) {
    const sm = samples[0];
    const len = Math.min(sm.rx, sm.rz) * capScale;
    for (let k = capRings; k >= 1; k--) {
      const ang = (k / capRings) * (Math.PI / 2) * 0.98;
      ring(sm, Math.cos(ang), -Math.sin(ang) * len);
      rows++;
    }
  }
  for (const sm of samples) {
    ring(sm, 1, 0);
    rows++;
  }
  if (capEnd) {
    const sm = samples[samples.length - 1];
    const len = Math.min(sm.rx, sm.rz) * capScale;
    for (let k = 1; k <= capRings; k++) {
      const ang = (k / capRings) * (Math.PI / 2) * 0.98;
      ring(sm, Math.cos(ang), Math.sin(ang) * len);
      rows++;
    }
  }
  b.grid(rows, cols, full, undefined, true);
}

/**
 * Ellipsoid / superellipsoid. `deform(p, theta, phi)` may move a vertex,
 * `keep(theta, phi)` drops quads (for shells with an edge), `weight(p)` sets
 * the skin weights per vertex. theta: 0 at +Y pole, phi: 0 at +Z (front).
 */
export function ellipsoid(b, { c, r, rows = 24, cols = 32, e1 = 1, e2 = 1, deform = null, keep = null, weight = null, w = null, thetaMax = Math.PI, thetaMin = 0, rot = null }) {
  const center = v3(c);
  const q = rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])) : null;
  const sp = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
  for (let i = 0; i <= rows; i++) {
    const th = thetaMin + ((thetaMax - thetaMin) * i) / rows;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      let p = new THREE.Vector3(
        r[0] * sp(Math.sin(th), e1) * sp(Math.sin(ph), e2),
        r[1] * sp(Math.cos(th), e1),
        r[2] * sp(Math.sin(th), e1) * sp(Math.cos(ph), e2)
      );
      if (q) p.applyQuaternion(q);
      p.add(center);
      if (deform) p = deform(p, th, ph) ?? p;
      b.vertex([p.x, p.y, p.z], weight ? weight(p) : w);
    }
  }
  b.grid(rows + 1, cols, true, keep ? (ri, ci) => keep(thetaMin + ((thetaMax - thetaMin) * (ri + 0.5)) / rows, ((ci + 0.5) / cols) * Math.PI * 2) : undefined);
}

/**
 * A shell over the head cranium from the crown down to an edge that varies
 * with azimuth: `edge(phi)` returns the polar angle where the shell stops,
 * `thick(v, phi)` its distance from the scalp (v: 0 crown → 1 edge).
 */
export function headShell(b, head, { edge, thick, rows = 18, cols = 48, w, deform = null, vMin = 0, vMax = 1 }) {
  const c = v3(head.center);
  const [rx, ry, rz] = head.radii;
  for (let i = 0; i <= rows; i++) {
    const v = vMin + ((vMax - vMin) * i) / rows;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const th = Math.max(1e-3, v * edge(ph));
      const dir = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      const surf = new THREE.Vector3(rx * dir.x, ry * dir.y, rz * dir.z);
      const n = new THREE.Vector3(dir.x / rx, dir.y / ry, dir.z / rz).normalize();
      let p = c.clone().add(surf).addScaledVector(n, thick(v, ph, th));
      if (deform) p = deform(p, v, ph) ?? p;
      b.vertex([p.x, p.y, p.z], w);
    }
  }
  b.grid(rows + 1, cols, true);
}

/** Torus ring. `rot` Euler (rad) orients its axis; default axis is +Y. */
export function torus(b, { c, R, r, Rz = null, rot = [0, 0, 0], seg = 48, tubeSeg = 10, w, arc = Math.PI * 2 }) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const center = v3(c);
  const full = arc >= Math.PI * 2 - 1e-6;
  const cols = full ? seg : seg + 1;
  // rows = tube cross-section (wrapping), cols = around the ring
  for (let i = 0; i < tubeSeg; i++) {
    const a = (i / tubeSeg) * Math.PI * 2;
    for (let j = 0; j < cols; j++) {
      const t = (j / seg) * arc;
      const rx = R + r * Math.cos(a);
      const rzz = (Rz ?? R) + r * Math.cos(a);
      const p = new THREE.Vector3(rx * Math.cos(t), r * Math.sin(a), rzz * Math.sin(t)).applyQuaternion(q).add(center);
      b.vertex([p.x, p.y, p.z], typeof w === "function" ? w(p) : w);
    }
  }
  // rows wrap around the tube; columns run around the ring
  const base = b.count - tubeSeg * cols;
  for (let i = 0; i < tubeSeg; i++) {
    const i2 = (i + 1) % tubeSeg;
    for (let j = 0; j < (full ? cols : cols - 1); j++) {
      const j2 = (j + 1) % cols;
      const a = base + i * cols + j;
      const bb = base + i * cols + j2;
      const d = base + i2 * cols + j;
      const e = base + i2 * cols + j2;
      b.tri(a, d, bb);
      b.tri(bb, d, e);
    }
  }
}

/** Revolve a profile [[radius, y], ...] around a vertical axis at `c`. */
export function lathe(b, { c, profile, seg = 48, phiStart = 0, phiLen = Math.PI * 2, w, rz = 1 }) {
  const full = phiLen >= Math.PI * 2 - 1e-6;
  const cols = full ? seg : seg + 1;
  for (const [r, y] of profile) {
    for (let j = 0; j < cols; j++) {
      const ph = phiStart + (j / seg) * phiLen;
      b.vertex([c[0] + r * Math.sin(ph), c[1] + y, c[2] + r * rz * Math.cos(ph)], typeof w === "function" ? w([c[0] + r * Math.sin(ph), c[1] + y, c[2] + r * rz * Math.cos(ph)]) : w);
    }
  }
  b.grid(profile.length, cols, full);
}

/**
 * Normal-map baking from the signed-distance fields the meshes are made from.
 *
 * Every mesh here is a decimated copy of an exact field (sdf.mjs). The low
 * mesh keeps the silhouette within the triangle budget; the normal map puts
 * back everything the decimation removed — rib knit, quilting, seams, folds,
 * hair strands, knuckles, lip and lid edges — by sampling the field's own
 * gradient for every texel. It's the high-poly → low-poly bake of a Blender
 * pipeline, with the field as the high poly.
 *
 *   1. charts: triangles grouped by their dominant axis (box projection) and
 *      connectivity, each chart a height field over its projection plane;
 *   2. atlas: charts shelf-packed into one square texture with a gutter, at
 *      the highest uniform texel density that fits;
 *   3. bake: per texel, the low surface point is pulled onto the field and
 *      the field normal written in the low triangle's tangent frame;
 *   4. dilate the gutters, encode (JPEG, jpeg.mjs — a third of the PNG size
 *      at no visible cost in shading), and add it to the GLB (glTF
 *      normalTexture) with no third-party tools.
 *
 * Tangent frame: no TANGENT attribute is written; three.js derives the frame
 * per pixel from screen-space derivatives of position and UV (it follows
 * skinning and blendshapes for free). That frame is T = ∂p/∂u, B = ∂p/∂v, per
 * triangle — exactly what the baker uses — and GLTFLoader flips the green
 * channel for glTF's convention, so +Y is stored as −B.
 */
import { deflateSync } from "node:zlib";

/* ── charts ──────────────────────────────────────────────────────────────── */

const AXES = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
];

function triNormal(P, I, t) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
  const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l, l / 2];
}

/**
 * Splits a mesh into charts: connected triangles that face the same way
 * (one of ±X, ±Y, ±Z). Returns a chart index per triangle and each chart's
 * projection axis.
 */
export function charts(P, I, { minTris = 12 } = {}) {
  const nt = I.length / 3;
  const nrm = [];
  const dir = new Int8Array(nt);
  const along = (t, d) => nrm[t][d >> 1] * (d & 1 ? -1 : 1);
  for (let t = 0; t < nt; t++) {
    const n = triNormal(P, I, t);
    nrm.push(n);
    let best = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(n[k]) > Math.abs(n[best])) best = k;
    dir[t] = best * 2 + (n[best] < 0 ? 1 : 0);
  }
  // Edge adjacency.
  const nb = Array.from({ length: nt }, () => []);
  const edges = new Map();
  for (let t = 0; t < nt; t++)
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e], b = I[t * 3 + ((e + 1) % 3)];
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const o = edges.get(k);
      if (o === undefined) edges.set(k, t);
      else {
        nb[t].push(o);
        nb[o].push(t);
      }
    }
  // Smooth the directions: a triangle joins its neighbours' direction when
  // most of them share it and it faces that way well enough (no fold-over).
  for (let pass = 0; pass < 4; pass++) {
    for (let t = 0; t < nt; t++) {
      const count = new Map();
      for (const o of nb[t]) count.set(dir[o], (count.get(dir[o]) ?? 0) + 1);
      for (const [d, c] of count) if (d !== dir[t] && c >= 2 && along(t, d) > 0.35) dir[t] = d;
    }
  }
  const parent = Int32Array.from({ length: nt }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = () => {
    for (let t = 0; t < nt; t++) for (const o of nb[t]) if (dir[o] === dir[t]) parent[find(o)] = find(t);
  };
  union();
  // Small charts fold into a neighbouring chart they face well enough.
  for (let pass = 0; pass < 3; pass++) {
    const size = new Map();
    for (let t = 0; t < nt; t++) size.set(find(t), (size.get(find(t)) ?? 0) + 1);
    let moved = 0;
    for (let t = 0; t < nt; t++) {
      if (size.get(find(t)) >= minTris) continue;
      let best = null;
      for (const o of nb[t]) {
        if (find(o) === find(t)) continue;
        const score = along(t, dir[o]) + 0.001 * size.get(find(o));
        if (along(t, dir[o]) > 0.2 && (!best || score > best.score)) best = { d: dir[o], score };
      }
      if (best) {
        dir[t] = best.d;
        moved++;
      }
    }
    for (let t = 0; t < nt; t++) parent[t] = t;
    union();
    if (!moved) break;
  }
  const id = new Map();
  const chart = new Int32Array(nt);
  const axis = [];
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    if (!id.has(r)) {
      id.set(r, axis.length);
      axis.push(dir[t]);
    }
    chart[t] = id.get(r);
  }
  return { chart, axis };
}

/* ── atlas ───────────────────────────────────────────────────────────────── */

/**
 * Lays out several meshes' charts in one square atlas. Each entry is
 * { P, I, weight? } (positions, indices, relative texel density — e.g. less
 * for variants mostly hidden under a hat); returns per entry the triangle →
 * chart map and per-corner UVs (Float32Array, 6 per triangle), in [0, 1].
 */
export function atlas(entries, size, { pad = Math.max(2, size / 128) } = {}) {
  const all = [];
  for (const [ei, e] of entries.entries()) {
    const { chart, axis } = charts(e.P, e.I);
    const local = axis.map((ax) => ({ entry: ei, k: e.weight ?? 1, ax, tris: [], lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] }));
    for (let t = 0; t < chart.length; t++) local[chart[t]].tris.push(t);
    for (const c of local) {
      const [, ua, va] = AXES[c.ax >> 1];
      const flip = c.ax & 1 ? -1 : 1;
      c.proj = (p) => [p[ua] * flip, -p[va]];
      // Lay every chart out landscape: shelves pack much tighter.
      let lo0 = [Infinity, Infinity], hi0 = [-Infinity, -Infinity];
      for (const t of c.tris)
        for (let k = 0; k < 3; k++) {
          const v = e.I[t * 3 + k] * 3;
          const q = c.proj([e.P[v], e.P[v + 1], e.P[v + 2]]);
          lo0 = [Math.min(lo0[0], q[0]), Math.min(lo0[1], q[1])];
          hi0 = [Math.max(hi0[0], q[0]), Math.max(hi0[1], q[1])];
        }
      if (hi0[1] - lo0[1] > hi0[0] - lo0[0]) {
        const base = c.proj;
        c.proj = (p) => {
          const q = base(p);
          return [q[1], -q[0]];
        };
      }
      for (const t of c.tris)
        for (let k = 0; k < 3; k++) {
          const v = e.I[t * 3 + k] * 3;
          const q = c.proj([e.P[v], e.P[v + 1], e.P[v + 2]]);
          c.lo = [Math.min(c.lo[0], q[0]), Math.min(c.lo[1], q[1])];
          c.hi = [Math.max(c.hi[0], q[0]), Math.max(c.hi[1], q[1])];
        }
      all.push(c);
    }
  }
  // Highest texels-per-metre at which a shelf packing fits.
  const order = [...all].sort((a, b) => (b.hi[1] - b.lo[1]) * b.k - (a.hi[1] - a.lo[1]) * a.k);
  const place = (density) => {
    let x = 0, y = 0, row = 0;
    for (const c of order) {
      const w = Math.ceil((c.hi[0] - c.lo[0]) * density * c.k) + pad * 2;
      const h = Math.ceil((c.hi[1] - c.lo[1]) * density * c.k) + pad * 2;
      if (w > size) return false;
      if (x + w > size) {
        x = 0;
        y += row;
        row = 0;
      }
      if (y + h > size) return false;
      c.at = [x + pad, y + pad];
      x += w;
      row = Math.max(row, h);
    }
    return true;
  };
  let lo = 1, hi = 1;
  while (place(hi * 2)) hi *= 2;
  hi *= 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (place(mid)) lo = mid;
    else hi = mid;
  }
  place(lo);
  const density = lo;
  return {
    density,
    entries: entries.map((e, ei) => {
      const triChart = new Int32Array(e.I.length / 3);
      const uv = new Float32Array((e.I.length / 3) * 6);
      all.forEach((c, ci) => {
        if (c.entry !== ei) return;
        for (const t of c.tris) {
          triChart[t] = ci;
          for (let k = 0; k < 3; k++) {
            const v = e.I[t * 3 + k] * 3;
            const q = c.proj([e.P[v], e.P[v + 1], e.P[v + 2]]);
            uv[t * 6 + k * 2] = (c.at[0] + (q[0] - c.lo[0]) * density * c.k) / size;
            uv[t * 6 + k * 2 + 1] = (c.at[1] + (q[1] - c.lo[1]) * density * c.k) / size;
          }
        }
      });
      return { triChart, uv };
    }),
  };
}

/**
 * Gives a mesh its UVs: vertices on chart borders are split (one copy per
 * chart), carrying every per-vertex array along — normals, colours, skin
 * weights, blendshape deltas.
 */
export function withUVs(md, triChart, cornerUV) {
  const nv = md.positions.length / 3;
  const key = new Map();
  const src = [];
  const uvs = [];
  const idx = new Uint32Array(md.indices.length);
  for (let t = 0; t < md.indices.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const v = md.indices[t * 3 + k];
      const kk = triChart[t] * nv + v;
      let n = key.get(kk);
      if (n === undefined) {
        n = src.length;
        key.set(kk, n);
        src.push(v);
        uvs.push(cornerUV[t * 6 + k * 2], cornerUV[t * 6 + k * 2 + 1]);
      }
      idx[t * 3 + k] = n;
    }
  const pick = (arr, n) => {
    if (!arr) return null;
    const out = new arr.constructor(src.length * n);
    src.forEach((v, i) => {
      for (let k = 0; k < n; k++) out[i * n + k] = arr[v * n + k];
    });
    return out;
  };
  const morphs = {};
  for (const [name, m] of Object.entries(md.morphs ?? {})) morphs[name] = { dpos: pick(m.dpos, 3), dnrm: pick(m.dnrm, 3) };
  return {
    ...md,
    positions: pick(md.positions, 3),
    normals: pick(md.normals, 3),
    colors: pick(md.colors, 4),
    weights: md.weights ? src.map((v) => md.weights[v]) : null,
    tangents: pick(md.tangents, 4),
    indices: idx,
    uvs: new Float32Array(uvs),
    morphs,
  };
}

/* ── bake ────────────────────────────────────────────────────────────────── */

/**
 * Unnormalised tetrahedral gradient with samples `e` apart. A stencil as wide
 * as a texel averages away detail finer than the texel (which would only
 * alias, shimmer, and bloat the compressed map).
 */
function gradRaw(f, x, y, z, e) {
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  const k = 1 / (4 * e);
  return [(a - b - c + d) * k, (-a - b + c + d) * k, (-a + b - c + d) * k];
}

/** Tetrahedral gradient: 4 field evaluations. */
function grad4(f, x, y, z, e = 0.00025) {
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  const g = [a - b - c + d, -a - b + c + d, -a + b - c + d];
  const l = Math.hypot(...g) || 1;
  return [g[0] / l, g[1] / l, g[2] / l, l / (4 * e)];
}

/**
 * Bakes tangent-space normals for meshes laid out in one atlas. Each item is
 * { md (with uvs), field, detail?, flow? } — `detail(x, y, z)` is an optional
 * extra displacement (metres, outward) for texture finer than the field
 * holds, e.g. hair strands or knit; `flow(x, y, z)` an optional direction
 * (hair strands) for an anisotropy map. Returns { normal, aniso } RGBA bytes
 * (aniso null when no item has a flow).
 */
export function bakeNormals(items, size, { maxDist = 0.012 } = {}) {
  const img = new Uint8Array(size * size * 4);
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) img.set([128, 128, 255, 255], i * 4);
  const aniso = items.some((it) => it.flow) ? new Uint8Array(size * size * 4).fill(255) : null;
  if (aniso) for (let i = 0; i < size * size; i++) aniso.set([255, 128, 0, 255], i * 4);
  for (const { md, field, detail, flow } of items) {
    const f = detail ? (x, y, z) => field(x, y, z) - detail(x, y, z) : field;
    const P = md.positions, N = md.normals, U = md.uvs, I = md.indices;
    for (let t = 0; t < I.length / 3; t++) {
      const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
      const p = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const n = v.map((i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
      const uv = v.map((i) => [U[i * 2] * size, U[i * 2 + 1] * size]);
      // ∂p/∂u, ∂p/∂v over the triangle.
      const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1], du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1];
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      const e1 = [0, 1, 2].map((k) => p[1][k] - p[0][k]);
      const e2 = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
      const dpdu = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) / det);
      const dpdv = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) / det);
      // Half a texel, in metres: the detail is filtered to what the map can hold.
      const eDetail = Math.max(0.00025, 0.25 * (Math.hypot(...dpdu) + Math.hypot(...dpdv)));
      const x0 = Math.max(0, Math.floor(Math.min(uv[0][0], uv[1][0], uv[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(uv[0][0], uv[1][0], uv[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(uv[0][1], uv[1][1], uv[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(uv[0][1], uv[1][1], uv[2][1])));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          const w1 = ((cx - uv[0][0]) * dv2 - du2 * (cy - uv[0][1])) / det;
          const w2 = (du1 * (cy - uv[0][1]) - (cx - uv[0][0]) * dv1) / det;
          const w0 = 1 - w1 - w2;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const lp = [0, 1, 2].map((k) => w0 * p[0][k] + w1 * p[1][k] + w2 * p[2][k]);
          let ln = [0, 1, 2].map((k) => w0 * n[0][k] + w1 * n[1][k] + w2 * n[2][k]);
          const ll = Math.hypot(...ln) || 1;
          ln = ln.map((c) => c / ll);
          // Onto the field.
          let [x, y, z] = lp;
          let g = null;
          for (let s = 0; s < 4; s++) {
            const d = f(x, y, z);
            g = grad4(f, x, y, z);
            if (Math.abs(d) < 2e-5) break;
            const st = d / Math.max(g[3], 0.3);
            x -= g[0] * st;
            y -= g[1] * st;
            z -= g[2] * st;
          }
          let hn = ln;
          if (Math.hypot(x - lp[0], y - lp[1], z - lp[2]) < maxDist) {
            if (detail) {
              const gf = gradRaw(field, x, y, z, 0.00025), gd = gradRaw(detail, x, y, z, eDetail);
              const h = [gf[0] - gd[0], gf[1] - gd[1], gf[2] - gd[2]];
              const hl = Math.hypot(...h) || 1;
              hn = h.map((c) => c / hl);
            } else {
              g = grad4(f, x, y, z);
              hn = g.slice(0, 3);
            }
            // Never past the horizon of the low surface (a sample that found the wrong side of a thin part).
            if (hn[0] * ln[0] + hn[1] * ln[1] + hn[2] * ln[2] < 0.05) hn = ln;
          }
          // Tangent frame orthonormalised against the interpolated normal.
          const ortho = (a) => {
            const dd = a[0] * ln[0] + a[1] * ln[1] + a[2] * ln[2];
            const o = [a[0] - ln[0] * dd, a[1] - ln[1] * dd, a[2] - ln[2] * dd];
            const l = Math.hypot(...o) || 1;
            return o.map((c) => c / l);
          };
          const T = ortho(dpdu), B = ortho(dpdv);
          const tx = hn[0] * T[0] + hn[1] * T[1] + hn[2] * T[2];
          const ty = -(hn[0] * B[0] + hn[1] * B[1] + hn[2] * B[2]);
          const tz = Math.max(0, hn[0] * ln[0] + hn[1] * ln[1] + hn[2] * ln[2]);
          const l = Math.hypot(tx, ty, tz) || 1;
          const o = (py * size + px) * 4;
          img[o] = Math.round((tx / l * 0.5 + 0.5) * 255);
          img[o + 1] = Math.round((ty / l * 0.5 + 0.5) * 255);
          img[o + 2] = Math.round((tz / l * 0.5 + 0.5) * 255);
          mask[py * size + px] = 1;
          if (aniso && flow) {
            // Strand direction in three.js's derivative frame (T = ∂p/∂u, B = ∂p/∂v); strength in blue.
            const fd = flow(x, y, z);
            const ax = fd[0] * T[0] + fd[1] * T[1] + fd[2] * T[2], ay = fd[0] * B[0] + fd[1] * B[1] + fd[2] * B[2];
            const al = Math.hypot(ax, ay);
            if (al > 1e-6) aniso.set([Math.round((ax / al * 0.5 + 0.5) * 255), Math.round((ay / al * 0.5 + 0.5) * 255), Math.round(255 * Math.min(1, fd[3] ?? 1))], o);
          }
        }
    }
  }
  // Grow each chart's edge a few texels (enough for the mip levels that matter),
  // then fill the rest of the gutters smoothly: stretched edge texels would make
  // streaks that cost more to compress than the charts themselves.
  const ring = Math.max(4, size / 64);
  if (aniso) {
    const m = mask.slice();
    dilate(aniso, m, size, ring);
    pushPull(aniso, m, size);
  }
  dilate(img, mask, size, ring);
  pushPull(img, mask, size);
  return { normal: img, aniso };
}

/**
 * Grows covered texels into the gutters so filtering and mipmaps never read
 * the empty background: `passes` rings, or (Infinity) the whole image, each
 * empty texel taking the value of the nearest covered one (breadth-first, O(n)).
 */
export function dilate(img, mask, size, passes) {
  let frontier = [];
  for (let i = 0; i < size * size; i++) if (mask[i]) frontier.push(i);
  const seen = mask.slice();
  for (let p = 0; p < passes && frontier.length; p++) {
    const next = [];
    for (const i of frontier) {
      const x = i % size, y = (i / size) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (seen[j]) continue;
        seen[j] = 1;
        img[j * 4] = img[i * 4];
        img[j * 4 + 1] = img[i * 4 + 1];
        img[j * 4 + 2] = img[i * 4 + 2];
        next.push(j);
      }
    }
    frontier = next;
  }
  mask.set(seen);
}

/**
 * Fills every texel outside `mask` with a smooth blend of the covered ones
 * (push-pull: average down a pyramid, then interpolate back up), so gutters
 * are low-frequency and the mip chain never meets a hard edge.
 */
export function pushPull(img, mask, size) {
  const levels = [];
  let s = size;
  let col = new Float32Array(s * s * 3);
  let ok = new Uint8Array(s * s);
  for (let i = 0; i < s * s; i++) if (mask[i]) {
    ok[i] = 1;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = img[i * 4 + c];
  }
  levels.push({ s, col, ok });
  while (s > 1) {
    const h = s >> 1;
    const c2 = new Float32Array(h * h * 3), o2 = new Uint8Array(h * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < h; x++) {
        let n = 0;
        const acc = [0, 0, 0];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const j = (y * 2 + dy) * s + x * 2 + dx;
          if (!ok[j]) continue;
          n++;
          for (let c = 0; c < 3; c++) acc[c] += col[j * 3 + c];
        }
        if (n) {
          o2[y * h + x] = 1;
          for (let c = 0; c < 3; c++) c2[(y * h + x) * 3 + c] = acc[c] / n;
        }
      }
    s = h;
    col = c2;
    ok = o2;
    levels.push({ s, col, ok });
  }
  for (let L = levels.length - 2; L >= 0; L--) {
    const { s: n, col: fine, ok: fok } = levels[L];
    const { s: m, col: coarse } = levels[L + 1];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (fok[i]) continue;
        const u = Math.min(m - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), v = Math.min(m - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(m - 1, x0 + 1), y1 = Math.min(m - 1, y0 + 1);
        const fx = u - x0, fy = v - y0;
        for (let c = 0; c < 3; c++) {
          const at = (xx, yy) => coarse[(yy * m + xx) * 3 + c];
          fine[i * 3 + c] = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
        }
        fok[i] = 1;
      }
  }
  const out = levels[0].col;
  for (let i = 0; i < size * size; i++) if (!mask[i]) for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.round(out[i * 3 + c]);
}

/* ── PNG ─────────────────────────────────────────────────────────────────── */

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB PNG (the alpha of a normal map is unused), Paeth-filtered: smooth normal maps compress well this way. */
export function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const px = (x, y, k) => (x < 0 || y < 0 ? 0 : rgba[(y * w + x) * 4 + k]);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 4; // Paeth
    for (let x = 0; x < w; x++)
      for (let k = 0; k < 3; k++) {
        const a = px(x - 1, y, k), b = px(x, y - 1, k), c = px(x - 1, y - 1, k);
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        raw[row + 1 + x * 3 + k] = (px(x, y, k) - pred) & 0xff;
      }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ── GLB ─────────────────────────────────────────────────────────────────── */

/**
 * Adds normal maps (PNG or JPEG bytes) to a GLB: `maps` is [{ png, meshes: [node names],
 * aniso?: { png, strength } }]; every primitive of those nodes gets the map
 * as its material's normalTexture (materials shared with other meshes are
 * copied first), and the anisotropy map as KHR_materials_anisotropy.
 */
export function addNormalMaps(glb, maps) {
  const jl = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jl).toString("utf8"));
  let bin = glb.subarray(20 + jl + 8, 20 + jl + 8 + glb.readUInt32LE(20 + jl));
  const parts = [bin];
  let offset = bin.length;
  json.images ??= [];
  json.textures ??= [];
  json.samplers ??= [];
  json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 });
  const sampler = json.samplers.length - 1;
  const users = new Map();
  for (const n of json.nodes) if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) if (p.material !== undefined) users.set(p.material, (users.get(p.material) ?? 0) + 1);
  const addImage = (png) => {
    const pre = padTo4(offset);
    if (pre) {
      parts.push(Buffer.alloc(pre));
      offset += pre;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
    parts.push(png);
    offset += png.length;
    json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: png[0] === 0xff && png[1] === 0xd8 ? "image/jpeg" : "image/png" });
    json.textures.push({ sampler, source: json.images.length - 1 });
    return json.textures.length - 1;
  };
  for (const { png, meshes, aniso } of maps) {
    const tex = addImage(png);
    const atex = aniso ? addImage(aniso.png) : null;
    if (aniso) {
      json.extensionsUsed ??= [];
      if (!json.extensionsUsed.includes("KHR_materials_anisotropy")) json.extensionsUsed.push("KHR_materials_anisotropy");
    }
    for (const n of json.nodes) {
      if (n.mesh === undefined || !meshes.includes(n.name)) continue;
      for (const p of json.meshes[n.mesh].primitives) {
        if (p.material === undefined) continue;
        if (users.get(p.material) > 1) {
          json.materials.push(JSON.parse(JSON.stringify(json.materials[p.material])));
          users.set(p.material, users.get(p.material) - 1);
          p.material = json.materials.length - 1;
          users.set(p.material, 1);
        }
        const m = json.materials[p.material];
        m.normalTexture = { index: tex };
        if (aniso) {
          m.extensions ??= {};
          m.extensions.KHR_materials_anisotropy = { anisotropyStrength: aniso.strength ?? 1, anisotropyTexture: { index: atex } };
        }
      }
    }
  }
  const end = padTo4(offset);
  if (end) parts.push(Buffer.alloc(end));
  bin = Buffer.concat(parts);
  json.buffers[0].byteLength = bin.length;
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc(padTo4(js.length), 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
}
const padTo4 = (n) => (4 - (n % 4)) % 4;

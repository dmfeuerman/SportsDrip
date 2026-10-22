/**
 * Signed-distance modelling for the base character.
 *
 * The body and head are written as distance functions (smooth unions of
 * ellipsoids, swept limbs and so on), which is what gives one continuous
 * surface with soft anatomical blends at the shoulders, hips and jaw instead
 * of separate parts. `meshSDF` turns a distance function into a mesh:
 *
 *   sparse grid sample → surface nets (quads) → project onto the surface
 *   → triangulate → error-driven simplification (meshoptimizer)
 *   → normals from the field gradient → baked ambient occlusion
 *
 * Everything is deterministic; the same inputs always give the same GLB.
 */
import { MeshoptSimplifier } from "./vendor/meshopt_simplifier.mjs";

/* ── field operators ─────────────────────────────────────────────────────── */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth minimum: blends two surfaces over a band of width k. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export const smax = (a, b, k) => -smin(-a, -b, k);

/** Inigo Quilez's ellipsoid bound — close to a true distance near the surface. */
export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  if (k0 < 1e-9) return -Math.min(rx, ry, rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return (k0 * (k0 - 1)) / k1;
}

/** Capsule from a to b whose radius goes ra → rb. */
export function sdCone(px, py, pz, a, b, ra, rb) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const qx = px - a[0], qy = py - a[1], qz = pz - a[2];
  const t = clamp((qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  return Math.hypot(qx - bx * t, qy - by * t, qz - bz * t) - (ra + (rb - ra) * t);
}

export function sdRoundBox(x, y, z, hx, hy, hz, r) {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** 3×3 rotation from XYZ Euler angles, as a row-major array. */
export function rotation(rx, ry, rz) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // R = Rz * Ry * Rx (three.js 'XYZ' order)
  return [
    cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz,
    cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz,
    -sy, sx * cy, cx * cy,
  ];
}

/** p into a rotated frame (R transposed applied to p - c). */
export function toLocal(R, c, x, y, z) {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  return [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
}

/**
 * A swept tube: elliptical cross-sections along a polyline of samples
 * { c, rx, rz, side, front, t }. Returns distance and the nearest sample
 * parameter (used for skin weights).
 */
export class Sweep {
  constructor(samples) {
    this.s = samples;
    const pad = Math.max(...samples.map((s) => Math.max(s.rx, s.rz))) + 0.02;
    this.min = [0, 1, 2].map((i) => Math.min(...samples.map((s) => s.c[i])) - pad);
    this.max = [0, 1, 2].map((i) => Math.max(...samples.map((s) => s.c[i])) + pad);
  }

  near(x, y, z, m = 0) {
    return x > this.min[0] - m && x < this.max[0] + m && y > this.min[1] - m && y < this.max[1] + m && z > this.min[2] - m && z < this.max[2] + m;
  }

  eval(x, y, z) {
    const S = this.s;
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i].c, b = S[i + 1].c;
      const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
      const qx = x - a[0], qy = y - a[1], qz = z - a[2];
      const t = clamp((qx * ex + qy * ey + qz * ez) / (ex * ex + ey * ey + ez * ez), 0, 1);
      const dx = qx - ex * t, dy = qy - ey * t, dz = qz - ez * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
      }
    }
    const A = S[bi], B = S[bi + 1];
    const l = (u, v) => u + (v - u) * bt;
    const cx = l(A.c[0], B.c[0]), cy = l(A.c[1], B.c[1]), cz = l(A.c[2], B.c[2]);
    const sx = l(A.side[0], B.side[0]), sy = l(A.side[1], B.side[1]), sz = l(A.side[2], B.side[2]);
    const fx = l(A.front[0], B.front[0]), fy = l(A.front[1], B.front[1]), fz = l(A.front[2], B.front[2]);
    const sn = Math.hypot(sx, sy, sz), fn = Math.hypot(fx, fy, fz);
    const ex = B.c[0] - A.c[0], ey = B.c[1] - A.c[1], ez = B.c[2] - A.c[2];
    const en = Math.hypot(ex, ey, ez);
    const qx = x - cx, qy = y - cy, qz = z - cz;
    const u = (qx * sx + qy * sy + qz * sz) / sn;
    const v = (qx * fx + qy * fy + qz * fz) / fn;
    const w = (qx * ex + qy * ey + qz * ez) / en;
    const rx = l(A.rx, B.rx), rz = l(A.rz, B.rz);
    return { d: sdEllipsoid(u, v, w, rx, rz, Math.min(rx, rz)), t: l(A.t, B.t) };
  }
}

/* ── meshing ─────────────────────────────────────────────────────────────── */

/**
 * Surface nets over a sparse grid. `f(x, y, z)` is the distance function,
 * `box` = [[minx, miny, minz], [maxx, maxy, maxz]], `h` the cell size.
 * Returns { positions: Float32Array, indices: Uint32Array }.
 */
export function surfaceNets(f, box, h) {
  const [lo, hi] = box;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const B = 8;
  const bx = Math.ceil((nx - 1) / B), by = Math.ceil((ny - 1) / B), bz = Math.ceil((nz - 1) / B);
  const N = nx * ny * nz;
  const vals = new Float32Array(N);
  const active = new Uint8Array(bx * by * bz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  const P = (i, j, k) => [lo[0] + i * h, lo[1] + j * h, lo[2] + k * h];

  // Coarse pass: a block whose centre is further from the surface than its
  // half-diagonal (with margin for the approximate distances) is skipped.
  const reach = Math.sqrt(3) * (B / 2) * h * 1.6 + 2 * h;
  for (let K = 0; K < bz; K++)
    for (let J = 0; J < by; J++)
      for (let I = 0; I < bx; I++) {
        const c = P(I * B + B / 2, J * B + B / 2, K * B + B / 2);
        const d = f(c[0], c[1], c[2]);
        const bi = (K * by + J) * bx + I;
        if (Math.abs(d) < reach) {
          active[bi] = 1;
        } else {
          const fill = d;
          for (let k = K * B; k <= Math.min(nz - 1, K * B + B); k++)
            for (let j = J * B; j <= Math.min(ny - 1, J * B + B); j++)
              for (let i = I * B; i <= Math.min(nx - 1, I * B + B); i++) {
                const n = idx(i, j, k);
                if (vals[n] === 0) vals[n] = fill;
              }
        }
      }
  const done = new Uint8Array(N);
  for (let K = 0; K < bz; K++)
    for (let J = 0; J < by; J++)
      for (let I = 0; I < bx; I++) {
        if (!active[(K * by + J) * bx + I]) continue;
        for (let k = K * B; k <= Math.min(nz - 1, K * B + B); k++)
          for (let j = J * B; j <= Math.min(ny - 1, J * B + B); j++)
            for (let i = I * B; i <= Math.min(nx - 1, I * B + B); i++) {
              const n = idx(i, j, k);
              if (done[n]) continue;
              done[n] = 1;
              const p = P(i, j, k);
              vals[n] = f(p[0], p[1], p[2]);
            }
      }

  // One vertex per cell that straddles the surface.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let K = 0; K < bz; K++)
    for (let J = 0; J < by; J++)
      for (let I = 0; I < bx; I++) {
        if (!active[(K * by + J) * bx + I]) continue;
        for (let k = K * B; k < Math.min(nz - 1, K * B + B); k++)
          for (let j = J * B; j < Math.min(ny - 1, J * B + B); j++)
            for (let i = I * B; i < Math.min(nx - 1, I * B + B); i++) {
              let mask = 0;
              for (let c = 0; c < 8; c++) {
                const o = corners[c];
                cv[c] = vals[idx(i + o[0], j + o[1], k + o[2])];
                if (cv[c] < 0) mask |= 1 << c;
              }
              if (mask === 0 || mask === 255) continue;
              let sx = 0, sy = 0, sz = 0, cnt = 0;
              for (const [a, b] of edges) {
                if (cv[a] < 0 === cv[b] < 0) continue;
                const t = cv[a] / (cv[a] - cv[b]);
                const A = corners[a], Bc = corners[b];
                sx += A[0] + (Bc[0] - A[0]) * t;
                sy += A[1] + (Bc[1] - A[1]) * t;
                sz += A[2] + (Bc[2] - A[2]) * t;
                cnt++;
              }
              cellVert[cidx(i, j, k)] = pos.length / 3;
              pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
            }
      }

  // A quad around every grid edge the surface crosses.
  const byAxis = [[], [], []];
  const quad = (a, b, c, d, flip, axis) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    byAxis[axis].push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[idx(i, j, k)];
        if (cellVert[cidx(i, j, k)] < 0 && cellVert[cidx(i - 1, j - 1, k - 1)] < 0) {
          // Fast reject: none of the 3 edges from this corner can be crossed.
          const nxv = vals[idx(i + 1, j, k)], nyv = vals[idx(i, j + 1, k)], nzv = vals[idx(i, j, k + 1)];
          if (v0 < 0 === nxv < 0 && v0 < 0 === nyv < 0 && v0 < 0 === nzv < 0) continue;
        }
        const s0 = v0 < 0;
        if (s0 !== vals[idx(i + 1, j, k)] < 0)
          quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], !s0, 0);
        if (s0 !== vals[idx(i, j + 1, k)] < 0)
          quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], !s0, 1);
        if (s0 !== vals[idx(i, j, k + 1)] < 0)
          quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], !s0, 2);
      }
  // Winding per edge axis: check a sample against the field gradient and
  // flip the whole axis group if it faces inward.
  const tris = [];
  for (const group of byAxis) {
    let score = 0;
    const stepT = Math.max(3, Math.floor(group.length / 3 / 300) * 3);
    for (let t = 0; t < group.length; t += stepT) {
      const a = group[t] * 3, b = group[t + 1] * 3, c = group[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const g = gradient(f, (pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3);
      score += Math.sign(n[0] * g[0] + n[1] * g[1] + n[2] * g[2]);
    }
    for (let t = 0; t < group.length; t += 3) {
      if (score >= 0) tris.push(group[t], group[t + 1], group[t + 2]);
      else tris.push(group[t], group[t + 2], group[t + 1]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(tris) };
}

export function gradient(f, x, y, z, e = 0.0004) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const n = Math.hypot(gx, gy, gz) || 1;
  return [gx / n, gy / n, gz / n, n / (2 * e)];
}

/** Pulls every vertex onto the zero level set (a few Newton steps). */
export function project(f, positions, steps = 3, maxMove = 0.004) {
  for (let i = 0; i < positions.length; i += 3) {
    const x0 = positions[i], y0 = positions[i + 1], z0 = positions[i + 2];
    let x = x0, y = y0, z = z0;
    for (let s = 0; s < steps; s++) {
      const d = f(x, y, z);
      if (Math.abs(d) < 1e-6) break;
      const [nx, ny, nz, g] = gradient(f, x, y, z);
      const step = d / Math.max(g, 0.2);
      x -= nx * step;
      y -= ny * step;
      z -= nz * step;
    }
    // A step that runs away means the field is discontinuous here: keep the
    // surface-nets position instead.
    if (Math.hypot(x - x0, y - y0, z - z0) > maxMove) continue;
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
}

/** Drops triangles whose centroid fails `keep`, then unused vertices. */
export function filterMesh(mesh, keep) {
  const { positions: P, indices: I } = mesh;
  const out = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (keep((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3)) out.push(I[t], I[t + 1], I[t + 2]);
  }
  return compact({ positions: P, indices: new Uint32Array(out) });
}

export function compact({ positions, indices }) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  const pos = [];
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (map[v] < 0) {
      map[v] = pos.length / 3;
      pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    idx[i] = map[v];
  }
  return { positions: new Float32Array(pos), indices: idx };
}

/**
 * Error-bounded simplification toward `targetTris`. `error` is an absolute
 * distance in metres: the simplifier never moves the surface further than
 * that, so small features (lips, lid margins, seams) survive.
 */
export async function simplify(mesh, targetTris, { error = 0.0005, lockBorder = true } = {}) {
  await MeshoptSimplifier.ready;
  const target = Math.min(mesh.indices.length, targetTris * 3);
  const flags = ["ErrorAbsolute", ...(lockBorder ? ["LockBorder"] : [])];
  const [idx] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target - (target % 3), error, flags);
  return compact({ positions: mesh.positions, indices: idx });
}

/**
 * Full pipeline: SDF → simplified, projected mesh with field normals.
 * `keep` optionally trims the mesh (e.g. the head below the jaw seam).
 */
export async function meshSDF(f, box, h, { targetTris, keep = null, error = 0.0005 } = {}) {
  let m = surfaceNets(f, box, h);
  project(f, m.positions, 2);
  if (keep) m = filterMesh(m, keep);
  if (targetTris) m = await simplify(m, targetTris, { error });
  project(f, m.positions, 2);
  const normals = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const [nx, ny, nz] = gradient(f, m.positions[i], m.positions[i + 1], m.positions[i + 2]);
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
  return { ...m, normals };
}

/**
 * Ambient occlusion from the field: how much closer the surface gets than
 * expected when stepping out along the normal. Cheap, and exactly what
 * darkens armpits, ears, nostrils, between fingers and under the jaw.
 */
export function bakeAO(f, mesh, { step = 0.006, samples = 5, strength = 1.4, min = 0.42 } = {}) {
  const ao = new Float32Array(mesh.positions.length / 3);
  for (let v = 0; v < ao.length; v++) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    const nx = mesh.normals[v * 3], ny = mesh.normals[v * 3 + 1], nz = mesh.normals[v * 3 + 2];
    // Bound fields (smooth unions, ellipsoid approximations) aren't unit-gradient;
    // compare against the field's own rate of change so flat areas stay unshaded.
    const g = clamp(gradient(f, x, y, z, 0.001)[3], 0.3, 1.5);
    const d0 = f(x, y, z);
    let occ = 0;
    let w = 0.5;
    for (let i = 1; i <= samples; i++) {
      const h = i * step;
      occ += (w * Math.max(0, h * g - (f(x + nx * h, y + ny * h, z + nz * h) - d0))) / (h * g);
      w *= 0.5;
    }
    ao[v] = clamp(1 - strength * occ, min, 1);
  }
  return ao;
}

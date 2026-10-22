/**
 * A small GLB reader for the asset checks (validate, fitcheck, hatfit) — no
 * renderer, no dependencies. Reads every accessor type the generator writes,
 * including KHR_mesh_quantization's normalised integers, and gives meshes
 * back in rest-pose world space: rigid parts through their node transforms,
 * skinned parts through their bind (joint world × inverse bind matrix).
 */
import { readFileSync, writeFileSync } from "node:fs";

export function readGlb(src) {
  const buf = Buffer.isBuffer(src) ? src : readFileSync(src);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  if (buf.readUInt32LE(4) !== 2) throw new Error("glTF version must be 2");
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error("no JSON chunk");
  return { json, bin };
}

/** Writes a GLB from its JSON and binary chunk (the JSON padded with spaces, the binary with zeros). */
export function writeGlb(file, json, bin) {
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = bin ? Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]) : null;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + (b ? 8 + b.length : 0), 8);
  const chunk = (len, type) => {
    const c = Buffer.alloc(8);
    c.writeUInt32LE(len, 0);
    c.writeUInt32LE(type, 4);
    return c;
  };
  writeFileSync(file, Buffer.concat([head, chunk(js.length, 0x4e4f534a), js, ...(b ? [chunk(b.length, 0x004e4942), b] : [])]));
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = {
  5120: [1, "getInt8", 127],
  5121: [1, "getUint8", 255],
  5122: [2, "getInt16", 32767],
  5123: [2, "getUint16", 65535],
  5125: [4, "getUint32", 1],
  5126: [4, "getFloat32", 1],
};

/**
 * An accessor as a flat Float32Array (normalised integers mapped to [-1, 1] /
 * [0, 1]); indices as Uint32Array. Sparse accessors (morph targets that move
 * only part of a mesh) are expanded.
 */
export function accessor(json, bin, index, { int = false } = {}) {
  const a = json.accessors[index];
  const n = COMPONENTS[a.type];
  const [size, get, max] = TYPES[a.componentType];
  const out = int ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
  const read = (viewIndex, byteOffset, count, comps, csize, getter, norm, stride0) => {
    const view = json.bufferViews[viewIndex];
    const stride = stride0 ?? view.byteStride ?? comps * csize;
    const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0) + (byteOffset ?? 0));
    const r = new Float64Array(count * comps);
    for (let i = 0; i < count; i++)
      for (let k = 0; k < comps; k++) {
        let v = dv[getter](i * stride + k * csize, true);
        if (norm) v = Math.max(v / norm, -1);
        r[i * comps + k] = v;
      }
    return r;
  };
  if (a.bufferView !== undefined) out.set(read(a.bufferView, a.byteOffset, a.count, n, size, get, a.normalized ? max : 0));
  if (a.sparse) {
    const { count, indices, values } = a.sparse;
    const [isize, iget] = TYPES[indices.componentType];
    const idx = read(indices.bufferView, indices.byteOffset, count, 1, isize, iget, 0, isize);
    const val = read(values.bufferView, values.byteOffset, count, n, size, get, a.normalized ? max : 0, n * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) out[idx[i] * n + k] = val[i * n + k];
  }
  return out;
}

/* ── 4×4 matrices, column-major like glTF ────────────────────────────────── */

export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

export const point = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
export const dir = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];

const localMatrix = (n) => n.matrix ?? compose(n.translation, n.rotation, n.scale);

/** World matrix of every node, and each node's parent index. */
export function worldMatrices(json) {
  const nodes = json.nodes ?? [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const world = new Array(nodes.length);
  const get = (i) => world[i] ?? (world[i] = parent[i] < 0 ? localMatrix(nodes[i]) : mul(get(parent[i]), localMatrix(nodes[i])));
  nodes.forEach((_, i) => get(i));
  return { world, parent };
}

/**
 * Every mesh primitive in rest-pose world space:
 * { name, node, material, skinned, pos, nrm, idx, targets: { name: dpos } }.
 */
export function restMeshes(json, bin) {
  const { world } = worldMatrices(json);
  const out = [];
  (json.nodes ?? []).forEach((n, ni) => {
    if (n.mesh === undefined) return;
    let M = world[ni];
    if (n.skin !== undefined) {
      const skin = json.skins[n.skin];
      const ibm = skin.inverseBindMatrices !== undefined ? Array.from(accessor(json, bin, skin.inverseBindMatrices).subarray(0, 16)) : compose();
      M = mul(world[skin.joints[0]], ibm);
    }
    const mesh = json.meshes[n.mesh];
    const names = mesh.extras?.targetNames ?? [];
    for (const p of mesh.primitives) {
      const raw = accessor(json, bin, p.attributes.POSITION);
      const pos = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) pos.set(point(M, [raw[i], raw[i + 1], raw[i + 2]]), i);
      let nrm = null;
      if (p.attributes.NORMAL !== undefined) {
        const rn = accessor(json, bin, p.attributes.NORMAL);
        nrm = new Float32Array(rn.length);
        for (let i = 0; i < rn.length; i += 3) {
          const d = dir(M, [rn[i], rn[i + 1], rn[i + 2]]);
          const l = Math.hypot(...d) || 1;
          nrm.set([d[0] / l, d[1] / l, d[2] / l], i);
        }
      }
      const idx = p.indices !== undefined ? accessor(json, bin, p.indices, { int: true }) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const targets = {};
      (p.targets ?? []).forEach((t, k) => {
        if (t.POSITION === undefined) return;
        const rd = accessor(json, bin, t.POSITION);
        const d = new Float32Array(rd.length);
        for (let i = 0; i < rd.length; i += 3) d.set(dir(M, [rd[i], rd[i + 1], rd[i + 2]]), i);
        targets[names[k] ?? `target${k}`] = d;
      });
      out.push({ name: n.name, node: ni, material: json.materials?.[p.material]?.name ?? null, skinned: n.skin !== undefined, pos, nrm, idx, targets });
    }
  });
  return out;
}

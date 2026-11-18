/**
 * Sparse morph targets, written correctly.
 *
 * glTF-Transform's sparse() zeroes the values of sparse *normalised* integer
 * accessors (the KHR_mesh_quantization morph targets), which flattened almost
 * every face and build blendshape. This re-encodes, after quantisation, any
 * morph-target accessor that moves fewer than `ratio` of its vertices as a
 * sparse accessor — indices plus the raw integer values, unchanged — and
 * compacts the binary chunk so the dense copies are dropped.
 */
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parse(glb) {
  const buf = Buffer.from(glb);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

function build(json, bin) {
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
  const chunk = (len, type) => {
    const c = Buffer.alloc(8);
    c.writeUInt32LE(len, 0);
    c.writeUInt32LE(type, 4);
    return c;
  };
  return Buffer.concat([head, chunk(js.length, 0x4e4f534a), js, chunk(b.length, 0x004e4942), b]);
}

export function sparsifyMorphs(glb, { ratio = 1 / 3 } = {}) {
  const { json, bin } = parse(glb);
  if (!json?.accessors || !json.bufferViews) return Buffer.from(glb);
  const targets = new Set();
  for (const m of json.meshes ?? []) for (const p of m.primitives) for (const t of p.targets ?? []) for (const a of Object.values(t)) targets.add(a);

  // Pieces of the new binary chunk, and each bufferView's new home.
  const parts = [];
  let length = 0;
  const push = (bytes) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const at = length;
    parts.push(bytes);
    length += bytes.length;
    return at;
  };
  const newViews = [];
  const addView = (bytes, extra = {}) => {
    newViews.push({ buffer: 0, byteOffset: push(bytes), byteLength: bytes.length, ...extra });
    return newViews.length - 1;
  };

  // Which accessors become sparse.
  const sparse = new Map(); // accessor index → { idx: Uint16Array|Uint32Array, vals: Buffer }
  for (const ai of targets) {
    const a = json.accessors[ai];
    if (a.sparse || a.bufferView === undefined) continue;
    const view = json.bufferViews[a.bufferView];
    const n = COMPS[a.type], size = SIZE[a.componentType];
    const stride = view.byteStride ?? n * size;
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const moved = [];
    for (let i = 0; i < a.count; i++) {
      const at = base + i * stride;
      let nz = false;
      for (let b = 0; b < n * size && !nz; b++) if (bin[at + b] !== 0) nz = true;
      if (nz) moved.push(i);
    }
    if (moved.length >= a.count * ratio) continue;
    if (!moved.length) moved.push(0); // a target that moves nothing: glTF needs count ≥ 1 (its value is zero)
    const idx = a.count > 65535 ? new Uint32Array(moved) : new Uint16Array(moved);
    const vals = Buffer.alloc(moved.length * n * size);
    moved.forEach((i, k) => bin.copy(vals, k * n * size, base + i * stride, base + i * stride + n * size));
    sparse.set(ai, { idx, vals });
  }
  if (!sparse.size) return Buffer.from(glb);

  // Copy every bufferView still referenced (by images, dense accessors, sparse parts we keep).
  const used = new Set();
  json.accessors.forEach((a, ai) => {
    if (a.bufferView !== undefined && !sparse.has(ai)) used.add(a.bufferView);
    if (a.sparse) {
      used.add(a.sparse.indices.bufferView);
      used.add(a.sparse.values.bufferView);
    }
  });
  for (const img of json.images ?? []) if (img.bufferView !== undefined) used.add(img.bufferView);
  const remap = new Map();
  json.bufferViews.forEach((v, vi) => {
    if (!used.has(vi)) return;
    const { byteOffset = 0, byteLength, ...rest } = v;
    remap.set(vi, addView(bin.subarray(byteOffset, byteOffset + byteLength), { ...rest, buffer: 0 }));
  });
  json.accessors.forEach((a, ai) => {
    if (sparse.has(ai)) {
      const { idx, vals } = sparse.get(ai);
      const iv = addView(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
      const vv = addView(vals);
      delete a.bufferView;
      delete a.byteOffset;
      a.sparse = {
        count: idx.length,
        indices: { bufferView: iv, componentType: idx instanceof Uint32Array ? 5125 : 5123 },
        values: { bufferView: vv },
      };
      return;
    }
    if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
    if (a.sparse) {
      a.sparse.indices.bufferView = remap.get(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = remap.get(a.sparse.values.bufferView);
    }
  });
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = remap.get(img.bufferView);
  json.bufferViews = newViews;
  const out = Buffer.concat(parts);
  json.buffers = [{ byteLength: out.length }];
  return build(json, out);
}

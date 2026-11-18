#!/usr/bin/env node
/**
 * Reads `art/source_pair_glb/base_basic_pbr.glb`, splits its Male (x > 0) and
 * Female (x < 0) characters into `RawMale` and `RawFemale` centered at (0, 0, 0),
 * welds positions for watertight 2-pass UV-preserving Loop subdivision (1k -> 16k tris)
 * with unified smooth normals (zero faceted creases on face/limbs), and writes
 * `assets/avatar/sd_base_v3.glb` with native PBR textures.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const here = dirname(fileURLToPath(import.meta.url));
const SRC_GLB = join(here, "art", "source_pair_glb", "base_basic_pbr.glb");
const OUT_GLB = join(here, "..", "..", "assets", "avatar", "sd_base_v3.glb");

/** Extract a welded-position + per-corner-UV component from the source GLB. */
function extractWeldedComp(P, UV, I, pred, targetHeight) {
  const keyMap = new Map();
  const pos = [];
  const tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
    if (!pred(cx)) continue;
    const vi = [];
    const uvs = [];
    for (const v of [a, b, c]) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      const key = `${Math.round(px * 20000)},${Math.round(py * 20000)},${Math.round(pz * 20000)}`;
      let id = keyMap.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        keyMap.set(key, id);
        pos.push(px, py, pz);
      }
      vi.push(id);
      uvs.push([UV[v * 2], UV[v * 2 + 1]]);
    }
    if (vi[0] !== vi[1] && vi[1] !== vi[2] && vi[2] !== vi[0]) {
      tris.push({ v: vi, uv: uvs });
    }
  }

  const outP = new Float32Array(pos);
  const nv = outP.length / 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    minX = Math.min(minX, outP[i * 3]); maxX = Math.max(maxX, outP[i * 3]);
    minY = Math.min(minY, outP[i * 3 + 1]); maxY = Math.max(maxY, outP[i * 3 + 1]);
    minZ = Math.min(minZ, outP[i * 3 + 2]); maxZ = Math.max(maxZ, outP[i * 3 + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const s = targetHeight / (maxY - minY);
  for (let i = 0; i < nv; i++) {
    outP[i * 3] = (outP[i * 3] - cx) * s;
    outP[i * 3 + 1] = (outP[i * 3 + 1] - minY) * s;
    outP[i * 3 + 2] = (outP[i * 3 + 2] - cz) * s;
  }
  return { positions: outP, tris };
}

/** 1 pass of UV-preserving Loop subdivision on a welded watertight mesh. */
function loopSubdivideWithUVs(positions, tris) {
  const nv = positions.length / 3;
  const edgeMap = new Map();
  const neighbors = Array.from({ length: nv }, () => new Set());
  const eKey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);

  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const u = t.v[k], v = t.v[(k + 1) % 3], w = t.v[(k + 2) % 3];
      neighbors[u].add(v); neighbors[v].add(u);
      const key = eKey(u, v);
      let e = edgeMap.get(key);
      if (!e) {
        e = { u: Math.min(u, v), v: Math.max(u, v), opp: [], midIdx: -1 };
        edgeMap.set(key, e);
      }
      e.opp.push(w);
    }
  }

  const outPos = [];
  for (let v = 0; v < nv; v++) {
    const nbrs = [...neighbors[v]];
    const k = nbrs.length;
    const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
    let sx = 0, sy = 0, sz = 0;
    for (const u of nbrs) {
      sx += positions[u * 3]; sy += positions[u * 3 + 1]; sz += positions[u * 3 + 2];
    }
    const w0 = 1 - k * beta;
    outPos.push(w0 * positions[v * 3] + beta * sx, w0 * positions[v * 3 + 1] + beta * sy, w0 * positions[v * 3 + 2] + beta * sz);
  }

  for (const e of edgeMap.values()) {
    e.midIdx = outPos.length / 3;
    const u = e.u * 3, v = e.v * 3;
    if (e.opp.length === 2) {
      const w1 = e.opp[0] * 3, w2 = e.opp[1] * 3;
      outPos.push(
        0.375 * (positions[u] + positions[v]) + 0.125 * (positions[w1] + positions[w2]),
        0.375 * (positions[u + 1] + positions[v + 1]) + 0.125 * (positions[w1 + 1] + positions[w2 + 1]),
        0.375 * (positions[u + 2] + positions[v + 2]) + 0.125 * (positions[w1 + 2] + positions[w2 + 2])
      );
    } else {
      outPos.push(0.5 * (positions[u] + positions[v]), 0.5 * (positions[u + 1] + positions[v + 1]), 0.5 * (positions[u + 2] + positions[v + 2]));
    }
  }

  const midUV = (a, b) => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
  const outTris = [];
  for (const t of tris) {
    const [a, b, c] = t.v;
    const [ua, ub, uc] = t.uv;
    const ab = edgeMap.get(eKey(a, b)).midIdx;
    const bc = edgeMap.get(eKey(b, c)).midIdx;
    const ca = edgeMap.get(eKey(c, a)).midIdx;
    const uab = midUV(ua, ub), ubc = midUV(ub, uc), uca = midUV(uc, ua);
    outTris.push({ v: [a, ab, ca], uv: [ua, uab, uca] });
    outTris.push({ v: [ab, b, bc], uv: [uab, ub, ubc] });
    outTris.push({ v: [ca, bc, c], uv: [uca, ubc, uc] });
    outTris.push({ v: [ab, bc, ca], uv: [uab, ubc, uca] });
  }
  return { positions: new Float32Array(outPos), tris: outTris };
}

/** Expand subdivided welded mesh to glTF buffers with unified smooth vertex normals across all seams. */
function expandSmooth(comp) {
  const P = comp.positions;
  const n = P.length / 3;
  const normals = new Float32Array(n * 3);
  for (const t of comp.tris) {
    const [a, b, c] = t.v;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= l; normals[v * 3 + 1] /= l; normals[v * 3 + 2] /= l;
  }

  const keyMap = new Map();
  const pos = [], nrm = [], uvs = [], idx = [];
  for (const t of comp.tris) {
    for (let k = 0; k < 3; k++) {
      const v = t.v[k];
      const [u, w] = t.uv[k];
      const key = `${v}_${Math.round(u * 10000)}_${Math.round(w * 10000)}`;
      let id = keyMap.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        keyMap.set(key, id);
        pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        uvs.push(u, w);
      }
      idx.push(id);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(idx),
  };
}

async function main() {
  mkdirSync(dirname(OUT_GLB), { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const srcDoc = await io.read(SRC_GLB);
  const srcRoot = srcDoc.getRoot();
  const srcNode = srcRoot.listNodes().find((n) => n.getMesh());
  const srcPrim = srcNode.getMesh().listPrimitives()[0];
  const srcMat = srcPrim.getMaterial();

  const P = srcPrim.getAttribute("POSITION").getArray();
  const UV = srcPrim.getAttribute("TEXCOORD_0").getArray();
  const I = srcPrim.getIndices().getArray();

  // Extract welded watertight Male & Female meshes and apply 2 passes of UV-preserving Loop subdivision.
  let male = extractWeldedComp(P, UV, I, (cx) => cx > 0, 1.8);
  let female = extractWeldedComp(P, UV, I, (cx) => cx < 0, 1.72);
  for (let pass = 0; pass < 2; pass++) {
    male = loopSubdivideWithUVs(male.positions, male.tris);
    female = loopSubdivideWithUVs(female.positions, female.tris);
  }
  const maleOut = expandSmooth(male);
  const femaleOut = expandSmooth(female);

  const resizeJpeg = async (tex, size = 1024, quality = 92) =>
    sharp(Buffer.from(tex.getImage())).resize(size, size).jpeg({ quality }).toBuffer();

  const diffBuf = await resizeJpeg(srcMat.getBaseColorTexture(), 1536, 92);
  const normBuf = await resizeJpeg(srcMat.getNormalTexture(), 1024, 90);
  const mrBuf = await resizeJpeg(srcMat.getMetallicRoughnessTexture(), 1024, 88);

  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("sd_base");
  const root = doc.createNode("Avatar");
  scene.addChild(root);

  const diffTex = doc.createTexture("diffuse").setMimeType("image/jpeg").setImage(diffBuf);
  const normTex = doc.createTexture("normal").setMimeType("image/jpeg").setImage(normBuf);
  const mrTex = doc.createTexture("metallic_roughness").setMimeType("image/jpeg").setImage(mrBuf);

  // Subtle normalScale (0.35) preserves fine skin/muscle detail while letting the new smooth geometry dominate
  // (preventing the original 1k-tri flat-cage normal map from re-introducing hard triangle facets on the face).
  const mat = doc.createMaterial("raw_pair")
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(diffTex)
    .setNormalTexture(normTex)
    .setNormalScale(0.35)
    .setMetallicRoughnessTexture(mrTex)
    .setRoughnessFactor(srcMat.getRoughnessFactor())
    .setMetallicFactor(srcMat.getMetallicFactor());

  const addModel = (name, m) => {
    const mesh = doc.createMesh(name);
    const prim = doc.createPrimitive()
      .setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setBuffer(buf).setArray(m.positions).setType("VEC3"))
      .setAttribute("NORMAL", doc.createAccessor().setBuffer(buf).setArray(m.normals).setType("VEC3"))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setBuffer(buf).setArray(m.uvs).setType("VEC2"))
      .setIndices(doc.createAccessor().setBuffer(buf).setArray(m.indices).setType("SCALAR"));
    mesh.addPrimitive(prim);
    root.addChild(doc.createNode(name).setMesh(mesh));
  };

  addModel("RawMale", maleOut);
  addModel("RawFemale", femaleOut);

  await io.write(OUT_GLB, doc);
  console.log(
    `Wrote ${OUT_GLB} (RawMale: ${maleOut.indices.length / 3} tris, RawFemale: ${femaleOut.indices.length / 3} tris, textures: ${(diffBuf.length / 1024).toFixed(0)} KB diff + ${(normBuf.length / 1024).toFixed(0)} KB norm + ${(mrBuf.length / 1024).toFixed(0)} KB MR)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

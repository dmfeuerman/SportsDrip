#!/usr/bin/env node
/**
 * Converts `art/source_pair/base.obj` (containing both the male and female
 * stylized athletic meshes) + `art/source_pair/texture_normal.png` into
 * `scripts/avatar/art/base.glb` aligned to `sd_rig_v3`.
 *
 *   - Extracts the watertight Male (x > 0) and Female (x < 0) components
 *   - Preserves original OBJ UVs through UV-aware Loop subdivision (3,920 tris)
 *   - Embeds the 1024x1024 normal map resized from `texture_normal.png`
 *   - Projects Male -> Female for true `frameFem` morphs
 *   - Computes unified smooth normals across the neck seam (zero gap/crease)
 *   - Extracts fitted `Underwear` and `Bra` directly from the Male/Female surfaces
 *   - Places `Eyes`, `Iris`, `Pupils`, `Lids_*`, `Lashes_*`, `Brows_*` into the eye sockets
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { BONE_NAMES, BONES, EYE_SHAPES, EYEBROWS, FACE_SHAPES, HEAD, NOSE_SHAPES, REST, RIG_ID, sideBone } from "./rig.mjs";
import { bodyTint, headTint } from "./character.mjs";
import { EYE_SHAPE, GAZE_IN, irisShade } from "./face.mjs";
import { MeshBuilder, tube } from "./geometry.mjs";
import { clamp, gauss, sstep } from "./sdf.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ART_DIR = join(here, "art");
const SRC_DIR = join(ART_DIR, "source_pair");
const SRC_OBJ = join(SRC_DIR, "base.obj");
const SRC_NORM = join(SRC_DIR, "texture_normal.png");
const OUT_GLB = join(ART_DIR, "base.glb");

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const NECK_SPLIT_Y = 1.505;

/* ── OBJ parsing (with per-corner UVs) ───────────────────────────────────── */

function parseObjPair(file) {
  const txt = readFileSync(file, "utf8");
  const V = [], VT = [], F = [];
  for (const line of txt.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "v") V.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === "vt") VT.push([+p[1], 1 - +p[2]]); // flip V for glTF
    else if (p[0] === "f") {
      const toks = p.slice(1).map((s) => {
        const [vi, ti] = s.split("/");
        return { v: parseInt(vi, 10) - 1, vt: ti ? parseInt(ti, 10) - 1 : 0 };
      });
      for (let i = 1; i < toks.length - 1; i++) F.push([toks[0], toks[i], toks[i + 1]]);
    }
  }

  const extractComp = (pred) => {
    const vMap = new Int32Array(V.length).fill(-1);
    const pos = [];
    const tris = []; // [{ v: [a,b,c], uv: [[u,v],[u,v],[u,v]] }]
    for (const tri of F) {
      if (!pred(V[tri[0].v])) continue;
      const vi = [];
      const uvs = [];
      for (const c of tri) {
        if (vMap[c.v] < 0) {
          vMap[c.v] = pos.length / 3;
          pos.push(V[c.v][0], V[c.v][1], V[c.v][2]);
        }
        vi.push(vMap[c.v]);
        uvs.push(VT[c.vt] ?? [0, 0]);
      }
      tris.push({ v: vi, uv: uvs });
    }
    return { positions: new Float32Array(pos), tris };
  };

  return {
    male: extractComp((p) => p[0] > 0),
    female: extractComp((p) => p[0] < 0),
  };
}

/** Center, scale to 1.80m, align Z to 0, splay arms +11 deg for sd_rig_v3 idle, and conform scalp to rig.HEAD. */
function alignToRig(comp) {
  const P = comp.positions;
  const nv = P.length / 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nv; i++) {
    minX = Math.min(minX, P[i * 3]);
    maxX = Math.max(maxX, P[i * 3]);
    minY = Math.min(minY, P[i * 3 + 1]);
    maxY = Math.max(maxY, P[i * 3 + 1]);
  }
  const cx = (minX + maxX) / 2;
  const scale = 1.8 / (maxY - minY);
  const zShift = 0.02;
  for (let i = 0; i < nv; i++) {
    P[i * 3] = (P[i * 3] - cx) * scale;
    P[i * 3 + 1] = (P[i * 3 + 1] - minY) * scale;
    P[i * 3 + 2] = P[i * 3 + 2] * scale + zShift;
  }

  // Gently splay arms outward (+11 deg) around REST.LeftArm / RightArm so idleClip's -11.5 deg brings them cleanly by the sides.
  const splayRad = 0.19;
  const tmp = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const qL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), splayRad);
  const qR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -splayRad);
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const ax = Math.abs(x);
    if (ax < 0.155 || y < 0.65 || y > 1.48) continue;
    const w = sstep(0.16, 0.215, ax) * sstep(0.65, 0.72, y) * sstep(1.48, 1.40, y);
    if (w <= 0) continue;
    const side = x >= 0 ? "L" : "R";
    pivot.set(...REST[sideBone("Arm", side)]);
    tmp.set(x, y, z).sub(pivot).applyQuaternion(side === "L" ? qL : qR).add(pivot);
    P[i * 3] = x + (tmp.x - x) * w;
    P[i * 3 + 1] = y + (tmp.y - y) * w;
    P[i * 3 + 2] = z + (tmp.z - z) * w;
  }

  // Conform upper/back scalp softly onto rig.HEAD so all 8 hairstyles and 6 hats fit cleanly.
  const [hx, hy, hz] = HEAD.center;
  const [rx, ry, rz] = HEAD.radii;
  for (let i = 0; i < nv; i++) {
    let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const scalpMask = sstep(1.66, 1.70, y) + (1 - sstep(1.66, 1.70, y)) * sstep(0.02, -0.03, z) * sstep(1.57, 1.63, y);
    if (scalpMask <= 0) continue;
    const dx = x - hx, dy = y - hy, dz = z - hz;
    const ell = Math.hypot(dx / (rx - 0.002), dy / (ry - 0.002), dz / (rz - 0.002));
    if (ell > 0.55) {
      const f = 1 + (1.0 / ell - 1) * scalpMask;
      P[i * 3] = hx + dx * f;
      P[i * 3 + 1] = hy + dy * f;
      P[i * 3 + 2] = hz + dz * f;
    }
  }
}

/* ── UV-preserving Loop subdivision ──────────────────────────────────────── */

function loopSubdivideWithUVs(positions, tris) {
  const nv = positions.length / 3;
  const edgeMap = new Map();
  const neighbors = Array.from({ length: nv }, () => new Set());
  const eKey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);

  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const u = t.v[k], v = t.v[(k + 1) % 3], w = t.v[(k + 2) % 3];
      neighbors[u].add(v);
      neighbors[v].add(u);
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
      sx += positions[u * 3];
      sy += positions[u * 3 + 1];
      sz += positions[u * 3 + 2];
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

function computeWeldedNormals(positions, tris) {
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  for (const t of tris) {
    const [a, b, c] = t.v;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= l;
    normals[v * 3 + 1] /= l;
    normals[v * 3 + 2] /= l;
  }
  return normals;
}

/** Expand a subset of welded-position + per-corner-UV tris into renderable arrays (splitting vertices only at UV seams). */
function buildRenderableSubmesh(positions, normals, tris, keepTri, extraPerWeldedVert = {}) {
  const keyMap = new Map();
  const srcV = [];
  const pos = [], nrm = [], uvs = [], idx = [];
  for (let ti = 0; ti < tris.length; ti++) {
    if (!keepTri(ti)) continue;
    const t = tris[ti];
    for (let k = 0; k < 3; k++) {
      const v = t.v[k];
      const [u, w] = t.uv[k];
      const key = `${v}_${Math.round(u * 10000)}_${Math.round(w * 10000)}`;
      let id = keyMap.get(key);
      if (id === undefined) {
        id = srcV.length;
        keyMap.set(key, id);
        srcV.push(v);
        pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        uvs.push(u, w);
      }
      idx.push(id);
    }
  }
  const out = {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(idx),
    srcV: Int32Array.from(srcV),
  };
  for (const [k, arr] of Object.entries(extraPerWeldedVert)) {
    if (Array.isArray(arr)) out[k] = srcV.map((v) => arr[v]);
    else {
      const stride = arr.length / (positions.length / 3);
      const dst = new arr.constructor(srcV.length * stride);
      srcV.forEach((v, i) => {
        for (let c = 0; c < stride; c++) dst[i * stride + c] = arr[v * stride + c];
      });
      out[k] = dst;
    }
  }
  return out;
}

/* ── Spatial hash for Female projection & Vertex AO ──────────────────────── */

class TriGrid {
  constructor(positions, tris, normals, cellSize = 0.018) {
    this.P = positions;
    this.tris = tris;
    this.N = normals;
    this.h = cellSize;
    this.cells = new Map();
    for (let t = 0; t < tris.length; t++) {
      const [ia, ib, ic] = tris[t].v;
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const x0 = Math.floor(Math.min(positions[a], positions[b], positions[c]) / cellSize);
      const x1 = Math.floor(Math.max(positions[a], positions[b], positions[c]) / cellSize);
      const y0 = Math.floor(Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) / cellSize);
      const y1 = Math.floor(Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) / cellSize);
      const z0 = Math.floor(Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) / cellSize);
      const z1 = Math.floor(Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) / cellSize);
      for (let gz = z0; gz <= z1; gz++)
        for (let gy = y0; gy <= y1; gy++)
          for (let gx = x0; gx <= x1; gx++) {
            const k = (gx + 512) + ((gy + 512) << 10) + ((gz + 512) << 20);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(t);
          }
    }
    this.seen = new Int32Array(tris.length);
    this.stamp = 1;
  }

  closest(px, py, pz, radius = 2) {
    const cx = Math.floor(px / this.h), cy = Math.floor(py / this.h), cz = Math.floor(pz / this.h);
    const P = this.P, tris = this.tris, N = this.N;
    const st = this.stamp++;
    let bestD2 = Infinity, bestT = -1, bu = 0, bv = 0, bw = 0;
    let bqx = px, bqy = py, bqz = pz;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const list = this.cells.get((cx + dx + 512) + ((cy + dy + 512) << 10) + ((cz + dz + 512) << 20));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const t = list[i];
            if (this.seen[t] === st) continue;
            this.seen[t] = st;
            const [ia0, ib0, ic0] = tris[t].v;
            const ia = ia0 * 3, ib = ib0 * 3, ic = ic0 * 3;
            const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
            const bx = P[ib], by = P[ib + 1], bz = P[ib + 2];
            const cxp = P[ic], cyp = P[ic + 1], czp = P[ic + 2];
            const abx = bx - ax, aby = by - ay, abz = bz - az;
            const acx = cxp - ax, acy = cyp - ay, acz = czp - az;
            const apx = px - ax, apy = py - ay, apz = pz - az;
            const d1 = abx * apx + aby * apy + abz * apz;
            const d2 = acx * apx + acy * apy + acz * apz;
            let u, v, w;
            if (d1 <= 0 && d2 <= 0) {
              u = 1; v = 0; w = 0;
            } else {
              const bpx = px - bx, bpy = py - by, bpz = pz - bz;
              const d3 = abx * bpx + aby * bpy + abz * bpz;
              const d4 = acx * bpx + acy * bpy + acz * bpz;
              if (d3 >= 0 && d4 <= d3) {
                u = 0; v = 1; w = 0;
              } else {
                const vc = d1 * d4 - d3 * d2;
                if (vc <= 0 && d1 >= 0 && d3 <= 0) {
                  v = d1 / (d1 - d3); u = 1 - v; w = 0;
                } else {
                  const cpx = px - cxp, cpy = py - cyp, cpz = pz - czp;
                  const d5 = abx * cpx + aby * cpy + abz * cpz;
                  const d6 = acx * cpx + acy * cpy + acz * cpz;
                  if (d6 >= 0 && d5 <= d6) {
                    u = 0; v = 0; w = 1;
                  } else {
                    const vb = d5 * d2 - d1 * d6;
                    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                      w = d2 / (d2 - d6); u = 1 - w; v = 0;
                    } else {
                      const va = d3 * d6 - d5 * d4;
                      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                        w = (d4 - d3) / (d4 - d3 + (d5 - d6)); u = 0; v = 1 - w;
                      } else {
                        const denom = 1 / (va + vb + vc);
                        v = vb * denom; w = vc * denom; u = 1 - v - w;
                      }
                    }
                  }
                }
              }
            }
            const qx = ax * u + bx * v + cxp * w;
            const qy = ay * u + by * v + cyp * w;
            const qz = az * u + bz * v + czp * w;
            const distSq = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
            if (distSq < bestD2) {
              bestD2 = distSq;
              bestT = t;
              bu = u; bv = v; bw = w;
              bqx = qx; bqy = qy; bqz = qz;
            }
          }
        }
    if (bestT < 0) return null;
    const [ia0, ib0, ic0] = tris[bestT].v;
    const ia = ia0 * 3, ib = ib0 * 3, ic = ic0 * 3;
    const nx = N[ia] * bu + N[ib] * bv + N[ic] * bw;
    const ny = N[ia + 1] * bu + N[ib + 1] * bv + N[ic + 1] * bw;
    const nz = N[ia + 2] * bu + N[ib + 2] * bv + N[ic + 2] * bw;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { distSq: bestD2, x: bqx, y: bqy, z: bqz, nx: nx / l, ny: ny / l, nz: nz / l };
  }
}

function bakeMeshAO(grid, positions, normals, { step = 0.009, samples = 5, strength = 0.65, min = 0.62 } = {}) {
  const n = positions.length / 3;
  const ao = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let occ = 0, w = 0.5;
    for (let i = 1; i <= samples; i++) {
      const h = i * step;
      const hit = grid.closest(x + nx * h, y + ny * h, z + nz * h, Math.min(3, Math.ceil((h * 1.5) / grid.h)));
      if (hit) {
        const d = Math.sqrt(hit.distSq);
        if (d < h) occ += (w * (h - d)) / h;
      }
      w *= 0.5;
    }
    ao[v] = clamp(1 - strength * occ, min, 1);
  }
  return ao;
}

/* ── Skin weights, build morphs & face shape warps ───────────────────────── */

function segProj(px, py, pz, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const len2 = vx * vx + vy * vy + vz * vz || 1;
  const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy + (pz - a[2]) * vz) / len2, 0, 1);
  const dx = px - (a[0] + vx * t), dy = py - (a[1] + vy * t), dz = pz - (a[2] + vz * t);
  return { t, d: Math.hypot(dx, dy, dz) };
}

function skinWeightAt(x, y, z) {
  const w = {};
  const add = (b, v) => { if (v > 1e-4) w[b] = (w[b] ?? 0) + v; };
  const side = x >= 0 ? "L" : "R";

  if (y > 1.545) { add("Head", 1); return w; }
  if (y > 1.44 && Math.abs(x) < 0.085) {
    const kHead = sstep(1.495, 1.545, y);
    const kNeck = sstep(1.43, 1.485, y) * (1 - kHead);
    add("Head", kHead); add("Neck", kNeck); add("Spine2", 1 - kHead - kNeck);
    return w;
  }

  const armMask = sstep(0.145, 0.20, Math.abs(x)) * sstep(0.55, 0.64, y) * sstep(1.52, 1.44, y);
  if (armMask > 0.001) {
    const arm = REST[sideBone("Arm", side)];
    const fore = REST[sideBone("ForeArm", side)];
    const hand = REST[sideBone("Hand", side)];
    const pU = segProj(x, y, z, arm, fore);
    const pF = segProj(x, y, z, fore, hand);
    if (pF.d < pU.d && pF.t > 0.05) {
      const kHand = sstep(0.82, 0.98, pF.t);
      const kElb = sstep(0.18, 0.0, pF.t) * 0.45;
      add(sideBone("Hand", side), armMask * kHand);
      add(sideBone("ForeArm", side), armMask * (1 - kHand - kElb));
      add(sideBone("Arm", side), armMask * kElb);
    } else {
      const kSh = sstep(0.22, 0.0, pU.t) * 0.55;
      const kElb = sstep(0.82, 1.0, pU.t) * 0.45;
      add(sideBone("Shoulder", side), armMask * kSh);
      add(sideBone("Arm", side), armMask * (1 - kSh - kElb));
      add(sideBone("ForeArm", side), armMask * kElb);
    }
    if (armMask >= 0.999) return w;
  }

  const torsoW = 1 - armMask;
  if (y < 0.91) {
    const kHip = sstep(0.80, 0.91, y);
    const legW = torsoW * (1 - kHip);
    add("Hips", torsoW * kHip);
    if (legW > 0.001) {
      const kToe = sstep(0.06, 0.02, y) * sstep(0.06, 0.11, z);
      const kFoot = sstep(0.13, 0.075, y) * (1 - kToe);
      const kKnee = sstep(0.56, 0.44, y) * (1 - kFoot - kToe);
      add(sideBone("ToeBase", side), legW * kToe);
      add(sideBone("Foot", side), legW * kFoot);
      add(sideBone("Leg", side), legW * kKnee);
      add(sideBone("UpLeg", side), legW * (1 - kToe - kFoot - kKnee));
    }
    return w;
  }

  const kS = sstep(0.95, 1.06, y);
  const kS1 = sstep(1.08, 1.18, y);
  const kS2 = sstep(1.20, 1.32, y);
  add("Hips", torsoW * (1 - kS));
  add("Spine", torsoW * (kS - kS1));
  add("Spine1", torsoW * (kS1 - kS2));
  add("Spine2", torsoW * kS2);
  return w;
}

function computeBuildMorph(positions, normals, sign) {
  const n = positions.length / 3;
  const dpos = new Float32Array(n * 3);
  const dnrm = new Float32Array(n * 3);
  const amt = sign > 0 ? 0.022 : -0.017;
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1];
    const headFade = sstep(1.56, 1.47, y);
    const footFade = sstep(0.07, 0.16, y);
    const handFade = 1 - sstep(0.28, 0.34, Math.abs(x)) * sstep(1.00, 0.90, y);
    const mask = headFade * footFade * handFade;
    if (mask <= 0) continue;
    const upperBoost = 1 + 0.35 * sstep(1.05, 1.38, y);
    const d = amt * mask * upperBoost;
    dpos[v * 3] = normals[v * 3] * d;
    dpos[v * 3 + 1] = normals[v * 3 + 1] * d * 0.25;
    dpos[v * 3 + 2] = normals[v * 3 + 2] * d * 0.85;
  }
  return { dpos, dnrm };
}

function warpFaceShape(positions, shape) {
  const out = new Float32Array(positions);
  if (shape === "oval") return out;
  for (let i = 0; i < out.length; i += 3) {
    let x = out[i], y = out[i + 1], z = out[i + 2];
    const ax = Math.abs(x);
    const faceW = sstep(1.52, 1.56, y) * sstep(1.68, 1.63, y) * sstep(-0.02, 0.04, z);
    const jawW = sstep(1.53, 1.56, y) * sstep(1.62, 1.57, y) * sstep(-0.02, 0.05, z);
    const chinW = gauss(ax, 0, 0.03) * gauss(y, 1.555, 0.022) * sstep(0.04, 0.08, z);
    if (shape === "round") {
      x *= 1 + 0.085 * faceW;
      y += 0.004 * chinW;
    } else if (shape === "square") {
      x *= 1 + 0.13 * jawW + 0.12 * chinW;
      y -= 0.006 * jawW * sstep(0.03, 0.055, ax);
      z += 0.004 * chinW;
    } else if (shape === "heart") {
      x *= 1 + 0.05 * gauss(y, 1.625, 0.024) * sstep(0.01, 0.05, z) - 0.13 * jawW - 0.15 * chinW;
      y -= 0.004 * chinW;
    }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

function warpNoseShape(positions, nose) {
  const out = new Float32Array(positions);
  if (nose === "button") return out;
  for (let i = 0; i < out.length; i += 3) {
    let x = out[i], y = out[i + 1], z = out[i + 2];
    const w = sstep(0.032, 0.010, Math.abs(x)) * sstep(1.585, 1.605, y) * sstep(1.665, 1.645, y) * sstep(0.085, 0.115, z);
    if (w <= 0) continue;
    if (nose === "straight") {
      z += 0.008 * w * sstep(1.655, 1.610, y);
      y -= 0.004 * w * sstep(1.635, 1.600, y);
    } else if (nose === "broad") {
      x *= 1 + 0.32 * w * sstep(1.645, 1.600, y);
      z += 0.003 * w;
    }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

function buildEyePart(eyeCenter, eyeRadius, fn) {
  const b = new MeshBuilder();
  fn(b, eyeCenter, eyeRadius);
  const g = b.toGeometry({ skinned: false });
  return {
    positions: g.attributes.position.array,
    normals: g.attributes.normal.array,
    indices: g.index.array,
    colors: g.attributes.color ? g.attributes.color.array : null,
  };
}

function cap(b, c, R, alpha, rows, cols, yaw = 0, shade = null) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i <= rows; i++) {
    const a = (alpha * Math.max(i, 0.02)) / rows;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const lx = R * Math.sin(a) * Math.cos(ph), ly = R * Math.sin(a) * Math.sin(ph), lz = R * Math.cos(a);
      const v = b.vertex([c[0] + lx * cy + lz * sy, c[1] + ly, c[2] - lx * sy + lz * cy]);
      if (shade) b.color(v, shade(lx, ly));
    }
  }
  b.grid(rows + 1, cols, true);
}

function makeAccessor(doc, buf, arr, type, normalized = false) {
  return doc.createAccessor().setBuffer(buf).setArray(arr).setType(type).setNormalized(normalized);
}

async function main() {
  mkdirSync(ART_DIR, { recursive: true });
  console.log("Loading Male & Female pair from art/source_pair/base.obj...");
  const { male: male0, female: female0 } = parseObjPair(SRC_OBJ);
  alignToRig(male0);
  alignToRig(female0);

  console.log("Subdividing Male & Female meshes with UV preservation...");
  const male = loopSubdivideWithUVs(male0.positions, male0.tris);
  const female = loopSubdivideWithUVs(female0.positions, female0.tris);

  const maleNormals = computeWeldedNormals(male.positions, male.tris);
  const femNormals = computeWeldedNormals(female.positions, female.tris);
  const maleGrid = new TriGrid(male.positions, male.tris, maleNormals, 0.018);
  const femGrid = new TriGrid(female.positions, female.tris, femNormals, 0.018);

  // Project every Male vertex onto Female surface for smooth, true Male -> Female frameFem morph!
  const mn = male.positions.length / 3;
  const maleFemDpos = new Float32Array(mn * 3);
  const maleFemDnrm = new Float32Array(mn * 3);
  for (let v = 0; v < mn; v++) {
    const x = male.positions[v * 3], y = male.positions[v * 3 + 1], z = male.positions[v * 3 + 2];
    const hit = femGrid.closest(x, y, z, 3);
    if (hit && hit.distSq < 0.05 * 0.05) {
      maleFemDpos[v * 3] = hit.x - x;
      maleFemDpos[v * 3 + 1] = hit.y - y;
      maleFemDpos[v * 3 + 2] = hit.z - z;
      maleFemDnrm[v * 3] = hit.nx - maleNormals[v * 3];
      maleFemDnrm[v * 3 + 1] = hit.ny - maleNormals[v * 3 + 1];
      maleFemDnrm[v * 3 + 2] = hit.nz - maleNormals[v * 3 + 2];
    }
  }
  // 2 passes of neighbor averaging on frameFem delta to keep transitions silky smooth.
  const nbrs = Array.from({ length: mn }, () => new Set());
  for (const t of male.tris) {
    nbrs[t.v[0]].add(t.v[1]); nbrs[t.v[0]].add(t.v[2]);
    nbrs[t.v[1]].add(t.v[0]); nbrs[t.v[1]].add(t.v[2]);
    nbrs[t.v[2]].add(t.v[0]); nbrs[t.v[2]].add(t.v[1]);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = maleFemDpos.slice();
    for (let v = 0; v < mn; v++) {
      const nb = [...nbrs[v]];
      if (!nb.length) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const u of nb) { sx += maleFemDpos[u * 3]; sy += maleFemDpos[u * 3 + 1]; sz += maleFemDpos[u * 3 + 2]; }
      next[v * 3] = 0.55 * maleFemDpos[v * 3] + 0.45 * (sx / nb.length);
      next[v * 3 + 1] = 0.55 * maleFemDpos[v * 3 + 1] + 0.45 * (sy / nb.length);
      next[v * 3 + 2] = 0.55 * maleFemDpos[v * 3 + 2] + 0.45 * (sz / nb.length);
    }
    maleFemDpos.set(next);
  }

  // Vertex AO & skin weights on welded Male mesh.
  console.log("Baking vertex AO & resizing 1024x1024 normal map from texture_normal.png...");
  const maleAO = bakeMeshAO(maleGrid, male.positions, maleNormals, { step: 0.009, strength: 0.62, min: 0.62 });
  const maleWeights = Array.from({ length: mn }, (_, v) => skinWeightAt(male.positions[v * 3], male.positions[v * 3 + 1], male.positions[v * 3 + 2]));
  const maleColors = new Uint8Array(mn * 4);
  for (let v = 0; v < mn; v++) {
    const x = male.positions[v * 3], y = male.positions[v * 3 + 1], z = male.positions[v * 3 + 2];
    const [r, g, b] = y > NECK_SPLIT_Y ? headTint(x, y, z) : bodyTint(x, y, z);
    const ao = maleAO[v];
    maleColors.set([Math.round(r * ao * 248), Math.round(g * ao * 248), Math.round(b * ao * 248), 255], v * 4);
  }
  const maleSlim = computeBuildMorph(male.positions, maleNormals, -1);
  const maleBroad = computeBuildMorph(male.positions, maleNormals, 1);

  const normJpeg = await sharp(SRC_NORM).resize(1024, 1024).jpeg({ quality: 90 }).toBuffer();

  // Build glTF document for art/base.glb.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("art_base");
  scene.setExtras({ sdAvatar: { rig: RIG_ID, version: 3, kind: "base" } });

  const boneNodes = {};
  for (const [name, parent, pos] of BONES) {
    const n = doc.createNode(name);
    const pp = parent ? REST[parent] : [0, 0, 0];
    n.setTranslation([pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]]);
    boneNodes[name] = n;
    if (parent) boneNodes[parent].addChild(n);
    else scene.addChild(n);
  }
  const sdSkin = doc.createSkin("sd_rig_v3");
  const ibmArr = new Float32Array(BONES.length * 16);
  for (let i = 0; i < BONES.length; i++) {
    const [name, , pos] = BONES[i];
    sdSkin.addJoint(boneNodes[name]);
    const m = new THREE.Matrix4().makeTranslation(-pos[0], -pos[1], -pos[2]);
    ibmArr.set(m.elements, i * 16);
  }
  sdSkin.setInverseBindMatrices(makeAccessor(doc, buf, ibmArr, "MAT4"));

  const normTex = doc.createTexture("pair_normal").setMimeType("image/jpeg").setImage(normJpeg);
  const mats = {};
  const getMat = (name, color = [0.9, 0.7, 0.55, 1]) => {
    if (!mats[name]) mats[name] = doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(0.58);
    return mats[name];
  };
  getMat("skin").setNormalTexture(normTex);

  const addArtMesh = (name, matName, data, parentNode = null) => {
    const mesh = doc.createMesh(name);
    const prim = doc.createPrimitive()
      .setMaterial(getMat(matName))
      .setAttribute("POSITION", makeAccessor(doc, buf, data.positions, "VEC3"))
      .setAttribute("NORMAL", makeAccessor(doc, buf, data.normals, "VEC3"))
      .setIndices(makeAccessor(doc, buf, data.indices, "SCALAR"));
    if (data.uvs) prim.setAttribute("TEXCOORD_0", makeAccessor(doc, buf, data.uvs, "VEC2"));
    if (data.colors) prim.setAttribute("COLOR_0", makeAccessor(doc, buf, data.colors, "VEC4", true));
    if (data.weights) {
      const nv = data.positions.length / 3;
      const si = new Uint8Array(nv * 4);
      const sw = new Uint8Array(nv * 4);
      for (let v = 0; v < nv; v++) {
        const entries = Object.entries(data.weights[v]).filter(([, w]) => w > 4e-3).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const tot = entries.reduce((s, [, w]) => s + w, 0) || 1;
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          si[v * 4 + k] = entries[k] ? BONE_INDEX[entries[k][0]] : 0;
          sw[v * 4 + k] = entries[k] ? Math.round((255 * entries[k][1]) / tot) : 0;
          sum += sw[v * 4 + k];
        }
        sw[v * 4] += 255 - sum;
      }
      prim.setAttribute("JOINTS_0", makeAccessor(doc, buf, si, "VEC4", false));
      prim.setAttribute("WEIGHTS_0", makeAccessor(doc, buf, sw, "VEC4", true));
    }
    const morphNames = Object.keys(data.morphs ?? {});
    if (morphNames.length) {
      mesh.setExtras({ targetNames: morphNames });
      for (const mName of morphNames) {
        const t = doc.createPrimitiveTarget();
        t.setAttribute("POSITION", makeAccessor(doc, buf, data.morphs[mName].dpos, "VEC3"));
        if (data.morphs[mName].dnrm) t.setAttribute("NORMAL", makeAccessor(doc, buf, data.morphs[mName].dnrm, "VEC3"));
        prim.addTarget(t);
      }
    }
    mesh.addPrimitive(prim);
    const node = doc.createNode(name).setMesh(mesh);
    if (data.weights) node.setSkin(sdSkin);
    if (parentNode) parentNode.addChild(node);
    else scene.addChild(node);
    return node;
  };

  // Split at NECK_SPLIT_Y into Body and Head_* (preserving original UVs & unified smooth normals).
  const isHeadTri = (ti) => {
    const [a, b, c] = male.tris[ti].v;
    const cy = (male.positions[a * 3 + 1] + male.positions[b * 3 + 1] + male.positions[c * 3 + 1]) / 3;
    const cx = (male.positions[a * 3] + male.positions[b * 3] + male.positions[c * 3]) / 3;
    return cy > NECK_SPLIT_Y && Math.abs(cx) < 0.14;
  };
  const extras = {
    colors: maleColors,
    weights: maleWeights,
    femDpos: maleFemDpos,
    femDnrm: maleFemDnrm,
    slimDpos: maleSlim.dpos,
    slimDnrm: maleSlim.dnrm,
    broadDpos: maleBroad.dpos,
    broadDnrm: maleBroad.dnrm,
  };

  // 1. Body
  const bodySub = buildRenderableSubmesh(male.positions, maleNormals, male.tris, (ti) => !isHeadTri(ti), extras);
  addArtMesh("Body", "skin", {
    positions: bodySub.positions,
    normals: bodySub.normals,
    uvs: bodySub.uvs,
    indices: bodySub.indices,
    colors: bodySub.colors,
    weights: bodySub.weights,
    morphs: {
      buildSlim: { dpos: bodySub.slimDpos, dnrm: bodySub.slimDnrm },
      buildBroad: { dpos: bodySub.broadDpos, dnrm: bodySub.broadDnrm },
      frameFem: { dpos: bodySub.femDpos, dnrm: bodySub.femDnrm },
    },
  });

  // 2. Fitted Underwear (from Male hips/upper thighs, offset +4.8mm outward, with frameFem morph & flat hems).
  const uwSub = buildRenderableSubmesh(
    male.positions,
    maleNormals,
    male.tris,
    (ti) => {
      const [a, b, c] = male.tris[ti].v;
      const cy = (male.positions[a * 3 + 1] + male.positions[b * 3 + 1] + male.positions[c * 3 + 1]) / 3;
      const cx = (male.positions[a * 3] + male.positions[b * 3] + male.positions[c * 3]) / 3;
      return cy >= 0.74 && cy <= 0.99 && Math.abs(cx) < 0.20;
    },
    extras
  );
  const un = uwSub.positions.length / 3;
  const uwColors = new Uint8Array(un * 4);
  for (let v = 0; v < un; v++) {
    const y = uwSub.positions[v * 3 + 1];
    const off = 0.0048 + 0.001 * sstep(0.95, 0.965, y);
    uwSub.positions[v * 3] += uwSub.normals[v * 3] * off;
    uwSub.positions[v * 3 + 1] += uwSub.normals[v * 3 + 1] * off;
    uwSub.positions[v * 3 + 2] += uwSub.normals[v * 3 + 2] * off;
    const k = Math.round(255 * (1 - 0.22 * sstep(0.945, 0.96, y)));
    uwColors.set([k, k, k, 255], v * 4);
  }
  addArtMesh("Underwear", "base_layer", {
    positions: uwSub.positions,
    normals: uwSub.normals,
    indices: uwSub.indices,
    colors: uwColors,
    weights: uwSub.weights,
    morphs: {
      buildSlim: { dpos: uwSub.slimDpos, dnrm: uwSub.slimDnrm },
      buildBroad: { dpos: uwSub.broadDpos, dnrm: uwSub.broadDnrm },
      frameFem: { dpos: uwSub.femDpos, dnrm: uwSub.femDnrm },
    },
  });

  // 3. Fitted Bra (from Female chest directly, offset +5.2mm outward).
  const fn = female.positions.length / 3;
  const femWeights = Array.from({ length: fn }, (_, v) => skinWeightAt(female.positions[v * 3], female.positions[v * 3 + 1], female.positions[v * 3 + 2]));
  const femSlim = computeBuildMorph(female.positions, femNormals, -1);
  const femBroad = computeBuildMorph(female.positions, femNormals, 1);
  const braSub = buildRenderableSubmesh(
    female.positions,
    femNormals,
    female.tris,
    (ti) => {
      const [a, b, c] = female.tris[ti].v;
      const cy = (female.positions[a * 3 + 1] + female.positions[b * 3 + 1] + female.positions[c * 3 + 1]) / 3;
      const cx = (female.positions[a * 3] + female.positions[b * 3] + female.positions[c * 3]) / 3;
      return cy >= 1.21 && cy <= 1.38 && Math.abs(cx) < 0.165;
    },
    { weights: femWeights, slimDpos: femSlim.dpos, slimDnrm: femSlim.dnrm, broadDpos: femBroad.dpos, broadDnrm: femBroad.dnrm }
  );
  const brn = braSub.positions.length / 3;
  const braColors = new Uint8Array(brn * 4);
  for (let v = 0; v < brn; v++) {
    const y = braSub.positions[v * 3 + 1];
    const off = 0.0052 + 0.001 * sstep(1.245, 1.23, y);
    braSub.positions[v * 3] += braSub.normals[v * 3] * off;
    braSub.positions[v * 3 + 1] += braSub.normals[v * 3 + 1] * off;
    braSub.positions[v * 3 + 2] += braSub.normals[v * 3 + 2] * off;
    const k = Math.round(255 * (1 - 0.22 * sstep(1.25, 1.235, y)));
    braColors.set([k, k, k, 255], v * 4);
  }
  addArtMesh("Bra", "base_layer", {
    positions: braSub.positions,
    normals: braSub.normals,
    indices: braSub.indices,
    colors: braColors,
    weights: braSub.weights,
    morphs: {
      buildSlim: { dpos: braSub.slimDpos, dnrm: braSub.slimDnrm },
      buildBroad: { dpos: braSub.broadDpos, dnrm: braSub.broadDnrm },
      frameFem: { dpos: new Float32Array(brn * 3), dnrm: new Float32Array(brn * 3) },
    },
  });

  // 4. All 12 Head_<face>[_<nose>] meshes (preserving UVs & normal map).
  const headSub = buildRenderableSubmesh(male.positions, maleNormals, male.tris, (ti) => isHeadTri(ti), extras);
  for (const face of FACE_SHAPES) {
    const mFace = warpFaceShape(headSub.positions, face);
    for (const nose of NOSE_SHAPES) {
      const mPos = warpNoseShape(mFace, nose);
      const name = nose === "button" ? `Head_${face}` : `Head_${face}_${nose}`;
      addArtMesh(name, "skin", {
        positions: mPos,
        normals: headSub.normals,
        uvs: headSub.uvs,
        indices: headSub.indices,
        colors: headSub.colors,
        weights: headSub.weights,
        morphs: {
          buildSlim: { dpos: headSub.slimDpos, dnrm: headSub.slimDnrm },
          buildBroad: { dpos: headSub.broadDpos, dnrm: headSub.broadDnrm },
          frameFem: { dpos: headSub.femDpos, dnrm: headSub.femDnrm },
        },
      });
    }
  }

  // 5. Eyes, Iris, Pupils, Lids_*, Lashes_*, Brows_* aligned to the measured eye sockets.
  const eyeCenter = [0.034, 1.642, 0.100];
  const eyeRadius = 0.0145;
  const zeroEyeMorph = (pos) => ({ frameFem: { dpos: new Float32Array(pos.length), dnrm: new Float32Array(pos.length) } });
  const irisR = eyeRadius * 0.72;
  const pupilR = eyeRadius * 0.34;

  const eyesData = buildEyePart(eyeCenter, eyeRadius, (b, c, R) => {
    for (const s of [1, -1]) cap(b, [c[0] * s, c[1], c[2]], R, 1.95, 6, 24);
  });
  eyesData.morphs = zeroEyeMorph(eyesData.positions);
  addArtMesh("Eyes", "eye_white", eyesData, boneNodes.Head);

  const irisData = buildEyePart(eyeCenter, eyeRadius, (b, c, R) => {
    const alpha = Math.asin(irisR / (R + 0.0003));
    for (const s of [1, -1]) {
      cap(b, [c[0] * s, c[1], c[2]], R + 0.0003, alpha, 4, 24, -s * GAZE_IN, (x, y) => {
        const k = irisShade(Math.hypot(x, y) / irisR, Math.atan2(y, x * s));
        return [k, k, k];
      });
    }
  });
  irisData.morphs = zeroEyeMorph(irisData.positions);
  addArtMesh("Iris", "iris", irisData, boneNodes.Head);

  const pupilData = buildEyePart(eyeCenter, eyeRadius, (b, c, R) => {
    const alpha = Math.asin(pupilR / (R + 0.00055));
    for (const s of [1, -1]) cap(b, [c[0] * s, c[1], c[2]], R + 0.00055, alpha, 2, 16, -s * GAZE_IN);
  });
  pupilData.morphs = zeroEyeMorph(pupilData.positions);
  addArtMesh("Pupils", "pupil", pupilData, boneNodes.Head);

  for (const shape of EYE_SHAPES) {
    const e = EYE_SHAPE[shape];
    const scaleW = eyeRadius / 0.0175;
    const upper = (u) => e.top * scaleW * Math.pow(Math.max(0, 1 - (u / (e.w * scaleW)) ** 2), e.p) + e.tilt * u;
    const lashData = buildEyePart(eyeCenter, eyeRadius, (b, c, R) => {
      for (const s of [1, -1]) {
        const pts = [];
        const w = e.w * scaleW;
        for (let i = 0; i <= 14; i++) {
          const u = -w * 0.92 + (2 * w * 0.97 * i) / 14;
          const v = upper(u) + 0.0003;
          const rr = R + 0.0012;
          const z = c[2] + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
          const out = Math.max(0, u / w - 0.45) / 0.55;
          const flick = out * out * 0.0034 * e.lash;
          const r = (0.00075 + 0.00085 * out + 0.00025 * Math.sin((i / 14) * Math.PI)) * e.lash;
          pts.push({ c: [c[0] * s + s * (u + flick * 0.7), c[1] + v + flick * 0.6, z - flick * 0.2], rx: r, rz: r * 0.7, w: {} });
        }
        tube(b, pts, { steps: 1, radial: 4, capStart: true, capEnd: true });
      }
    });
    lashData.morphs = zeroEyeMorph(lashData.positions);
    addArtMesh(`Lashes_${shape}`, "lash", lashData, boneNodes.Head);

    const lidData = buildEyePart(eyeCenter, eyeRadius, (b, c, R) => {
      const rr = R + 0.0009;
      const w = e.w * scaleW;
      for (const s of [1, -1]) {
        const rows = 4, cols = 14;
        for (let r = 0; r <= rows; r++) {
          const t = r / rows;
          for (let j = 0; j <= cols; j++) {
            const u = -w * 0.98 + (2 * w * 0.98 * j) / cols;
            const yBot = upper(u);
            const yTop = yBot + 0.0042 * Math.sqrt(Math.max(0, 1 - (u / (w * 1.05)) ** 2));
            const v = yBot + (yTop - yBot) * t;
            const z = c[2] + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
            b.vertex([c[0] * s + s * u, c[1] + v, z]);
          }
        }
        b.grid(rows + 1, cols + 1, false);
      }
    });
    lidData.morphs = zeroEyeMorph(lidData.positions);
    addArtMesh(`Lids_${shape}`, "skin", lidData, boneNodes.Head);
  }

  const browStyles = {
    soft: { arch: 0.004, thick: 0.0024 },
    arched: { arch: 0.008, thick: 0.0022 },
    bold: { arch: 0.0045, thick: 0.0034 },
  };
  for (const style of EYEBROWS) {
    if (style === "none") continue;
    const bs = browStyles[style];
    const browData = buildEyePart(eyeCenter, eyeRadius, (b, c) => {
      for (const s of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const bx = s * (0.016 + t * 0.036);
          const by = c[1] + 0.022 + bs.arch * Math.sin(t * Math.PI) - 0.003 * t;
          const hit = maleGrid.closest(bx, by, c[2] + 0.02, 2);
          const bz = hit ? hit.z + 0.0022 : c[2] + 0.018;
          const r = bs.thick * (0.65 + 0.35 * Math.sin(t * Math.PI));
          pts.push({ c: [bx, by, bz], rx: r, rz: r * 0.65, w: {} });
        }
        tube(b, pts, { steps: 1, radial: 5, capStart: true, capEnd: true });
      }
    });
    addArtMesh(`Brows_${style}`, "brow", browData, boneNodes.Head);
  }

  await io.write(OUT_GLB, doc);
  console.log(
    `Wrote ${OUT_GLB} (Body: ${bodySub.indices.length / 3} tris, Underwear: ${uwSub.indices.length / 3} tris, Bra: ${braSub.indices.length / 3} tris, Head: ${headSub.indices.length / 3} tris, normal map: ${(normJpeg.length / 1024).toFixed(0)} KB)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

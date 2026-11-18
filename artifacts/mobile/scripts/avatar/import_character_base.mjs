#!/usr/bin/env node
/**
 * Builds `scripts/avatar/art/base.glb` from scratch using
 * `Character Base by madtrollstudio - qbDLeTtb8K.glb` aligned to `sd_rig_v3`.
 *
 * Phase 1 (Male Character):
 *   - Loads, welds, centers, scales to 1.80 m, and aligns arms/legs/head cleanly to `sd_rig_v3`
 *   - Applies 1 pass of Loop subdivision (1,508 -> 6,032 tris) for smooth stylized Fortnite-like curves
 *   - Computes unified smooth normals before splitting at the neck seam (zero seam crease)
 *   - Bakes high-res vertex AO + 1024x1024 tangent-space normal maps (from 2x subdivided surface)
 *   - Computes clean bone-segment skin weights directly for `sd_rig_v3`
 *   - Authors clean `buildSlim` / `buildBroad` morphs on `Body` & fitted `Underwear`
 *   - Builds 12 `Head_<face>[_<nose>]` variants + fitted `Eyes`, `Iris`, `Pupils`, `Lids_*`, `Lashes_*`, `Brows_*`
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { BONE_NAMES, BONES, EYE_SHAPES, EYEBROWS, FACE_SHAPES, HEAD, NOSE_SHAPES, REST, RIG_ID, sideBone } from "./rig.mjs";
import { bodyTint, headTint } from "./character.mjs";
import { EYE_SHAPE, GAZE_IN, irisShade } from "./face.mjs";
import { MeshBuilder, tube } from "./geometry.mjs";
import { clamp, gauss, sstep } from "./sdf.mjs";
import { atlas, dilate, pushPull, withUVs } from "./bake.mjs";
import { encodeJPEG } from "./jpeg.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");
const CHAR_GLB = join(ROOT, "Character Base by madtrollstudio - qbDLeTtb8K.glb");
const ART_DIR = join(here, "art");
const OUT_GLB = join(ART_DIR, "base.glb");

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const NECK_SPLIT_Y = 1.505; // Narrowest part of the neck on the aligned Character Base

/* ── Geometry utilities ──────────────────────────────────────────────────── */

function computeNormals(positions, indices) {
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
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

/**
 * 1 pass of Loop subdivision on a welded triangle mesh.
 * Handles boundary / non-manifold edges cleanly by using midpoint positions on those edges.
 */
function loopSubdivide(positions, indices) {
  const nv = positions.length / 3;
  const nt = indices.length / 3;
  const edgeMap = new Map(); // "u,v" -> { u, v, opp: [w1, w2...], midIdx }
  const neighbors = Array.from({ length: nv }, () => new Set());
  const edgeKey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);

  for (let t = 0; t < nt; t++) {
    const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3], w = tri[(k + 2) % 3];
      neighbors[u].add(v);
      neighbors[v].add(u);
      const key = edgeKey(u, v);
      let e = edgeMap.get(key);
      if (!e) {
        e = { u: Math.min(u, v), v: Math.max(u, v), opp: [], midIdx: -1 };
        edgeMap.set(key, e);
      }
      e.opp.push(w);
    }
  }

  const outPos = [];
  // 1. Even (original) vertices smoothed by Loop weights.
  for (let v = 0; v < nv; v++) {
    const nbrs = [...neighbors[v]];
    const k = nbrs.length;
    // Check if v touches any boundary/non-manifold edge.
    const special = [];
    for (const u of nbrs) {
      const e = edgeMap.get(edgeKey(v, u));
      if (e.opp.length !== 2) special.push(u);
    }
    if (special.length === 2) {
      // Smooth boundary crease
      const a = special[0], b = special[1];
      outPos.push(
        0.75 * positions[v * 3] + 0.125 * (positions[a * 3] + positions[b * 3]),
        0.75 * positions[v * 3 + 1] + 0.125 * (positions[a * 3 + 1] + positions[b * 3 + 1]),
        0.75 * positions[v * 3 + 2] + 0.125 * (positions[a * 3 + 2] + positions[b * 3 + 2])
      );
    } else if (special.length > 0 || k < 3) {
      // Keep non-manifold vertex fixed to prevent tearing
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    } else {
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      let sx = 0, sy = 0, sz = 0;
      for (const u of nbrs) {
        sx += positions[u * 3];
        sy += positions[u * 3 + 1];
        sz += positions[u * 3 + 2];
      }
      const w0 = 1 - k * beta;
      outPos.push(
        w0 * positions[v * 3] + beta * sx,
        w0 * positions[v * 3 + 1] + beta * sy,
        w0 * positions[v * 3 + 2] + beta * sz
      );
    }
  }

  // 2. Odd (edge) vertices.
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
      outPos.push(
        0.5 * (positions[u] + positions[v]),
        0.5 * (positions[u + 1] + positions[v + 1]),
        0.5 * (positions[u + 2] + positions[v + 2])
      );
    }
  }

  // 3. Subdivide each triangle into 4.
  const outIdx = new Uint32Array(nt * 12);
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const ab = edgeMap.get(edgeKey(a, b)).midIdx;
    const bc = edgeMap.get(edgeKey(b, c)).midIdx;
    const ca = edgeMap.get(edgeKey(c, a)).midIdx;
    const o = t * 12;
    outIdx[o] = a; outIdx[o + 1] = ab; outIdx[o + 2] = ca;
    outIdx[o + 3] = ab; outIdx[o + 4] = b; outIdx[o + 5] = bc;
    outIdx[o + 6] = ca; outIdx[o + 7] = bc; outIdx[o + 8] = c;
    outIdx[o + 9] = ab; outIdx[o + 10] = bc; outIdx[o + 11] = ca;
  }
  return { positions: new Float32Array(outPos), indices: outIdx };
}

function compactSubmesh(positions, normals, indices, keepTri) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  const pos = [], nrm = [], idx = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (!keepTri(t / 3)) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[t + k];
      if (map[v] < 0) {
        map[v] = pos.length / 3;
        pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
      }
      idx.push(map[v]);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/**
 * Repairs inconsistent / inverted triangle winding across the entire welded mesh:
 *   1. BFS-propagates consistent orientation across every manifold shared edge
 *   2. Checks signed volume of each connected component and flips any inside-out component
 */
function fixWindingOutward(positions, indices) {
  const nt = indices.length / 3;
  const idx = new Uint32Array(indices);
  const edgeTris = new Map();
  const eKey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = eKey(u, v);
      let list = edgeTris.get(k);
      if (!list) edgeTris.set(k, (list = []));
      list.push(t);
    }
  }
  const hasDirEdge = (t, u, v) => {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    return (a === u && b === v) || (b === u && c === v) || (c === u && a === v);
  };
  const visited = new Uint8Array(nt);
  let flippedTotal = 0;
  for (let start = 0; start < nt; start++) {
    if (visited[start]) continue;
    const comp = [];
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const t = queue.shift();
      comp.push(t);
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const list = edgeTris.get(eKey(u, v));
        if (!list || list.length !== 2) continue;
        const nb = list[0] === t ? list[1] : list[0];
        if (visited[nb]) continue;
        if (hasDirEdge(nb, u, v)) {
          const tmp = idx[nb * 3 + 1];
          idx[nb * 3 + 1] = idx[nb * 3 + 2];
          idx[nb * 3 + 2] = tmp;
          flippedTotal++;
        }
        visited[nb] = 1;
        queue.push(nb);
      }
    }
    let vol6 = 0;
    for (const t of comp) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
      const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
      const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
      vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    if (vol6 < 0) {
      for (const t of comp) {
        const tmp = idx[t * 3 + 1];
        idx[t * 3 + 1] = idx[t * 3 + 2];
        idx[t * 3 + 2] = tmp;
      }
      flippedTotal += comp.length;
    }
  }
  const dirSet = new Set();
  let rem = 0;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = `${u},${v}`;
      if (dirSet.has(k)) rem++;
      dirSet.add(k);
    }
  }
  console.log(`  winding repair: flipped ${flippedTotal} tri ops, remaining inconsistent directed edges: ${rem}`);
  return idx;
}

/* ── Load & align Character Base GLB to sd_rig_v3 ────────────────────────── */

async function loadCharacterBase() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(CHAR_GLB);
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  const prim = node.getMesh().listPrimitives()[0];
  const wm = node.getWorldMatrix();
  const posAcc = prim.getAttribute("POSITION");
  const idxAcc = prim.getIndices();

  // Extract world-space positions and compute bounds.
  const rawP = new Float32Array(posAcc.getCount() * 3);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const el = [0, 0, 0];
  for (let i = 0; i < posAcc.getCount(); i++) {
    posAcc.getElement(i, el);
    const wx = wm[0] * el[0] + wm[4] * el[1] + wm[8] * el[2] + wm[12];
    const wy = wm[1] * el[0] + wm[5] * el[1] + wm[9] * el[2] + wm[13];
    const wz = wm[2] * el[0] + wm[6] * el[1] + wm[10] * el[2] + wm[14];
    rawP[i * 3] = wx;
    rawP[i * 3 + 1] = wy;
    rawP[i * 3 + 2] = wz;
    min = [Math.min(min[0], wx), Math.min(min[1], wy), Math.min(min[2], wz)];
    max = [Math.max(max[0], wx), Math.max(max[1], wy), Math.max(max[2], wz)];
  }

  // Weld by position and normalize: x centered at 0, feet at y=0, height=1.80 m, torso centered at z=0.
  const cx = (min[0] + max[0]) / 2;
  const scale = 1.8 / (max[1] - min[1]);
  const zOffset = 0.065;
  const vMap = new Int32Array(posAcc.getCount());
  const keyMap = new Map();
  const welded = [];
  for (let i = 0; i < posAcc.getCount(); i++) {
    const x = (rawP[i * 3] - cx) * scale;
    const y = (rawP[i * 3 + 1] - min[1]) * scale;
    const z = rawP[i * 3 + 2] * scale - zOffset;
    const key = `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
    let id = keyMap.get(key);
    if (id === undefined) {
      id = welded.length / 3;
      keyMap.set(key, id);
      welded.push(x, y, z);
    }
    vMap[i] = id;
  }
  const indices = [];
  for (let t = 0; t < idxAcc.getCount(); t += 3) {
    const a = vMap[idxAcc.getScalar(t)], b = vMap[idxAcc.getScalar(t + 1)], c = vMap[idxAcc.getScalar(t + 2)];
    if (a !== b && b !== c && c !== a) indices.push(a, b, c);
  }
  const pos = new Float32Array(welded);

  // Align arms smoothly onto sd_rig_v3's arm/forearm bone axes (pure rigid segment rotations, zero crushing).
  for (const side of ["L", "R"]) {
    const s = side === "L" ? 1 : -1;
    const rawShoulder = new THREE.Vector3(s * 0.21, 1.42, -0.032);
    const rawElbow = new THREE.Vector3(s * 0.34, 1.185, -0.033);
    const rawHand = new THREE.Vector3(s * 0.47, 0.92, 0.118);

    const tgtShoulder = new THREE.Vector3(...REST[sideBone("Arm", side)]);
    const tgtElbow = new THREE.Vector3(...REST[sideBone("ForeArm", side)]);
    const tgtHand = new THREE.Vector3(...REST[sideBone("Hand", side)]);

    const qUpper = new THREE.Quaternion().setFromUnitVectors(
      rawElbow.clone().sub(rawShoulder).normalize(),
      tgtElbow.clone().sub(tgtShoulder).normalize()
    );
    const curForeDir = rawHand.clone().sub(rawElbow).applyQuaternion(qUpper).normalize();
    const tgtForeDir = tgtHand.clone().sub(tgtElbow).normalize();
    const qFore = new THREE.Quaternion().setFromUnitVectors(curForeDir, tgtForeDir);

    const p = new THREE.Vector3();
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (x * s < 0.145 || y < 0.55 || y > 1.50) continue;
      const wArm = sstep(0.15, 0.215, x * s) * sstep(0.55, 0.65, y);
      if (wArm <= 0) continue;
      p.set(x, y, z);
      // Upper arm rigid transform
      const pUpper = p.clone().sub(rawShoulder).applyQuaternion(qUpper).add(tgtShoulder);
      // Forearm/hand rigid transform (smoothly blended across elbow)
      const elbowDist = p.clone().sub(rawShoulder).dot(rawElbow.clone().sub(rawShoulder).normalize());
      const upperLen = rawElbow.distanceTo(rawShoulder);
      const wFore = sstep(upperLen - 0.05, upperLen + 0.05, elbowDist);
      const pFull = pUpper.clone().sub(tgtElbow).applyQuaternion(qFore).add(tgtElbow);
      pUpper.lerp(pFull, wFore);
      p.lerp(pUpper, wArm);
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z;
    }
  }

  // Align legs gently to sd_rig_v3's leg stance (bring ankles slightly inward & forward to match REST.Foot).
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (y > 0.88) continue;
    const tLeg = sstep(0.86, 0.12, y);
    pos[v * 3] = x - Math.sign(x) * 0.024 * tLeg;
    pos[v * 3 + 2] = z + 0.032 * tLeg;
  }

  // Align head smoothly above neck so top of head & cranium align with rig.HEAD (hairs & hats fit cleanly).
  const [hx, hy, hz] = HEAD.center;
  const [rx, ry, rz] = HEAD.radii;
  for (let v = 0; v < pos.length / 3; v++) {
    const y0 = pos[v * 3 + 1];
    const k = sstep(1.47, 1.54, y0);
    if (k <= 0) continue;
    let x = pos[v * 3] * (1 + 0.06 * k);
    let y = y0 - 0.024 * k;
    let z = pos[v * 3 + 2] - 0.024 * k;
    // Gently conform upper/back scalp onto rig.HEAD so hair & hats sit cleanly with zero poke.
    const scalpMask = sstep(1.66, 1.70, y) + (1 - sstep(1.66, 1.70, y)) * sstep(0.03, -0.02, z) * sstep(1.57, 1.63, y);
    if (scalpMask > 0) {
      const dx = x - hx, dy = y - hy, dz = z - hz;
      const ell = Math.hypot(dx / (rx - 0.002), dy / (ry - 0.002), dz / (rz - 0.002));
      if (ell > 0.55) {
        const f = 1 + (1.0 / ell - 1) * scalpMask;
        x = hx + dx * f;
        y = hy + dy * f;
        z = hz + dz * f;
      }
    }
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
  }

  return { positions: pos, indices: fixWindingOutward(pos, Uint32Array.from(indices)) };
}

/* ── Spatial hash for high-res AO & Normal Map baking ────────────────────── */

class HighResGrid {
  constructor(positions, indices, normals, cellSize = 0.015) {
    this.P = positions;
    this.I = indices;
    this.N = normals;
    this.h = cellSize;
    this.cells = new Map();
    const nt = indices.length / 3;
    for (let t = 0; t < nt; t++) {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
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
    this.seen = new Int32Array(nt);
    this.stamp = 1;
  }

  closest(px, py, pz, radius = 1) {
    const cx = Math.floor(px / this.h), cy = Math.floor(py / this.h), cz = Math.floor(pz / this.h);
    const P = this.P, I = this.I, N = this.N;
    const st = this.stamp++;
    let bestD2 = Infinity;
    let bestT = -1, bu = 0, bv = 0, bw = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const list = this.cells.get((cx + dx + 512) + ((cy + dy + 512) << 10) + ((cz + dz + 512) << 20));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const t = list[i];
            if (this.seen[t] === st) continue;
            this.seen[t] = st;
            const ia = I[t * 3] * 3, ib = I[t * 3 + 1] * 3, ic = I[t * 3 + 2] * 3;
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
            const qx = ax * u + bx * v + cxp * w - px;
            const qy = ay * u + by * v + cyp * w - py;
            const qz = az * u + bz * v + czp * w - pz;
            const distSq = qx * qx + qy * qy + qz * qz;
            if (distSq < bestD2) {
              bestD2 = distSq;
              bestT = t;
              bu = u; bv = v; bw = w;
            }
          }
        }
    if (bestT < 0) return null;
    const ia = I[bestT * 3] * 3, ib = I[bestT * 3 + 1] * 3, ic = I[bestT * 3 + 2] * 3;
    const nx = N[ia] * bu + N[ib] * bv + N[ic] * bw;
    const ny = N[ia + 1] * bu + N[ib + 1] * bv + N[ic + 1] * bw;
    const nz = N[ia + 2] * bu + N[ib + 2] * bv + N[ic + 2] * bw;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { distSq: bestD2, nx: nx / l, ny: ny / l, nz: nz / l };
  }
}

function bakeMeshAO(grid, positions, normals, { step = 0.008, samples = 5, strength = 0.75, min = 0.58 } = {}) {
  const n = positions.length / 3;
  const ao = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let occ = 0;
    let w = 0.5;
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

function bakeHighResNormalMap(grid, md, size = 1024, { maxDist = 0.025, quality = 90 } = {}) {
  const img = new Uint8Array(size * size * 4);
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) img.set([128, 128, 255, 255], i * 4);
  const P = md.positions, N = md.normals, U = md.uvs, I = md.indices;
  const maxDist2 = maxDist * maxDist;
  for (let t = 0; t < I.length / 3; t++) {
    const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    const p = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const n = v.map((i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
    const uv = v.map((i) => [U[i * 2] * size, U[i * 2 + 1] * size]);
    const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1], du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    const e1 = [0, 1, 2].map((k) => p[1][k] - p[0][k]);
    const e2 = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
    const dpdu = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) / det);
    const dpdv = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) / det);
    const x0 = Math.max(0, Math.floor(Math.min(uv[0][0], uv[1][0], uv[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(uv[0][0], uv[1][0], uv[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(uv[0][1], uv[1][1], uv[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(uv[0][1], uv[1][1], uv[2][1])));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w1 = ((cx - uv[0][0]) * dv2 - du2 * (cy - uv[0][1])) / det;
        const w2 = (du1 * (cy - uv[0][1]) - (cx - uv[0][0]) * dv1) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const lpx = w0 * p[0][0] + w1 * p[1][0] + w2 * p[2][0];
        const lpy = w0 * p[0][1] + w1 * p[1][1] + w2 * p[2][1];
        const lpz = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
        let lnx = w0 * n[0][0] + w1 * n[1][0] + w2 * n[2][0];
        let lny = w0 * n[0][1] + w1 * n[1][1] + w2 * n[2][1];
        let lnz = w0 * n[0][2] + w1 * n[1][2] + w2 * n[2][2];
        const ll = Math.hypot(lnx, lny, lnz) || 1;
        lnx /= ll; lny /= ll; lnz /= ll;

        let hn = [lnx, lny, lnz];
        const hit = grid.closest(lpx, lpy, lpz, 1) ?? grid.closest(lpx, lpy, lpz, 2);
        if (hit && hit.distSq < maxDist2 && hit.nx * lnx + hit.ny * lny + hit.nz * lnz >= 0.05) {
          hn = [hit.nx, hit.ny, hit.nz];
        }
        const ortho = (a) => {
          const dd = a[0] * lnx + a[1] * lny + a[2] * lnz;
          const o = [a[0] - lnx * dd, a[1] - lny * dd, a[2] - lnz * dd];
          const l = Math.hypot(...o) || 1;
          return [o[0] / l, o[1] / l, o[2] / l];
        };
        const T = ortho(dpdu), B = ortho(dpdv);
        const tx = hn[0] * T[0] + hn[1] * T[1] + hn[2] * T[2];
        const ty = -(hn[0] * B[0] + hn[1] * B[1] + hn[2] * B[2]);
        const tz = Math.max(0, hn[0] * lnx + hn[1] * lny + hn[2] * lnz);
        const l = Math.hypot(tx, ty, tz) || 1;
        const o = (py * size + px) * 4;
        img[o] = Math.round(((tx / l) * 0.5 + 0.5) * 255);
        img[o + 1] = Math.round(((ty / l) * 0.5 + 0.5) * 255);
        img[o + 2] = Math.round(((tz / l) * 0.5 + 0.5) * 255);
        mask[py * size + px] = 1;
      }
  }
  const ring = Math.max(4, size / 64);
  dilate(img, mask, size, ring);
  pushPull(img, mask, size);
  return encodeJPEG(img, size, size, quality);
}

/* ── Clean analytical sd_rig_v3 skin weights ─────────────────────────────── */

function segProj(px, py, pz, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const len2 = vx * vx + vy * vy + vz * vz || 1;
  const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy + (pz - a[2]) * vz) / len2, 0, 1);
  const dx = px - (a[0] + vx * t), dy = py - (a[1] + vy * t), dz = pz - (a[2] + vz * t);
  return { t, d: Math.hypot(dx, dy, dz) };
}

function skinWeightAt(x, y, z) {
  const w = {};
  const add = (b, v) => {
    if (v > 1e-4) w[b] = (w[b] ?? 0) + v;
  };
  const side = x >= 0 ? "L" : "R";

  // Head & upper neck
  if (y > 1.545) {
    add("Head", 1);
    return w;
  }
  if (y > 1.44 && Math.abs(x) < 0.085) {
    const kHead = sstep(1.495, 1.545, y);
    const kNeck = sstep(1.43, 1.485, y) * (1 - kHead);
    const kSpine2 = 1 - kHead - kNeck;
    add("Head", kHead);
    add("Neck", kNeck);
    add("Spine2", kSpine2);
    return w;
  }

  // Arms (strictly separated from torso by |x| and y)
  const armMask = sstep(0.145, 0.20, Math.abs(x)) * sstep(0.55, 0.64, y) * sstep(1.52, 1.44, y);
  if (armMask > 0.001) {
    const sh = REST[sideBone("Shoulder", side)];
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
  // Legs (y < 0.91)
  if (y < 0.91) {
    const kHip = sstep(0.80, 0.91, y);
    const legW = torsoW * (1 - kHip);
    add("Hips", torsoW * kHip);
    if (legW > 0.001) {
      const kToe = sstep(0.06, 0.02, y) * sstep(0.06, 0.11, z);
      const kFoot = sstep(0.13, 0.075, y) * (1 - kToe);
      const kKnee = sstep(0.56, 0.44, y) * (1 - kFoot - kToe);
      const kUp = 1 - kToe - kFoot - kKnee;
      add(sideBone("ToeBase", side), legW * kToe);
      add(sideBone("Foot", side), legW * kFoot);
      add(sideBone("Leg", side), legW * kKnee);
      add(sideBone("UpLeg", side), legW * kUp);
    }
    return w;
  }

  // Torso spine chain (0.91 .. 1.48)
  const kS = sstep(0.95, 1.06, y);
  const kS1 = sstep(1.08, 1.18, y);
  const kS2 = sstep(1.20, 1.32, y);
  add("Hips", torsoW * (1 - kS));
  add("Spine", torsoW * (kS - kS1));
  add("Spine1", torsoW * (kS1 - kS2));
  add("Spine2", torsoW * kS2);
  return w;
}

/* ── Build morphs (buildSlim / buildBroad) & Head shape warps ────────────── */

function computeBuildMorph(positions, normals, sign) {
  const n = positions.length / 3;
  const dpos = new Float32Array(n * 3);
  const dnrm = new Float32Array(n * 3);
  const amt = sign > 0 ? 0.024 : -0.018;
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const headFade = sstep(1.56, 1.47, y);
    const footFade = sstep(0.07, 0.16, y);
    const handFade = 1 - sstep(0.32, 0.37, Math.abs(x)) * sstep(1.00, 0.90, y);
    const mask = headFade * footFade * handFade;
    if (mask <= 0) continue;
    // Broaden shoulders/chest slightly more than lower legs
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
    const faceW = sstep(1.51, 1.55, y) * sstep(1.68, 1.63, y) * sstep(-0.02, 0.04, z);
    const jawW = sstep(1.52, 1.55, y) * sstep(1.62, 1.57, y) * sstep(-0.02, 0.05, z);
    const chinW = gauss(ax, 0, 0.03) * gauss(y, 1.545, 0.022) * sstep(0.03, 0.07, z);
    if (shape === "round") {
      x *= 1 + 0.09 * faceW;
      y += 0.004 * chinW;
    } else if (shape === "square") {
      x *= 1 + 0.14 * jawW + 0.13 * chinW;
      y -= 0.006 * jawW * sstep(0.03, 0.055, ax);
      z += 0.004 * chinW;
    } else if (shape === "heart") {
      x *= 1 + 0.055 * gauss(y, 1.625, 0.024) * sstep(0.01, 0.05, z) - 0.13 * jawW - 0.16 * chinW;
      y -= 0.004 * chinW;
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

function warpNoseShape(positions, nose) {
  const out = new Float32Array(positions);
  if (nose === "button") return out;
  for (let i = 0; i < out.length; i += 3) {
    let x = out[i], y = out[i + 1], z = out[i + 2];
    const w = sstep(0.032, 0.010, Math.abs(x)) * sstep(1.585, 1.605, y) * sstep(1.665, 1.645, y) * sstep(0.075, 0.098, z);
    if (w <= 0) continue;
    if (nose === "straight") {
      z += 0.009 * w * sstep(1.655, 1.610, y);
      y -= 0.004 * w * sstep(1.635, 1.600, y);
    } else if (nose === "broad") {
      x *= 1 + 0.35 * w * sstep(1.645, 1.600, y);
      z += 0.003 * w;
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/* ── Stylized Eyes, Lids, Lashes, and Brows placed on this head ──────────── */

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
  console.log("Loading & aligning Character Base GLB (Male Character from scratch)...");
  const base0 = await loadCharacterBase();

  console.log("Subdividing (1x for game mesh, 2x for high-res AO & normal map bake)...");
  const sub1 = loopSubdivide(base0.positions, base0.indices);
  const sub2 = loopSubdivide(sub1.positions, sub1.indices);

  // Gently sculpt clean orbital eye sockets into sub1 & sub2 so Eyes/Lids sit naturally flush.
  const eyeCenter = [0.032, 1.652, 0.075];
  const eyeRadius = 0.0145;
  const sculptSockets = (P) => {
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (y < 1.62 || y > 1.685 || z < 0.06) continue;
      for (const s of [1, -1]) {
        const dx = (x - s * eyeCenter[0]) / 0.019;
        const dy = (y - eyeCenter[1]) / 0.013;
        const r2 = dx * dx + dy * dy;
        if (r2 < 1.6) {
          const indent = 0.0085 * Math.exp(-r2 * 1.9);
          P[v * 3 + 2] -= indent;
        }
      }
    }
  };
  sculptSockets(sub1.positions);
  sculptSockets(sub2.positions);

  // Compute unified smooth normals on sub1 BEFORE splitting at neck seam!
  const sub1Normals = computeNormals(sub1.positions, sub1.indices);
  const sub2Normals = computeNormals(sub2.positions, sub2.indices);
  const hiGrid = new HighResGrid(sub2.positions, sub2.indices, sub2Normals, 0.014);

  // Split sub1 into Body and Head at NECK_SPLIT_Y (exact shared boundary vertices & normals).
  const isHeadTri = (t) => {
    const a = sub1.indices[t * 3], b = sub1.indices[t * 3 + 1], c = sub1.indices[t * 3 + 2];
    const cy = (sub1.positions[a * 3 + 1] + sub1.positions[b * 3 + 1] + sub1.positions[c * 3 + 1]) / 3;
    const cx = (sub1.positions[a * 3] + sub1.positions[b * 3] + sub1.positions[c * 3]) / 3;
    return cy > NECK_SPLIT_Y && Math.abs(cx) < 0.14;
  };
  const bodyMesh = compactSubmesh(sub1.positions, sub1Normals, sub1.indices, (t) => !isHeadTri(t));
  const headMesh = compactSubmesh(sub1.positions, sub1Normals, sub1.indices, (t) => isHeadTri(t));

  // Build glTF document for art/base.glb.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("art_base");
  scene.setExtras({ sdAvatar: { rig: RIG_ID, version: 3, kind: "base" } });

  // Create sd_rig_v3 skeleton & inverse bind matrices.
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

  const mats = {};
  const getMat = (name, color = [0.9, 0.7, 0.55, 1]) => {
    if (!mats[name]) mats[name] = doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(0.6);
    return mats[name];
  };

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

  // 1. Body: AO, skin tint, clean sd_rig_v3 weights, buildSlim/buildBroad/frameFem morphs, 1024x1024 normal map.
  console.log("Baking Body vertex AO & 1024x1024 normal map...");
  const bodyAO = bakeMeshAO(hiGrid, bodyMesh.positions, bodyMesh.normals, { step: 0.008, strength: 0.72, min: 0.58 });
  const bn = bodyMesh.positions.length / 3;
  const bodyColors = new Uint8Array(bn * 4);
  const bodyWeights = new Array(bn);
  for (let v = 0; v < bn; v++) {
    const x = bodyMesh.positions[v * 3], y = bodyMesh.positions[v * 3 + 1], z = bodyMesh.positions[v * 3 + 2];
    bodyWeights[v] = skinWeightAt(x, y, z);
    const [r, g, b] = bodyTint(x, y, z);
    const ao = bodyAO[v];
    bodyColors.set([Math.round(r * ao * 248), Math.round(g * ao * 248), Math.round(b * ao * 248), 255], v * 4);
  }
  const zeroBodyMorph = { dpos: new Float32Array(bn * 3), dnrm: new Float32Array(bn * 3) };
  const bodyAtlas = atlas([{ P: bodyMesh.positions, I: bodyMesh.indices }], 1024);
  const bodyMd = withUVs(
    {
      positions: bodyMesh.positions,
      normals: bodyMesh.normals,
      indices: bodyMesh.indices,
      colors: bodyColors,
      weights: bodyWeights,
      morphs: {
        buildSlim: computeBuildMorph(bodyMesh.positions, bodyMesh.normals, -1),
        buildBroad: computeBuildMorph(bodyMesh.positions, bodyMesh.normals, 1),
        frameFem: zeroBodyMorph,
      },
    },
    bodyAtlas.entries[0].triChart,
    bodyAtlas.entries[0].uv
  );
  const bodyNormJpeg = bakeHighResNormalMap(hiGrid, bodyMd, 1024, { maxDist: 0.025, quality: 90 });
  const bodyNormTex = doc.createTexture("body_normal").setMimeType("image/jpeg").setImage(bodyNormJpeg);
  getMat("skin_body").setNormalTexture(bodyNormTex);
  addArtMesh("Body", "skin_body", bodyMd);

  // 2. Fitted Underwear (extracted directly from Body hip/upper-thigh triangles, offset +4.8mm along normals,
  // with boundary vertices snapped cleanly to horizontal waistband & leg-hem planes).
  const uwRaw = compactSubmesh(bodyMesh.positions, bodyMesh.normals, bodyMesh.indices, (t) => {
    const a = bodyMesh.indices[t * 3], b = bodyMesh.indices[t * 3 + 1], c = bodyMesh.indices[t * 3 + 2];
    const cy = (bodyMesh.positions[a * 3 + 1] + bodyMesh.positions[b * 3 + 1] + bodyMesh.positions[c * 3 + 1]) / 3;
    const cx = (bodyMesh.positions[a * 3] + bodyMesh.positions[b * 3] + bodyMesh.positions[c * 3]) / 3;
    return cy >= 0.75 && cy <= 0.985 && Math.abs(cx) < 0.22;
  });
  const un = uwRaw.positions.length / 3;
  // Identify boundary vertices of Underwear so top/bottom hems sit flat and crisp.
  const uwEdgeCnt = new Map();
  for (let t = 0; t < uwRaw.indices.length; t += 3) {
    const tri = [uwRaw.indices[t], uwRaw.indices[t + 1], uwRaw.indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      const ek = u < v ? `${u},${v}` : `${v},${u}`;
      uwEdgeCnt.set(ek, (uwEdgeCnt.get(ek) ?? 0) + 1);
    }
  }
  const uwBorder = new Uint8Array(un);
  for (const [ek, cnt] of uwEdgeCnt) {
    if (cnt === 1) {
      const [u, v] = ek.split(",").map(Number);
      uwBorder[u] = 1;
      uwBorder[v] = 1;
    }
  }
  const uwColors = new Uint8Array(un * 4);
  const uwWeights = new Array(un);
  for (let v = 0; v < un; v++) {
    let x = uwRaw.positions[v * 3], y = uwRaw.positions[v * 3 + 1], z = uwRaw.positions[v * 3 + 2];
    if (uwBorder[v]) {
      if (y > 0.93) y = 0.985;
      else if (y < 0.80) y = 0.755;
    }
    const nx = uwRaw.normals[v * 3], ny = uwRaw.normals[v * 3 + 1], nz = uwRaw.normals[v * 3 + 2];
    const band = 0.0012 * sstep(0.95, 0.965, y);
    const off = 0.0048 + band;
    uwRaw.positions[v * 3] = x + nx * off;
    uwRaw.positions[v * 3 + 1] = y + ny * off;
    uwRaw.positions[v * 3 + 2] = z + nz * off;
    uwWeights[v] = skinWeightAt(x, y, z);
    const k = Math.round(255 * (1 - 0.22 * sstep(0.945, 0.96, y)));
    uwColors.set([k, k, k, 255], v * 4);
  }
  const zeroUwMorph = { dpos: new Float32Array(un * 3), dnrm: new Float32Array(un * 3) };
  addArtMesh("Underwear", "base_layer", {
    positions: uwRaw.positions,
    normals: uwRaw.normals,
    indices: uwRaw.indices,
    colors: uwColors,
    weights: uwWeights,
    morphs: {
      buildSlim: computeBuildMorph(uwRaw.positions, uwRaw.normals, -1),
      buildBroad: computeBuildMorph(uwRaw.positions, uwRaw.normals, 1),
      frameFem: zeroUwMorph,
    },
  });

  // 3. All 12 Head_<face>[_<nose>] meshes with AO, weights, UVs & shared 1024x1024 normal map.
  console.log("Baking Head vertex AO & 1024x1024 normal map...");
  const headAO = bakeMeshAO(hiGrid, headMesh.positions, headMesh.normals, { step: 0.005, strength: 0.65, min: 0.64 });
  const hn = headMesh.positions.length / 3;
  const headWeights = new Array(hn);
  for (let v = 0; v < hn; v++) {
    headWeights[v] = skinWeightAt(headMesh.positions[v * 3], headMesh.positions[v * 3 + 1], headMesh.positions[v * 3 + 2]);
  }
  const headAtlas = atlas([{ P: headMesh.positions, I: headMesh.indices }], 1024);
  const headOvalUv = withUVs(
    { positions: headMesh.positions, normals: headMesh.normals, indices: headMesh.indices, morphs: {} },
    headAtlas.entries[0].triChart,
    headAtlas.entries[0].uv
  );
  const headNormJpeg = bakeHighResNormalMap(hiGrid, headOvalUv, 1024, { maxDist: 0.025, quality: 90 });
  const headNormTex = doc.createTexture("head_normal").setMimeType("image/jpeg").setImage(headNormJpeg);
  getMat("skin_head").setNormalTexture(headNormTex);
  const zeroHeadMorph = { dpos: new Float32Array(hn * 3), dnrm: new Float32Array(hn * 3) };

  for (const face of FACE_SHAPES) {
    const mFace = warpFaceShape(headMesh.positions, face);
    for (const nose of NOSE_SHAPES) {
      const mPos = warpNoseShape(mFace, nose);
      const mNrm = face === "oval" && nose === "button" ? headMesh.normals : computeNormals(mPos, headMesh.indices);
      const colors = new Uint8Array(hn * 4);
      for (let v = 0; v < hn; v++) {
        const [r, g, b] = headTint(mPos[v * 3], mPos[v * 3 + 1], mPos[v * 3 + 2]);
        const ao = headAO[v];
        colors.set([Math.round(r * ao * 248), Math.round(g * ao * 248), Math.round(b * ao * 248), 255], v * 4);
      }
      const headMd = withUVs(
        {
          positions: mPos,
          normals: mNrm,
          indices: headMesh.indices,
          colors,
          weights: headWeights,
          morphs: {
            buildSlim: computeBuildMorph(mPos, mNrm, -1),
            buildBroad: computeBuildMorph(mPos, mNrm, 1),
            frameFem: zeroHeadMorph,
          },
        },
        headAtlas.entries[0].triChart,
        headAtlas.entries[0].uv
      );
      const name = nose === "button" ? `Head_${face}` : `Head_${face}_${nose}`;
      addArtMesh(name, "skin_head", headMd);
    }
  }

  // 4. Eyes, Iris, Pupils, Lids_*, Lashes_*, and Brows_* fitted to this head's exact eye sockets.
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

  // Fitted Brows_* flush onto the forehead above the eye sockets.
  const browStyles = {
    soft: { h: 0.0028, arch: 0.004, thick: 0.0024 },
    arched: { h: 0.0032, arch: 0.008, thick: 0.0022 },
    bold: { h: 0.0038, arch: 0.0045, thick: 0.0034 },
  };
  for (const style of EYEBROWS) {
    if (style === "none") continue;
    const bs = browStyles[style];
    const browData = buildEyePart(eyeCenter, eyeRadius, (b, c) => {
      for (const s of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const bx = s * (0.015 + t * 0.036);
          const by = c[1] + 0.022 + bs.arch * Math.sin(t * Math.PI) - 0.003 * t;
          // Project onto forehead surface + 1.8 mm outward
          const hit = hiGrid.closest(bx, by, c[2] + 0.018, 2);
          const bz = hit ? c[2] + 0.018 + (hit.nz > 0 ? 0.0018 : 0) : c[2] + 0.015;
          const r = bs.thick * (0.65 + 0.35 * Math.sin(t * Math.PI));
          pts.push({ c: [bx, by, bz - 0.008 * t * t], rx: r, rz: r * 0.65, w: {} });
        }
        tube(b, pts, { steps: 1, radial: 5, capStart: true, capEnd: true });
      }
    });
    addArtMesh(`Brows_${style}`, "brow", browData, boneNodes.Head);
  }

  await io.write(OUT_GLB, doc);
  console.log(
    `Wrote ${OUT_GLB} (Body: ${bodyMesh.indices.length / 3} tris, Underwear: ${uwRaw.indices.length / 3} tris, Head: ${headMesh.indices.length / 3} tris, normal maps: ${(bodyNormJpeg.length / 1024).toFixed(0)} KB + ${(headNormJpeg.length / 1024).toFixed(0)} KB)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

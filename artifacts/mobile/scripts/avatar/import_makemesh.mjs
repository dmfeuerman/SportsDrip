#!/usr/bin/env node
/**
 * Converts `male-base-mesh-base_male.glb` and `female-base-mesh-base_female.glb`
 * into `scripts/avatar/art/base.glb` aligned to `sd_rig_v3`, with:
 *   - true MakeHuman anatomy (no tuckBody distortion)
 *   - 1-to-1 `frameFem` vertex correspondence from female - male
 *   - tightened error-bounded simplification within validate.mjs budgets
 *   - smooth normals across the neck seam and limbs
 *   - vertex AO and 1024x1024 tangent-space normal maps baked from the
 *     unsimplified high-res MakeHuman meshes
 *   - original MakeHuman skin weights mapped onto `sd_rig_v3` bones
 *   - all 4 face shapes x 3 nose shapes, eyes, irises, pupils, lids, lashes
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptSimplifier } from "./vendor/meshopt_simplifier.mjs";
import { BONE_NAMES, BONES, EYE_SHAPES, FACE_SHAPES, HEAD, NOSE_SHAPES, REST, RIG_ID, sideBone } from "./rig.mjs";
import { bodyImportance, bodyTint, headTint, NECK_SEAM } from "./character.mjs";
import { EYE_SHAPE, GAZE_IN, irisShade } from "./face.mjs";
import { MeshBuilder, tube } from "./geometry.mjs";
import { clamp, gauss, importanceWarp, sstep } from "./sdf.mjs";
import { atlas, dilate, pushPull, withUVs } from "./bake.mjs";
import { encodeJPEG } from "./jpeg.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");
const MALE_GLB = join(ROOT, "male-base-mesh-base_male.glb");
const FEMALE_GLB = join(ROOT, "female-base-mesh-base_female.glb");
const ART_DIR = join(here, "art");
const OUT_GLB = join(ART_DIR, "base.glb");
const PREVIEW_BARE = process.argv.includes("--bare") || process.env.PREVIEW_BARE === "1";

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

/** Map any of MakeHuman's 163 bones to its corresponding `sd_rig_v3` bone name. */
function mapMhBone(name) {
  if (name === "root" || name.startsWith("pelvis.") || name === "spine05") return "Hips";
  if (name === "spine04" || name === "spine03") return "Spine";
  if (name === "spine02") return "Spine1";
  if (name === "spine01" || name.startsWith("breast.")) return "Spine2";
  if (name.startsWith("neck")) return "Neck";
  const side = name.endsWith(".L") ? "Left" : name.endsWith(".R") ? "Right" : null;
  if (side) {
    if (name.startsWith("clavicle") || name.startsWith("shoulder")) return `${side}Shoulder`;
    if (name.startsWith("upperarm")) return `${side}Arm`;
    if (name.startsWith("lowerarm")) return `${side}ForeArm`;
    if (name.startsWith("wrist") || name.startsWith("finger") || name.startsWith("metacarpal")) return `${side}Hand`;
    if (name.startsWith("upperleg")) return `${side}UpLeg`;
    if (name.startsWith("lowerleg")) return `${side}Leg`;
    if (name.startsWith("foot")) return `${side}Foot`;
    if (name.startsWith("toe")) return `${side}ToeBase`;
  }
  return "Head";
}

function floats(acc) {
  const n = acc.getCount();
  const k = acc.getElementSize();
  const out = new Float32Array(n * k);
  const el = new Array(k);
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    for (let j = 0; j < k; j++) out[i * k + j] = el[j];
  }
  return out;
}

/**
 * Loads a MakeHuman GLB, poses its 163-bone skeleton to match `sd_rig_v3`'s
 * relaxed A-pose and leg stance, scales uniformly to 1.80 m, and returns:
 *   { positions, indices, weights, eyeCenter, eyeRadius }
 */
async function loadAndPoseMakeHuman(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const jointToSd = joints.map((j) => mapMhBone(j.getName()));

  // Build Three.js bone hierarchy matching the glTF skin joints.
  const nodeToBone = new Map();
  const boneByName = new Map();
  for (const j of joints) {
    const b = new THREE.Bone();
    b.name = j.getName();
    const t = j.getTranslation();
    const r = j.getRotation();
    const s = j.getScale();
    b.position.set(t[0], t[1], t[2]);
    b.quaternion.set(r[0], r[1], r[2], r[3]);
    b.scale.set(s[0], s[1], s[2]);
    nodeToBone.set(j, b);
    boneByName.set(b.name, b);
  }
  const rootBones = [];
  for (const j of joints) {
    const b = nodeToBone.get(j);
    const parent = root.listNodes().find((n) => n.listChildren().includes(j));
    if (parent && nodeToBone.has(parent)) nodeToBone.get(parent).add(b);
    else rootBones.push(b);
  }
  const skelRoot = new THREE.Group();
  for (const b of rootBones) skelRoot.add(b);
  skelRoot.updateMatrixWorld(true);

  const ibmArr = floats(skin.getInverseBindMatrices());
  const invBinds = joints.map((_, i) => new THREE.Matrix4().fromArray(ibmArr, i * 16));
  const bones = joints.map((j) => nodeToBone.get(j));

  // Helper to rotate a MakeHuman bone so (childPos - bonePos) aligns with targetDir.
  const wp = (name) => {
    skelRoot.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(boneByName.get(name).matrixWorld);
  };
  const alignBone = (name, childName, targetDir) => {
    const b = boneByName.get(name);
    const p0 = wp(name);
    const p1 = wp(childName);
    const cur = p1.sub(p0).normalize();
    const tgt = targetDir.clone().normalize();
    const qWorld = new THREE.Quaternion().setFromUnitVectors(cur, tgt);
    const parentWorldQ = new THREE.Quaternion();
    if (b.parent) b.parent.getWorldQuaternion(parentWorldQ);
    const invParent = parentWorldQ.clone().invert();
    b.quaternion.premultiply(parentWorldQ).premultiply(qWorld).premultiply(invParent);
    skelRoot.updateMatrixWorld(true);
  };

  for (const side of ["L", "R"]) {
    const armTarget = new THREE.Vector3(
      REST[sideBone("ForeArm", side)][0] - REST[sideBone("Arm", side)][0],
      REST[sideBone("ForeArm", side)][1] - REST[sideBone("Arm", side)][1],
      REST[sideBone("ForeArm", side)][2] - REST[sideBone("Arm", side)][2]
    );
    const foreTarget = new THREE.Vector3(
      REST[sideBone("Hand", side)][0] - REST[sideBone("ForeArm", side)][0],
      REST[sideBone("Hand", side)][1] - REST[sideBone("ForeArm", side)][1],
      REST[sideBone("Hand", side)][2] - REST[sideBone("ForeArm", side)][2]
    );
    alignBone(`upperarm01.${side}`, `lowerarm01.${side}`, armTarget);
    alignBone(`lowerarm01.${side}`, `wrist.${side}`, foreTarget);
    alignBone(`wrist.${side}`, `finger3-1.${side}`, foreTarget);

    const upLegTarget = new THREE.Vector3(
      REST[sideBone("Leg", side)][0] - REST[sideBone("UpLeg", side)][0],
      REST[sideBone("Leg", side)][1] - REST[sideBone("UpLeg", side)][1],
      REST[sideBone("Leg", side)][2] - REST[sideBone("UpLeg", side)][2]
    );
    const legTarget = new THREE.Vector3(
      REST[sideBone("Foot", side)][0] - REST[sideBone("Leg", side)][0],
      REST[sideBone("Foot", side)][1] - REST[sideBone("Leg", side)][1],
      REST[sideBone("Foot", side)][2] - REST[sideBone("Leg", side)][2]
    );
    alignBone(`upperleg01.${side}`, `lowerleg01.${side}`, upLegTarget);
    alignBone(`lowerleg01.${side}`, `foot.${side}`, legTarget);
  }

  skelRoot.updateMatrixWorld(true);
  const skinMats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, invBinds[i]));

  // Skin the main body mesh (primitive 0) and remap skin weights to sd_rig_v3.
  const bodyNode = root.listNodes().find((n) => n.getMesh() && !n.getName().includes("high-poly"));
  const prim = bodyNode.getMesh().listPrimitives()[0];
  const P0 = floats(prim.getAttribute("POSITION"));
  const J = floats(prim.getAttribute("JOINTS_0"));
  const W = floats(prim.getAttribute("WEIGHTS_0"));
  const indices = new Uint32Array(floats(prim.getIndices()));
  const n = P0.length / 3;
  const pos = new Float32Array(n * 3);
  const weights = new Array(n);
  const v = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    v.set(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]);
    acc.set(0, 0, 0);
    let tot = 0;
    const bw = {};
    for (let k = 0; k < 4; k++) {
      const w = W[i * 4 + k];
      if (!w) continue;
      const jIdx = J[i * 4 + k];
      tot += w;
      tmp.copy(v).applyMatrix4(skinMats[jIdx]);
      acc.addScaledVector(tmp, w);
      const sdBone = jointToSd[jIdx] ?? "Hips";
      bw[sdBone] = (bw[sdBone] ?? 0) + w;
    }
    if (tot > 0) {
      acc.divideScalar(tot);
      for (const b of Object.keys(bw)) bw[b] /= tot;
    } else {
      acc.copy(v);
      bw.Hips = 1;
    }
    weights[i] = bw;
    pos[i * 3] = acc.x;
    pos[i * 3 + 1] = acc.y;
    pos[i * 3 + 2] = acc.z;
    minY = Math.min(minY, acc.y);
    maxY = Math.max(maxY, acc.y);
  }

  // Uniformly scale to 1.80 m height and align feet to y = 0, hip-joint z to 0.
  const scale = 1.8 / (maxY - minY);
  const hipZ = ((wp("upperleg01.L").z + wp("upperleg01.R").z) / 2) * scale;
  for (let i = 0; i < n; i++) {
    pos[i * 3] *= scale;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - minY) * scale;
    pos[i * 3 + 2] = pos[i * 3 + 2] * scale - hipZ;
  }

  // Align arms/hands to sd_rig_v3's arm axis (x = +-0.188..0.354, z = -0.012..0.012).
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    const armMask = sstep(0.16, 0.21, Math.abs(x)) * sstep(0.65, 0.78, y) * sstep(1.48, 1.38, y);
    if (armMask > 0) {
      pos[i * 3] -= Math.sign(x) * 0.016 * armMask;
      pos[i * 3 + 2] -= 0.02 * armMask;
    }
  }

  // Measure left eye center from high-poly eye mesh, scaled and shifted identically.
  const eyeNode = root.listNodes().find((n) => n.getName().includes("high-poly"));
  const eyeP = floats(eyeNode.getMesh().listPrimitives()[0].getAttribute("POSITION"));
  const eyeJ = floats(eyeNode.getMesh().listPrimitives()[0].getAttribute("JOINTS_0"));
  const eyeW = floats(eyeNode.getMesh().listPrimitives()[0].getAttribute("WEIGHTS_0"));
  let eMin = [Infinity, Infinity, Infinity], eMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < eyeP.length / 3; i++) {
    v.set(eyeP[i * 3], eyeP[i * 3 + 1], eyeP[i * 3 + 2]);
    acc.set(0, 0, 0);
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      const w = eyeW[i * 4 + k];
      if (!w) continue;
      tot += w;
      tmp.copy(v).applyMatrix4(skinMats[eyeJ[i * 4 + k]]);
      acc.addScaledVector(tmp, w);
    }
    if (tot > 0) acc.divideScalar(tot);
    const ex = acc.x * scale;
    const ey = (acc.y - minY) * scale;
    const ez = acc.z * scale - hipZ;
    if (ex > 0) {
      eMin = [Math.min(eMin[0], ex), Math.min(eMin[1], ey), Math.min(eMin[2], ez)];
      eMax = [Math.max(eMax[0], ex), Math.max(eMax[1], ey), Math.max(eMax[2], ez)];
    }
  }
  const rawEye = [0, 1, 2].map((k) => (eMin[k] + eMax[k]) / 2);
  const eyeRadius = Math.max(eMax[0] - eMin[0], eMax[1] - eMin[1]) / 2;

  // Align head (smoothly above y = 1.47) so eyes sit at y = 1.64, z = 0.0922, scale cranium slightly to match sd_rig_v3,
  // and conform scalp to rig.HEAD so all 8 hairstyles and 6 hats fit cleanly.
  const dyHead = 1.64 - rawEye[1];
  const dzHead = 0.0922 - rawEye[2];
  const [hx, hy, hz] = HEAD.center;
  const [rx, ry, rz] = HEAD.radii;
  for (let i = 0; i < n; i++) {
    const y0 = pos[i * 3 + 1];
    const k = sstep(1.46, 1.54, y0);
    if (k <= 0) continue;
    let x = pos[i * 3];
    let y = y0 + dyHead * k;
    let z = pos[i * 3 + 2] + dzHead * k;
    const hs = 1 + 0.07 * k;
    x = x * hs;
    y = 1.64 + (y - 1.64) * hs;
    z = 0.01 + (z - 0.01) * hs;
    const scalpMask = sstep(1.65, 1.69, y) + (1 - sstep(1.65, 1.69, y)) * sstep(0.04, -0.01, z) * sstep(1.56, 1.62, y);
    if (scalpMask > 0) {
      const dx = x - hx, dy = y - hy, dz = z - hz;
      const ell = Math.hypot(dx / (rx - 0.003), dy / (ry - 0.002), dz / (rz - 0.003));
      if (ell > 0.55) {
        const target = 1.0;
        const f = 1 + (target / ell - 1) * scalpMask;
        x = hx + dx * f;
        y = hy + dy * f;
        z = hz + dz * f;
      }
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }

  const eyeCenter = [rawEye[0] * 1.07, 1.64, 0.01 + (0.0922 - 0.01) * 1.07];
  return { positions: pos, indices, weights, eyeCenter, eyeRadius: eyeRadius * 1.07 };
}

/** Smooth area-weighted vertex normals. */
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

/** Blend normals across the neck seam so Body and Head_* share smooth shading across NECK_SEAM. */
function matchNeckSeamNormals(bodyPos, bodyNrm, headPos, headNrm) {
  const bodySeam = [];
  for (let v = 0; v < bodyPos.length / 3; v++) {
    if (bodyPos[v * 3 + 1] > NECK_SEAM - 0.015) bodySeam.push(v);
  }
  const headSeam = [];
  for (let v = 0; v < headPos.length / 3; v++) {
    if (headPos[v * 3 + 1] < NECK_SEAM + 0.015) headSeam.push(v);
  }
  for (const bv of bodySeam) {
    const bx = bodyPos[bv * 3], by = bodyPos[bv * 3 + 1], bz = bodyPos[bv * 3 + 2];
    let bestHv = -1, bestD2 = 0.003 * 0.003;
    for (const hv of headSeam) {
      const dx = headPos[hv * 3] - bx, dy = headPos[hv * 3 + 1] - by, dz = headPos[hv * 3 + 2] - bz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestHv = hv;
      }
    }
    if (bestHv >= 0) {
      const nx = bodyNrm[bv * 3] + headNrm[bestHv * 3];
      const ny = bodyNrm[bv * 3 + 1] + headNrm[bestHv * 3 + 1];
      const nz = bodyNrm[bv * 3 + 2] + headNrm[bestHv * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      bodyNrm[bv * 3] = headNrm[bestHv * 3] = nx / l;
      bodyNrm[bv * 3 + 1] = headNrm[bestHv * 3 + 1] = ny / l;
      bodyNrm[bv * 3 + 2] = headNrm[bestHv * 3 + 2] = nz / l;
    }
  }
}

/** Compacts a subset of triangles while returning origIdx[newV] -> oldV. */
function compactWithMap(positions, indices) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  const origIdx = [];
  const pos = [];
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (map[v] < 0) {
      map[v] = origIdx.length;
      origIdx.push(v);
      pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    idx[i] = map[v];
  }
  return { positions: new Float32Array(pos), indices: idx, origIdx: Int32Array.from(origIdx) };
}

/** Welds duplicate UV-seam vertices by position while preserving origIdx[newV] -> oldV. */
function weldByPosition(positions, indices, origIdx) {
  const map = new Map();
  const vMap = new Int32Array(positions.length / 3);
  const pos = [];
  const outOrig = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const kx = Math.round(positions[v * 3] * 20000);
    const ky = Math.round(positions[v * 3 + 1] * 20000);
    const kz = Math.round(positions[v * 3 + 2] * 20000);
    const key = `${kx},${ky},${kz}`;
    let id = map.get(key);
    if (id === undefined) {
      id = outOrig.length;
      map.set(key, id);
      pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      outOrig.push(origIdx[v]);
    }
    vMap[v] = id;
  }
  const idx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = vMap[indices[t]], b = vMap[indices[t + 1]], c = vMap[indices[t + 2]];
    if (a !== b && b !== c && c !== a) idx.push(a, b, c);
  }
  return { positions: new Float32Array(pos), indices: Uint32Array.from(idx), origIdx: Int32Array.from(outOrig) };
}

async function simplifyWithMap(positions, indices, origIdx, targetTris, maxBudget, { error, importance, centre, gain = 1.25 }) {
  await MeshoptSimplifier.ready;
  const welded = weldByPosition(positions, indices, origIdx);
  const measure = importanceWarp(welded.positions, importance, centre, gain);
  const target = Math.min(welded.indices.length, targetTris * 3);
  let chosen = null;
  for (const err of [error, error * 1.6, error * 2.5, error * 4]) {
    const [newIdx] = MeshoptSimplifier.simplify(welded.indices, measure, 3, target - (target % 3), err, ["ErrorAbsolute", "LockBorder"]);
    chosen = newIdx;
    if (newIdx.length / 3 <= maxBudget) break;
  }
  const c = compactWithMap(welded.positions, chosen);
  const mappedOrig = new Int32Array(c.origIdx.length);
  for (let i = 0; i < c.origIdx.length; i++) mappedOrig[i] = welded.origIdx[c.origIdx[i]];
  return { positions: c.positions, indices: c.indices, origIdx: mappedOrig };
}

/* ── High-res spatial hash for Vertex AO & Normal Map baking ─────────────── */

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

  /** Returns { distSq, nx, ny, nz } for the closest point on the high-res mesh within `radius` cells. */
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
            // Closest point on triangle ABC to P (Ericson, Real-Time Collision Detection).
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

/** Vertex AO computed directly from the unsimplified high-res MakeHuman mesh. */
function bakeMeshAO(grid, positions, normals, { step = 0.008, samples = 5, strength = 0.85, min = 0.52 } = {}) {
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

/** Bake a 1024x1024 tangent-space normal map (JPEG) from the high-res MakeHuman mesh onto a UV-mapped low-res mesh. */
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
        if (hit && hit.distSq < maxDist2) {
          if (hit.nx * lnx + hit.ny * lny + hit.nz * lnz >= 0.05) {
            hn = [hit.nx, hit.ny, hit.nz];
          }
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

/** Face shape warps on the MakeHuman head. */
function warpFaceShape(positions, shape) {
  const out = new Float32Array(positions);
  if (shape === "oval") return out;
  for (let i = 0; i < out.length; i += 3) {
    let x = out[i], y = out[i + 1], z = out[i + 2];
    const ax = Math.abs(x);
    const earZone = sstep(1.56, 1.595, y) * sstep(0.05, 0.005, z);
    const faceW = sstep(1.49, 1.53, y) * sstep(1.66, 1.61, y) * sstep(0.0, 0.05, z) * (1 - earZone);
    const jawW = sstep(1.5, 1.535, y) * sstep(1.6, 1.555, y) * sstep(-0.02, 0.06, z) * (1 - earZone);
    const chinW = gauss(ax, 0, 0.028) * gauss(y, 1.525, 0.022) * sstep(0.05, 0.085, z);
    if (shape === "round") {
      x *= 1 + 0.085 * faceW;
      y += 0.004 * chinW;
    } else if (shape === "square") {
      x *= 1 + 0.14 * jawW + 0.14 * chinW;
      y -= 0.007 * jawW * sstep(0.035, 0.055, ax);
      z += 0.004 * chinW;
    } else if (shape === "heart") {
      x *= 1 + 0.05 * gauss(y, 1.605, 0.022) * sstep(0.02, 0.06, z) * (1 - earZone) - 0.14 * jawW - 0.18 * chinW;
      y -= 0.005 * chinW;
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/** Nose shape warps on the MakeHuman head. */
function warpNoseShape(positions, nose) {
  const out = new Float32Array(positions);
  if (nose === "button") return out;
  for (let i = 0; i < out.length; i += 3) {
    let x = out[i], y = out[i + 1], z = out[i + 2];
    const w = sstep(0.034, 0.012, Math.abs(x)) * sstep(1.572, 1.588, y) * sstep(1.655, 1.635, y) * sstep(0.085, 0.108, z);
    if (w <= 0) continue;
    if (nose === "straight") {
      z += 0.0095 * w * sstep(1.645, 1.595, y);
      y -= 0.0045 * w * sstep(1.62, 1.585, y);
    } else if (nose === "broad") {
      x *= 1 + 0.34 * w * sstep(1.635, 1.588, y);
      z += 0.003 * w;
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/** Build a procedural eye part centered at MakeHuman's eye center. */
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

/** Soft head vertex importance: front face 1.0, ears 0.25, scalp 0.12. */
function mhHeadImportance(x, y, z) {
  const face = sstep(-0.005, 0.045, z) * sstep(1.49, 1.525, y) * sstep(1.725, 1.69, y);
  const ears = 0.25 * sstep(0.066, 0.08, Math.abs(x)) * sstep(0.05, 0.02, z) * sstep(1.55, 1.58, y) * sstep(1.71, 1.68, y);
  return 0.12 + 0.88 * Math.max(face, ears);
}

function makeAccessor(doc, buf, arr, type, normalized = false) {
  return doc.createAccessor().setBuffer(buf).setArray(arr).setType(type).setNormalized(normalized);
}

async function main() {
  mkdirSync(ART_DIR, { recursive: true });
  if (PREVIEW_BARE) {
    console.log("Bare preview mode active (use EXPO_PUBLIC_PREVIEW_BARE=1 when starting the app to hide Underwear/Bra & garments).");
  }
  console.log("Loading & posing MakeHuman male and female GLBs...");
  const male = await loadAndPoseMakeHuman(MALE_GLB);
  const female = await loadAndPoseMakeHuman(FEMALE_GLB);
  if (male.positions.length !== female.positions.length) {
    throw new Error(`Vertex count mismatch: male=${male.positions.length / 3}, female=${female.positions.length / 3}`);
  }

  console.log("Building high-res spatial hash for Vertex AO and 1024x1024 normal map baking...");
  const hiNormals = computeNormals(male.positions, male.indices);
  const hiGrid = new HighResGrid(male.positions, male.indices, hiNormals, 0.015);

  // Split triangles at NECK_SEAM = 1.47 into Body and Head_oval, centered on the actual neck Z.
  const P = male.positions, I = male.indices;
  let neckZSum = 0, neckZCnt = 0;
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i + 1] - NECK_SEAM) < 0.02 && Math.abs(P[i]) < 0.08) {
      neckZSum += P[i + 2];
      neckZCnt++;
    }
  }
  const neckZ = neckZCnt ? neckZSum / neckZCnt : 0;
  const bodyTris = [], headTris = [];
  for (let t = 0; t < I.length; t += 3) {
    const cx = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3;
    const cy = (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3;
    const cz = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
    if (cy > NECK_SEAM && Math.hypot(cx, cz - neckZ) < 0.11) headTris.push(I[t], I[t + 1], I[t + 2]);
    else bodyTris.push(I[t], I[t + 1], I[t + 2]);
  }

  console.log("Simplifying Body & Head with tight error bounds (~0.005)...");
  const bodyRaw = compactWithMap(P, Uint32Array.from(bodyTris));
  const bodySimp = await simplifyWithMap(bodyRaw.positions, bodyRaw.indices, bodyRaw.origIdx, 7200, 7500, {
    error: 0.005,
    importance: bodyImportance,
    centre: [0, 0.95, 0],
    gain: 1.25,
  });
  bodySimp.normals = computeNormals(bodySimp.positions, bodySimp.indices);

  const headRaw = compactWithMap(P, Uint32Array.from(headTris));
  const headSimp = await simplifyWithMap(headRaw.positions, headRaw.indices, headRaw.origIdx, 3500, 3500, {
    error: 0.005,
    importance: mhHeadImportance,
    centre: [0, 1.62, 0.02],
    gain: 1.25,
  });
  headSimp.normals = computeNormals(headSimp.positions, headSimp.indices);
  matchNeckSeamNormals(bodySimp.positions, bodySimp.normals, headSimp.positions, headSimp.normals);

  // Build glTF document for art/base.glb.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("art_base");
  scene.setExtras({ sdAvatar: { rig: RIG_ID, version: 3, kind: "base" } });

  // Create sd_rig_v3 skeleton nodes + skin with world-rest inverse bind matrices.
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
    if (!mats[name]) mats[name] = doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(0.62);
    return mats[name];
  };

  const addArtMesh = (name, matName, data, parentNode = null) => {
    const mesh = doc.createMesh(name);
    const prim = doc.createPrimitive()
      .setMaterial(getMat(matName))
      .setAttribute("POSITION", makeAccessor(doc, buf, data.positions, "VEC3"))
      .setAttribute("NORMAL", makeAccessor(doc, buf, data.normals, "VEC3"))
      .setIndices(makeAccessor(doc, buf, data.indices, "SCALAR"));
    if (data.uvs) {
      prim.setAttribute("TEXCOORD_0", makeAccessor(doc, buf, data.uvs, "VEC2"));
    }
    if (data.colors) {
      prim.setAttribute("COLOR_0", makeAccessor(doc, buf, data.colors, "VEC4", true));
    }
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

  // Compute Body vertex AO, tint, MakeHuman skin weights, frameFem, UVs & 1024x1024 normal map.
  console.log("Baking Body vertex AO & 1024x1024 tangent-space normal map...");
  const femPos = female.positions;
  const bodyFemPos = new Float32Array(bodySimp.positions.length);
  const bodyColors = new Uint8Array((bodySimp.positions.length / 3) * 4);
  const bodyWeights = new Array(bodySimp.origIdx.length);
  const bodyAO = bakeMeshAO(hiGrid, bodySimp.positions, bodySimp.normals, { step: 0.008, strength: 0.85, min: 0.52 });
  for (let v = 0; v < bodySimp.origIdx.length; v++) {
    const oi = bodySimp.origIdx[v];
    bodyFemPos[v * 3] = femPos[oi * 3];
    bodyFemPos[v * 3 + 1] = femPos[oi * 3 + 1];
    bodyFemPos[v * 3 + 2] = femPos[oi * 3 + 2];
    bodyWeights[v] = male.weights[oi];
    const [r, g, b] = bodyTint(bodySimp.positions[v * 3], bodySimp.positions[v * 3 + 1], bodySimp.positions[v * 3 + 2]);
    const ao = bodyAO[v];
    bodyColors.set([Math.round(r * ao * 245), Math.round(g * ao * 245), Math.round(b * ao * 245), 255], v * 4);
  }
  const bodyFemNrm = computeNormals(bodyFemPos, bodySimp.indices);
  const bodyDpos = new Float32Array(bodySimp.positions.length);
  const bodyDnrm = new Float32Array(bodySimp.normals.length);
  for (let i = 0; i < bodyDpos.length; i++) {
    bodyDpos[i] = bodyFemPos[i] - bodySimp.positions[i];
    bodyDnrm[i] = bodyFemNrm[i] - bodySimp.normals[i];
  }
  const bodyAtlas = atlas([{ P: bodySimp.positions, I: bodySimp.indices }], 1024);
  const bodyMd = withUVs(
    {
      positions: bodySimp.positions,
      normals: bodySimp.normals,
      indices: bodySimp.indices,
      colors: bodyColors,
      weights: bodyWeights,
      morphs: { frameFem: { dpos: bodyDpos, dnrm: bodyDnrm } },
    },
    bodyAtlas.entries[0].triChart,
    bodyAtlas.entries[0].uv
  );
  const bodyNormJpeg = bakeHighResNormalMap(hiGrid, bodyMd, 1024, { maxDist: 0.025, quality: 90 });
  const bodyNormTex = doc.createTexture("body_normal").setMimeType("image/jpeg").setImage(bodyNormJpeg);
  getMat("skin_body").setNormalTexture(bodyNormTex);
  addArtMesh("Body", "skin_body", bodyMd);

  // Extract fitted Underwear & Bra directly from MakeHuman Body triangles so they sit flush (zero floating/clipping).
  const extractFittedLayer = (srcPos, srcNrm, srcIdx, srcW, femPosArr, femNrmArr, keepTri, { off = 0.0048, topY = null, botY = null, bandY = null, femOnly = false } = {}) => {
    const vMap = new Int32Array(srcPos.length / 3).fill(-1);
    const keepV = [];
    const outIdx = [];
    for (let t = 0; t < srcIdx.length; t += 3) {
      if (!keepTri(t / 3)) continue;
      for (let k = 0; k < 3; k++) {
        const v = srcIdx[t + k];
        if (vMap[v] < 0) {
          vMap[v] = keepV.length;
          keepV.push(v);
        }
        outIdx.push(vMap[v]);
      }
    }
    const nv = keepV.length;
    const edgeCnt = new Map();
    for (let t = 0; t < outIdx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const u = outIdx[t + k], w = outIdx[t + ((k + 1) % 3)];
        const ek = u < w ? `${u},${w}` : `${w},${u}`;
        edgeCnt.set(ek, (edgeCnt.get(ek) ?? 0) + 1);
      }
    }
    const border = new Uint8Array(nv);
    for (const [ek, cnt] of edgeCnt) {
      if (cnt === 1) {
        const [u, w] = ek.split(",").map(Number);
        border[u] = 1;
        border[w] = 1;
      }
    }
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const dpos = new Float32Array(nv * 3);
    const dnrm = new Float32Array(nv * 3);
    const cols = new Uint8Array(nv * 4);
    const weights = new Array(nv);
    for (let i = 0; i < nv; i++) {
      const ov = keepV[i];
      let x = srcPos[ov * 3], y = srcPos[ov * 3 + 1], z = srcPos[ov * 3 + 2];
      let fx = femPosArr[ov * 3], fy = femPosArr[ov * 3 + 1], fz = femPosArr[ov * 3 + 2];
      if (border[i]) {
        if (topY !== null && y > topY - 0.05) y = topY;
        if (botY !== null && y < botY + 0.05) y = botY;
        if (topY !== null && fy > topY - 0.05) fy = topY;
        if (botY !== null && fy < botY + 0.05) fy = botY;
      }
      const nx = srcNrm[ov * 3], ny = srcNrm[ov * 3 + 1], nz = srcNrm[ov * 3 + 2];
      const fnx = femNrmArr[ov * 3], fny = femNrmArr[ov * 3 + 1], fnz = femNrmArr[ov * 3 + 2];
      const bExtra = bandY !== null ? 0.0012 * sstep(bandY - 0.01, bandY + 0.005, y) : 0;
      const o = off + bExtra;
      pos[i * 3] = x + nx * o;
      pos[i * 3 + 1] = y + ny * o;
      pos[i * 3 + 2] = z + nz * o;
      nrm[i * 3] = nx;
      nrm[i * 3 + 1] = ny;
      nrm[i * 3 + 2] = nz;
      if (!femOnly) {
        dpos[i * 3] = (fx + fnx * o) - pos[i * 3];
        dpos[i * 3 + 1] = (fy + fny * o) - pos[i * 3 + 1];
        dpos[i * 3 + 2] = (fz + fnz * o) - pos[i * 3 + 2];
        dnrm[i * 3] = fnx - nx;
        dnrm[i * 3 + 1] = fny - ny;
        dnrm[i * 3 + 2] = fnz - nz;
      }
      weights[i] = srcW[ov];
      const shade = bandY !== null ? 1 - 0.22 * sstep(bandY - 0.01, bandY + 0.005, y) : 0.92;
      const k = Math.round(255 * shade);
      cols.set([k, k, k, 255], i * 4);
    }
    return {
      positions: pos,
      normals: nrm,
      indices: Uint32Array.from(outIdx),
      colors: cols,
      weights,
      morphs: { frameFem: { dpos, dnrm } },
    };
  };

  const uwData = extractFittedLayer(
    bodySimp.positions,
    bodySimp.normals,
    bodySimp.indices,
    bodyWeights,
    bodyFemPos,
    bodyFemNrm,
    (t) => {
      const a = bodySimp.indices[t * 3], b = bodySimp.indices[t * 3 + 1], c = bodySimp.indices[t * 3 + 2];
      const cy = (bodySimp.positions[a * 3 + 1] + bodySimp.positions[b * 3 + 1] + bodySimp.positions[c * 3 + 1]) / 3;
      const cx = (bodySimp.positions[a * 3] + bodySimp.positions[b * 3] + bodySimp.positions[c * 3]) / 3;
      return cy >= 0.74 && cy <= 0.99 && Math.abs(cx) < 0.22;
    },
    { off: 0.005, topY: 0.99, botY: 0.745, bandY: 0.96 }
  );
  addArtMesh("Underwear", "base_layer", uwData);

  const braData = extractFittedLayer(
    bodyFemPos,
    bodyFemNrm,
    bodySimp.indices,
    bodyWeights,
    bodyFemPos,
    bodyFemNrm,
    (t) => {
      const a = bodySimp.indices[t * 3], b = bodySimp.indices[t * 3 + 1], c = bodySimp.indices[t * 3 + 2];
      const cy = (bodyFemPos[a * 3 + 1] + bodyFemPos[b * 3 + 1] + bodyFemPos[c * 3 + 1]) / 3;
      const cx = (bodyFemPos[a * 3] + bodyFemPos[b * 3] + bodyFemPos[c * 3]) / 3;
      return cy >= 1.21 && cy <= 1.375 && Math.abs(cx) < 0.165;
    },
    { off: 0.0055, topY: 1.375, botY: 1.215, bandY: 1.23, femOnly: true }
  );
  addArtMesh("Bra", "base_layer", braData);

  // Build all 12 Head_<face>[_<nose>] meshes with vertex AO, MakeHuman weights, UVs & shared 1024x1024 normal map.
  console.log("Baking Head vertex AO & 1024x1024 tangent-space normal map...");
  const headFemBase = new Float32Array(headSimp.positions.length);
  const headWeights = new Array(headSimp.origIdx.length);
  for (let v = 0; v < headSimp.origIdx.length; v++) {
    const oi = headSimp.origIdx[v];
    headFemBase[v * 3] = femPos[oi * 3];
    headFemBase[v * 3 + 1] = femPos[oi * 3 + 1];
    headFemBase[v * 3 + 2] = femPos[oi * 3 + 2];
    headWeights[v] = male.weights[oi];
  }
  const headAO = bakeMeshAO(hiGrid, headSimp.positions, headSimp.normals, { step: 0.005, strength: 0.7, min: 0.6 });
  const headAtlas = atlas([{ P: headSimp.positions, I: headSimp.indices }], 1024);
  const headOvalUv = withUVs(
    { positions: headSimp.positions, normals: headSimp.normals, indices: headSimp.indices, morphs: {} },
    headAtlas.entries[0].triChart,
    headAtlas.entries[0].uv
  );
  const headNormJpeg = bakeHighResNormalMap(hiGrid, headOvalUv, 1024, { maxDist: 0.025, quality: 90 });
  const headNormTex = doc.createTexture("head_normal").setMimeType("image/jpeg").setImage(headNormJpeg);
  getMat("skin_head").setNormalTexture(headNormTex);

  for (const face of FACE_SHAPES) {
    const mFace = warpFaceShape(headSimp.positions, face);
    const fFace = warpFaceShape(headFemBase, face);
    for (const nose of NOSE_SHAPES) {
      const mPos = warpNoseShape(mFace, nose);
      const fPos = warpNoseShape(fFace, nose);
      const mNrm = computeNormals(mPos, headSimp.indices);
      const fNrm = computeNormals(fPos, headSimp.indices);
      const dpos = new Float32Array(mPos.length);
      const dnrm = new Float32Array(mNrm.length);
      const colors = new Uint8Array((mPos.length / 3) * 4);
      for (let v = 0; v < mPos.length / 3; v++) {
        for (let k = 0; k < 3; k++) {
          dpos[v * 3 + k] = fPos[v * 3 + k] - mPos[v * 3 + k];
          dnrm[v * 3 + k] = fNrm[v * 3 + k] - mNrm[v * 3 + k];
        }
        const [r, g, b] = headTint(mPos[v * 3], mPos[v * 3 + 1], mPos[v * 3 + 2]);
        const ao = headAO[v];
        colors.set([Math.round(r * ao * 245), Math.round(g * ao * 245), Math.round(b * ao * 245), 255], v * 4);
      }
      const headMd = withUVs(
        {
          positions: mPos,
          normals: mNrm,
          indices: headSimp.indices,
          colors,
          weights: headWeights,
          morphs: { frameFem: { dpos, dnrm } },
        },
        headAtlas.entries[0].triChart,
        headAtlas.entries[0].uv
      );
      const name = nose === "button" ? `Head_${face}` : `Head_${face}_${nose}`;
      addArtMesh(name, "skin_head", headMd);
    }
  }

  // Build Eyes, Iris, Pupils at the exact posed MakeHuman eye centers, with frameFem morph!
  const me = male.eyeCenter, fe = female.eyeCenter;
  const er = male.eyeRadius;
  const irisR = er * 0.72;
  const pupilR = er * 0.32;
  const eyeMorph = (pos) => {
    const dpos = new Float32Array(pos.length);
    for (let v = 0; v < pos.length / 3; v++) {
      const s = pos[v * 3] >= 0 ? 1 : -1;
      dpos[v * 3] = (fe[0] - me[0]) * s;
      dpos[v * 3 + 1] = fe[1] - me[1];
      dpos[v * 3 + 2] = fe[2] - me[2];
    }
    return { frameFem: { dpos, dnrm: new Float32Array(pos.length) } };
  };

  const eyesData = buildEyePart(me, er, (b, c, R) => {
    for (const s of [1, -1]) cap(b, [c[0] * s, c[1], c[2]], R, 1.95, 6, 24);
  });
  eyesData.morphs = eyeMorph(eyesData.positions);
  addArtMesh("Eyes", "eye_white", eyesData, boneNodes.Head);

  const irisData = buildEyePart(me, er, (b, c, R) => {
    const alpha = Math.asin(irisR / (R + 0.0003));
    for (const s of [1, -1]) {
      cap(b, [c[0] * s, c[1], c[2]], R + 0.0003, alpha, 4, 24, -s * GAZE_IN, (x, y) => {
        const k = irisShade(Math.hypot(x, y) / irisR, Math.atan2(y, x * s));
        return [k, k, k];
      });
    }
  });
  irisData.morphs = eyeMorph(irisData.positions);
  addArtMesh("Iris", "iris", irisData, boneNodes.Head);

  const pupilData = buildEyePart(me, er, (b, c, R) => {
    const alpha = Math.asin(pupilR / (R + 0.00055));
    for (const s of [1, -1]) cap(b, [c[0] * s, c[1], c[2]], R + 0.00055, alpha, 2, 16, -s * GAZE_IN);
  });
  pupilData.morphs = eyeMorph(pupilData.positions);
  addArtMesh("Pupils", "pupil", pupilData, boneNodes.Head);

  // Build Lids_* and Lashes_* centered at MakeHuman's eye center so blinks & lashes align cleanly.
  for (const shape of EYE_SHAPES) {
    const e = EYE_SHAPE[shape];
    const scaleW = er / 0.0175;
    const upper = (u) => e.top * scaleW * Math.pow(Math.max(0, 1 - (u / (e.w * scaleW)) ** 2), e.p) + e.tilt * u;
    const lashData = buildEyePart(me, er, (b, c, R) => {
      for (const s of [1, -1]) {
        const pts = [];
        const w = e.w * scaleW;
        for (let i = 0; i <= 14; i++) {
          const u = -w * 0.92 + (2 * w * 0.97 * i) / 14;
          const v = upper(u) + 0.0003;
          const rr = R + 0.0012;
          const z = c[2] + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
          const out = Math.max(0, u / w - 0.45) / 0.55;
          const flick = out * out * 0.0038 * e.lash;
          const r = (0.00075 + 0.0009 * out + 0.0003 * Math.sin((i / 14) * Math.PI)) * e.lash;
          pts.push({ c: [c[0] * s + s * (u + flick * 0.7), c[1] + v + flick * 0.6, z - flick * 0.2], rx: r, rz: r * 0.7, w: {} });
        }
        tube(b, pts, { steps: 1, radial: 4, capStart: true, capEnd: true });
      }
    });
    lashData.morphs = eyeMorph(lashData.positions);
    addArtMesh(`Lashes_${shape}`, "lash", lashData, boneNodes.Head);

    const lidData = buildEyePart(me, er, (b, c, R) => {
      const rr = R + 0.0009;
      const w = e.w * scaleW;
      for (const s of [1, -1]) {
        const rows = 4, cols = 14;
        for (let r = 0; r <= rows; r++) {
          const t = r / rows;
          for (let j = 0; j <= cols; j++) {
            const u = -w * 0.98 + (2 * w * 0.98 * j) / cols;
            const yBot = upper(u);
            const yTop = yBot + 0.0045 * Math.sqrt(Math.max(0, 1 - (u / (w * 1.05)) ** 2));
            const v = yBot + (yTop - yBot) * t;
            const z = c[2] + Math.sqrt(Math.max(0, rr * rr - u * u - v * v));
            b.vertex([c[0] * s + s * u, c[1] + v, z]);
          }
        }
        b.grid(rows + 1, cols + 1, false);
      }
    });
    lidData.morphs = eyeMorph(lidData.positions);
    addArtMesh(`Lids_${shape}`, "skin", lidData, boneNodes.Head);
  }

  await io.write(OUT_GLB, doc);
  console.log(`Wrote ${OUT_GLB} (Body: ${bodySimp.indices.length / 3} tris, Head: ${headSimp.indices.length / 3} tris, normal maps: ${(bodyNormJpeg.length / 1024).toFixed(0)} KB + ${(headNormJpeg.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

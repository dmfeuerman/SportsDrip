#!/usr/bin/env node
/**
 * Generates the bundled avatar assets on the shared `sd_rig_v3` skeleton
 * (Mixamo bone names):
 *
 *   sd_base_v3.glb        the body as one mesh per hide region (Body_<region>),
 *                         the base layer, four heads (one per face shape), eyes,
 *                         lids and lashes per eye shape, brows, teeth, sockets,
 *                         blendshapes and the idle / cheer clips
 *   hair_<style>.glb      one hairstyle: the free variant plus one pressed
 *                         variant per hat mode (fit.mjs)
 *   beard_<style>.glb     one facial-hair style, fitted to each face shape
 *   <template>.glb        one garment template (templates.mjs)
 *
 * Blendshapes (glTF morph targets, named):
 *   buildSlim / buildBroad       body, head (neck), base layer, every skinned garment
 *   noseStraight / noseBroad / lipsFull / mouthWide     heads, facial hair
 *   eyeBlinkLeft / eyeBlinkRight / mouthSmileLeft / mouthSmileRight / jawOpen
 *                                heads, lids, lashes, facial hair (ARKit names)
 *
 *   node scripts/avatar/generate.mjs                   # everything
 *   node scripts/avatar/generate.mjs --jobs 8          # in parallel (one process per asset)
 *   node scripts/avatar/generate.mjs --only top_tee,hat_cap
 *   node scripts/avatar/generate.mjs --preview         # coarser grids, for look-dev
 *
 * Then: node scripts/avatar/validate.mjs && node scripts/avatar/fitcheck.mjs
 *       && node scripts/avatar/hatfit.mjs && node scripts/avatar/registry.mjs
 *
 * When @gltf-transform/core, /extensions and /functions are installed
 * (optional dev dependencies), every file is written with
 * KHR_mesh_quantization — about half the size, decoded by GLTFLoader itself,
 * so it works on Hermes, where the Draco and Meshopt decoders (Web Workers /
 * WebAssembly) don't.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BODY_REGIONS, BONE_NAMES, BONES, BUILD_MORPHS, EXPRESSIONS, EYE_SHAPES, EYEBROWS, FACE_SHAPES, FACIAL_HAIR, HAIR_STYLES, LAYER_OFFSET, MOUTH_SHAPES, NOSE_SHAPES, REST, RIG_ID, sideBone, SOCKETS } from "./rig.mjs";
import { MeshBuilder, mix } from "./geometry.mjs";
import * as C from "./character.mjs";
import * as F from "./face.mjs";
import * as H from "./hair.mjs";
import * as X from "./expressions.mjs";
import { HAIR_MODES, hairAllowance, scalpD } from "./fit.mjs";
import { TEMPLATES } from "./templates.mjs";
import { attachmentSpecs } from "./attachments.mjs";
import { addNormalMaps, atlas, bakeNormals, withUVs } from "./bake.mjs";
import { encodeJPEG } from "./jpeg.mjs";
import { sparsifyMorphs } from "./sparse.mjs";
import { bakeAO, gradient, meshSDF, project, simplify, smax, sstep } from "./sdf.mjs";

// GLTFExporter's binary writer reads its Blob through FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type};base64,${Buffer.from(r).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.AVATAR_OUT ?? join(here, "..", "..", "assets", "avatar");
mkdirSync(OUT, { recursive: true });
export const BASE_KEY = "sd_base_v3";
const VERSION = 3;
/** Coarser grids, for quick look-dev. Triangle targets are unchanged. */
const PREVIEW = process.argv.includes("--preview");
const Q = PREVIEW ? 1.8 : 1;

/**
 * Triangle budgets (mobile): the base character as drawn is ≤ 15k (one head,
 * one lid/lash/brow set), each garment ≤ 5k, a whole avatar ≤ 30k.
 */
export const TRIS = {
  body: 7500,
  underwear: 800,
  head: 3500,
  lids: 500,
  brows: 140,
  hair: 3600,
  hairPressed: 2600,
  beard: 900,
  stubble: 700,
};

/**
 * Per-garment triangle budgets by slot (≤ 5k each), sized so the heaviest
 * preset outfit stays under 30k drawn with its hair and the visible body.
 */
export const GARMENT_TRIS = { top: 3000, outerwear: 3200, bottom: 2800, shoes: 2400, hat: 2200, eyewear: 1100, accessory: 2200 };

/** Draw order between worn layers (inner → outer); the runtime turns it into a depth bias. */
export const LAYERS = { shoes: 1, bottom: 2, top: 3, outerwear: 4, hat: 5, eyewear: 5, accessory: 5 };
/** Materials that keep their own look whatever fabric the template asks for. */
const OWN_LOOK = { metal: null, lens: null, laces: null, sole: "rubber" };

/* ── materials ───────────────────────────────────────────────────────────── */

/**
 * Default looks; the runtime re-tints skin, hair, iris and every tint-contract
 * material. Sheen and clearcoat export as KHR_materials_sheen / _clearcoat and
 * load as MeshPhysicalMaterial.
 */
const MATERIAL_LOOK = {
  skin: { color: "#e5b18c", roughness: 0.5, vertexColors: true, sheen: 0.25, sheenColor: "#ff9a7a", sheenRoughness: 0.6 },
  eye_white: { color: "#f4f1ea", roughness: 0.12 },
  iris: { color: "#3b2415", roughness: 0.1, vertexColors: true },
  pupil: { color: "#08080a", roughness: 0.1 },
  teeth: { color: "#f3efe6", roughness: 0.3 },
  brow: { color: "#2b1b12", roughness: 0.85 },
  hair: { color: "#2b1b12", roughness: 0.56, vertexColors: true, sheen: 0.35, sheenColor: "#ffffff", sheenRoughness: 0.45 },
  stubble: { color: "#6b5040", roughness: 0.9, vertexColors: true, transparent: true },
  beard: { color: "#2b1b12", roughness: 0.75, vertexColors: true, sheen: 0.4, sheenColor: "#ffffff", sheenRoughness: 0.6 },
  hair_tie: { color: "#e2564a", roughness: 0.55 },
  lash: { color: "#120c09", roughness: 0.7 },
  base_layer: { color: "#2f3a35", roughness: 0.82, vertexColors: true, sheen: 0.5, sheenRoughness: 0.8 },
  primary: { color: "#f5f5f5", roughness: 0.82, vertexColors: true },
  primary_dark: { color: "#cfcfcf", roughness: 0.86, vertexColors: true },
  secondary: { color: "#1a237e", roughness: 0.78, vertexColors: true },
  secondary_dark: { color: "#101656", roughness: 0.82, vertexColors: true },
  metal: { color: "#d8d8dc", roughness: 0.22, metalness: 1.0, vertexColors: true },
  lens: { color: "#101418", roughness: 0.05, metalness: 0.3, clearcoat: 1 },
  sole: { color: "#f2f2f2", roughness: 0.72, vertexColors: true },
  laces: { color: "#ffffff", roughness: 0.8, vertexColors: true },
};

/** Fabric presets a template part can ask for (`look` in templates.mjs). */
export const FABRIC = {
  cotton: { roughness: 0.86, sheen: 0.55, sheenRoughness: 0.75 },
  fleece: { roughness: 0.92, sheen: 0.55, sheenRoughness: 0.85 },
  mesh: { roughness: 0.62, sheen: 0.35, sheenRoughness: 0.5 },
  nylon: { roughness: 0.38, sheen: 0.3, sheenRoughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.4 },
  denim: { roughness: 0.9, sheen: 0.4, sheenRoughness: 0.9 },
  leather: { roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.35 },
  knit: { roughness: 0.95, sheen: 0.5, sheenRoughness: 0.9 },
  canvas: { roughness: 0.88, sheen: 0.3, sheenRoughness: 0.8 },
  plastic: { roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 },
  rubber: { roughness: 0.75 },
  suede: { roughness: 0.95, sheen: 0.7, sheenRoughness: 0.9 },
};

function material(name, { doubleSided = false, vertexColors = null, look = null } = {}) {
  const base = MATERIAL_LOOK[name] ?? { color: "#ff00ff", roughness: 0.8 };
  const L = { ...base, ...(typeof look === "string" ? FABRIC[look] : look ?? {}) };
  const physical = L.sheen !== undefined || L.clearcoat !== undefined;
  const m = new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
    name,
    vertexColors: vertexColors ?? !!L.vertexColors,
    color: L.color,
    roughness: L.roughness,
    metalness: L.metalness ?? 0,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: !!L.transparent,
    depthWrite: !L.transparent,
  });
  if (physical) {
    if (L.sheen) {
      m.sheen = L.sheen;
      m.sheenColor = new THREE.Color(L.sheenColor ?? "#ffffff");
      m.sheenRoughness = L.sheenRoughness ?? 0.6;
    }
    if (L.clearcoat) {
      m.clearcoat = L.clearcoat;
      m.clearcoatRoughness = L.clearcoatRoughness ?? 0.1;
    }
  }
  return m;
}

/* ── scene / rig ─────────────────────────────────────────────────────────── */

function newScene(meta) {
  const scene = new THREE.Scene();
  scene.name = meta.kind === "base" ? "sd_base" : meta.template ?? meta.part ?? "asset";
  scene.userData = { sdAvatar: { rig: RIG_ID, version: VERSION, ...meta } };
  const root = new THREE.Group();
  root.name = "Avatar";
  scene.add(root);
  const bones = {};
  for (const [name, parent, pos] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const pp = parent ? REST[parent] : [0, 0, 0];
    bone.position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]);
    bones[name] = bone;
    if (parent) bones[parent].add(bone);
  }
  root.add(bones.Hips);
  // Sockets: empty nodes under their bones, at their rest positions.
  const sockets = {};
  for (const [name, s] of Object.entries(SOCKETS)) {
    const o = new THREE.Object3D();
    o.name = `Socket_${name}`;
    const b = REST[s.bone];
    o.position.set(s.position[0] - b[0], s.position[1] - b[1], s.position[2] - b[2]);
    bones[s.bone].add(o);
    sockets[name] = o;
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map(([n]) => bones[n]));
  return { scene, root, bones, sockets, skeleton };
}

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

/**
 * A mesh in the making: positions, normals, indices, and optional per-vertex
 * colours (RGBA bytes), skin weights and morph deltas.
 */
function meshData(m) {
  return { positions: m.positions, normals: m.normals, indices: m.indices, colors: null, weights: null, morphs: {} };
}

/** The triangles passing `keep(triIndex)`, with every per-vertex array carried along. */
function subMesh(md, keep) {
  const map = new Int32Array(md.positions.length / 3).fill(-1);
  const order = [];
  const idx = [];
  for (let t = 0; t < md.indices.length; t += 3) {
    if (!keep(t / 3)) continue;
    for (let k = 0; k < 3; k++) {
      const v = md.indices[t + k];
      if (map[v] < 0) {
        map[v] = order.length;
        order.push(v);
      }
      idx.push(map[v]);
    }
  }
  const pick = (arr, n) => {
    if (!arr) return null;
    const out = new arr.constructor(order.length * n);
    order.forEach((v, i) => {
      for (let k = 0; k < n; k++) out[i * n + k] = arr[v * n + k];
    });
    return out;
  };
  const morphs = {};
  for (const [name, m] of Object.entries(md.morphs)) morphs[name] = { dpos: pick(m.dpos, 3), dnrm: pick(m.dnrm, 3) };
  return {
    positions: pick(md.positions, 3),
    normals: pick(md.normals, 3),
    indices: new Uint32Array(idx),
    colors: pick(md.colors, 4),
    weights: md.weights ? order.map((v) => md.weights[v]) : null,
    uvs: pick(md.uvs, 2),
    tangents: pick(md.tangents, 4),
    morphs,
  };
}

function toGeometry(md, origin = [0, 0, 0]) {
  const g = new THREE.BufferGeometry();
  const n = md.positions.length / 3;
  const pos = new Float32Array(md.positions.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = md.positions[i] - origin[0];
    pos[i + 1] = md.positions[i + 1] - origin[1];
    pos[i + 2] = md.positions[i + 2] - origin[2];
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(md.normals), 3));
  if (md.uvs) g.setAttribute("uv", new THREE.BufferAttribute(md.uvs, 2));
  if (md.tangents) g.setAttribute("tangent", new THREE.BufferAttribute(md.tangents, 4));
  if (md.colors) g.setAttribute("color", new THREE.BufferAttribute(md.colors, 4, true));
  if (md.weights) {
    // Joints as bytes and weights as normalised bytes (both valid glTF).
    const si = new Uint8Array(n * 4);
    const sw = new Uint8Array(n * 4);
    for (let v = 0; v < n; v++) {
      const e = Object.entries(md.weights[v]).filter(([, w]) => w > 4e-3).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = e.reduce((t, [, w]) => t + w, 0) || 1;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        si[v * 4 + k] = e[k] ? BONE_INDEX[e[k][0]] : 0;
        sw[v * 4 + k] = e[k] ? Math.round((255 * e[k][1]) / tot) : 0;
        sum += sw[v * 4 + k];
      }
      sw[v * 4] += 255 - sum;
    }
    g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4, true));
  }
  const names = Object.keys(md.morphs);
  if (names.length) {
    g.morphTargetsRelative = true;
    g.morphAttributes.position = names.map((k) => new THREE.BufferAttribute(md.morphs[k].dpos, 3));
    if (names.every((k) => md.morphs[k].dnrm)) g.morphAttributes.normal = names.map((k) => new THREE.BufferAttribute(md.morphs[k].dnrm, 3));
    g.userData.morphList = names;
  }
  g.setIndex(new THREE.BufferAttribute(n < 65536 ? new Uint16Array(md.indices) : new Uint32Array(md.indices), 1));
  return g;
}

function rgba(ao, tint = null) {
  const out = new Uint8Array(ao.length * 4);
  for (let v = 0; v < ao.length; v++) {
    const t = tint ? tint(v) : [1, 1, 1];
    out[v * 4] = Math.round(255 * Math.min(1, ao[v] * t[0]));
    out[v * 4 + 1] = Math.round(255 * Math.min(1, ao[v] * t[1]));
    out[v * 4 + 2] = Math.round(255 * Math.min(1, ao[v] * t[2]));
    out[v * 4 + 3] = 255;
  }
  return out;
}

/** Soft blend of region weight maps by distance — smooth weights across joints. */
function regionWeights(x, y, z, tau = 0.008) {
  const regs = C.bodyRegions(x, y, z);
  const dmin = Math.min(...regs.map((r) => r.d));
  let tot = 0;
  const out = {};
  for (const r of regs) {
    const k = Math.exp(-(r.d - dmin) / tau);
    if (k < 1e-4) continue;
    tot += k;
    for (const [b, w] of Object.entries(r.w)) out[b] = (out[b] ?? 0) + w * k;
  }
  for (const b of Object.keys(out)) out[b] /= tot;
  return out;
}

/** Head-skin weights: the neck's blend at the bottom, the Head bone above the jaw. */
function headWeights(x, y, z) {
  const k = sstep(1.5, 1.545, y);
  if (k >= 1) return { Head: 1 };
  return mix(regionWeights(x, y, z), { Head: 1 }, k);
}

function addMesh(ctx, name, mat, geometry, { skinned = false, parent = null, doubleSided = false, vertexColors = null, look = null } = {}) {
  const m = material(mat, { doubleSided, vertexColors: vertexColors ?? !!geometry.attributes.color, look });
  let mesh;
  if (skinned) {
    mesh = new THREE.SkinnedMesh(geometry, m);
    mesh.name = name;
    ctx.root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(ctx.skeleton, mesh.matrixWorld);
  } else {
    mesh = new THREE.Mesh(geometry, m);
    mesh.name = name;
    (parent ?? ctx.bones.Head).add(mesh);
  }
  const list = geometry.userData.morphList;
  if (list?.length) {
    mesh.morphTargetDictionary = Object.fromEntries(list.map((k, i) => [k, i]));
    mesh.morphTargetInfluences = list.map(() => 0);
  }
  return mesh;
}

/** Mesh a field; returns null when it's empty. Triangle targets hold in preview too. */
async function fieldMesh(f, box, h, { targetTris = null, keep = null, error = 0.0006, minPiece = 0 } = {}) {
  let m = await meshSDF(f, box, h * Q, { targetTris, keep, error });
  if (minPiece > 0 && m.indices.length) m = dropSpecks(m, minPiece);
  return m.indices.length ? m : null;
}

/**
 * Removes connected pieces smaller than `minTris` triangles: the slivers a thin
 * shell or a hat-pressed hair variant leaves where two surfaces nearly touch.
 */
function dropSpecks(m, minTris) {
  const nv = m.positions.length / 3;
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]);
    parent[b] = a;
    parent[c] = a;
  }
  const size = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const r = find(I[t]);
    size.set(r, (size.get(r) ?? 0) + 1);
  }
  const keepTri = [];
  for (let t = 0; t < I.length; t += 3) if (size.get(find(I[t])) >= minTris) keepTri.push(I[t], I[t + 1], I[t + 2]);
  if (keepTri.length === I.length) return m;
  // Re-index, carrying every per-vertex array along.
  const map = new Int32Array(nv).fill(-1);
  const order = [];
  const idx = new Uint32Array(keepTri.length);
  keepTri.forEach((v, i) => {
    if (map[v] < 0) {
      map[v] = order.length;
      order.push(v);
    }
    idx[i] = map[v];
  });
  const out = { ...m, indices: idx };
  for (const [k, arr] of Object.entries(m)) {
    if (k === "indices" || !ArrayBuffer.isView(arr) || arr.length % nv !== 0) continue;
    const n = arr.length / nv;
    const o = new arr.constructor(order.length * n);
    order.forEach((v, i) => {
      for (let j = 0; j < n; j++) o[i * n + j] = arr[v * n + j];
    });
    out[k] = o;
  }
  return out;
}

/* ── blendshapes ─────────────────────────────────────────────────────────── */

/** Newton-steps p onto the zero set of f. */
function projectOnto(f, p, iters = 6) {
  let [x, y, z] = p;
  for (let i = 0; i < iters; i++) {
    const d = f(x, y, z);
    if (Math.abs(d) < 2e-6) break;
    const [nx, ny, nz, g] = gradient(f, x, y, z, 0.0004);
    const s = d / Math.max(g, 0.3);
    x -= nx * s;
    y -= ny * s;
    z -= nz * s;
  }
  return [x, y, z];
}

/**
 * A blendshape from a variant of a field: every vertex (on the base field's
 * surface) is carried to the variant's surface along the field's normal.
 * `weight(p)` limits it to a region; `transfer` is for vertices that sit off
 * the base surface (clothes, facial hair): they move with the nearest base
 * surface point.
 */
function fieldMorph(md, baseF, variantF, { weight = () => 1, transfer = false, normals = true, maxMove = 0.03 } = {}) {
  const n = md.positions.length / 3;
  const dpos = new Float32Array(n * 3);
  const dnrm = normals ? new Float32Array(n * 3) : null;
  for (let v = 0; v < n; v++) {
    const p = [md.positions[v * 3], md.positions[v * 3 + 1], md.positions[v * 3 + 2]];
    const w = weight(p);
    if (w <= 0) continue;
    const p0 = transfer ? projectOnto(baseF, p) : p;
    const q = projectOnto(variantF, p0);
    const d = [q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]];
    const len = Math.hypot(...d);
    if (len > maxMove || !Number.isFinite(len)) continue;
    for (let k = 0; k < 3; k++) dpos[v * 3 + k] = d[k] * w;
    if (dnrm) {
      const a = gradient(baseF, ...p0);
      const b = gradient(variantF, ...q);
      for (let k = 0; k < 3; k++) dnrm[v * 3 + k] = (b[k] - a[k]) * w;
    }
  }
  return { dpos, dnrm };
}

/**
 * Nose blendshapes for facial hair (the heads themselves are meshed once per
 * nose shape — see buildHead). The nose variants differ from the button by up to
 * ~15 mm (a longer bridge, wider wings), too far for fieldMorph's push along
 * the normal, which folds vertices into each other or skips them. Instead
 * each vertex moves along a ray from an axis inside the nose (vertical line
 * x = 0, z = NOSE_AXIS.z, clamped to the bridge's height) to where that ray
 * crosses the variant's surface — a one-to-one map between the two noses, so
 * nothing tears. Away from the nose the fields agree and the move is zero.
 */
const NOSE_AXIS = { z: 0.088, y0: 1.596, y1: 1.646 };
const noseFalloff = ([x, y, z]) => sstep(0.052, 0.04, Math.abs(x)) * sstep(1.556, 1.568, y) * sstep(1.682, 1.668, y) * sstep(0.08, 0.092, z);
function noseRayDir(p) {
  const cy = Math.min(NOSE_AXIS.y1, Math.max(NOSE_AXIS.y0, p[1]));
  const d = [p[0], p[1] - cy, p[2] - NOSE_AXIS.z];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}
/** Where the ray p + t·dir first crosses f's zero set, nearest t = 0 (|t| ≤ reach), or 0 if it doesn't. */
function rayRoot(f, p, dir, reach) {
  const at = (t) => f(p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t);
  const f0 = at(0);
  if (Math.abs(f0) < 1e-6) return 0;
  const step = 0.0004;
  for (let t = step; t <= reach + 1e-9; t += step) {
    for (const sgnT of [1, -1]) {
      const a = sgnT * (t - step), b = sgnT * t;
      const fa = at(a), fb = at(b);
      if ((fa <= 0) !== (fb <= 0)) {
        let lo = a, hi = b, flo = fa;
        for (let i = 0; i < 24; i++) {
          const m = (lo + hi) / 2, fm = at(m);
          if ((fm <= 0) === (flo <= 0)) {
            lo = m;
            flo = fm;
          } else hi = m;
        }
        return (lo + hi) / 2;
      }
    }
  }
  return 0;
}
function noseMorph(md, baseF, variantF, { transfer = false, normals = true, reach = 0.02 } = {}) {
  const n = md.positions.length / 3;
  const dpos = new Float32Array(n * 3);
  const dnrm = normals ? new Float32Array(n * 3) : null;
  for (let v = 0; v < n; v++) {
    const p = [md.positions[v * 3], md.positions[v * 3 + 1], md.positions[v * 3 + 2]];
    const w = noseFalloff(p);
    if (w <= 0) continue;
    const p0 = transfer ? projectOnto(baseF, p) : p;
    const dir = noseRayDir(p0);
    const t = rayRoot(variantF, p0, dir, reach);
    if (!t) continue;
    for (let k = 0; k < 3; k++) dpos[v * 3 + k] = dir[k] * t * w;
    if (dnrm) {
      const q = [p0[0] + dir[0] * t, p0[1] + dir[1] * t, p0[2] + dir[2] * t];
      const a = gradient(baseF, ...p0);
      const b = gradient(variantF, ...q);
      for (let k = 0; k < 3; k++) dnrm[v * 3 + k] = (b[k] - a[k]) * w;
    }
  }
  return { dpos, dnrm };
}
/** A blendshape from an analytic displacement (expressions.mjs). */
function fnMorph(md, fn) {
  const n = md.positions.length / 3;
  const dpos = new Float32Array(n * 3);
  const dnrm = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const p = [md.positions[v * 3], md.positions[v * 3 + 1], md.positions[v * 3 + 2]];
    const r = fn(p);
    dpos[v * 3] = r.d[0];
    dpos[v * 3 + 1] = r.d[1];
    dpos[v * 3 + 2] = r.d[2];
    if (r.r) {
      const nn = [md.normals[v * 3], md.normals[v * 3 + 1], md.normals[v * 3 + 2]];
      const q = X.rotX(nn, r.r[1]);
      for (let k = 0; k < 3; k++) dnrm[v * 3 + k] = q[k] - nn[k];
    }
  }
  return { dpos, dnrm };
}

/** A field evaluated at another body build (character.setBuild), restoring the base after. */
const atBuild = (b, f) => (x, y, z) => {
  C.setBuild(b);
  try {
    return f(x, y, z);
  } finally {
    C.setBuild(0);
  }
};
const atFace = (detail, f) => (x, y, z) => {
  C.setFaceDetail(detail);
  try {
    return f(x, y, z);
  } finally {
    C.setFaceDetail({});
  }
};

const BUILD_VALUES = { buildSlim: -1, buildBroad: 1 };
const bodyField = (x, y, z) => C.bodyD(x, y, z);

function addBuildMorphs(md, { transfer = false, weight = () => 1 } = {}) {
  for (const name of BUILD_MORPHS) {
    md.morphs[name] = fieldMorph(md, bodyField, atBuild(BUILD_VALUES[name], bodyField), { transfer, weight, maxMove: 0.04 });
  }
}

/* ── animation ───────────────────────────────────────────────────────────── */

function qTrack(bone, times, eulers) {
  const values = [];
  for (const e of eulers) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function sampled(duration, fps, f) {
  const times = [];
  const vals = [];
  const n = Math.round(duration * fps);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * duration;
    times.push(t);
    vals.push(f(t / duration));
  }
  return [times, vals];
}

/**
 * Relaxed idle (8 s loop): arms down by the sides with soft elbows, breathing
 * through the ribs, a slow weight shift from one leg to the other with the
 * free knee easing, and the head looking around a little.
 */
function idleClip() {
  const TAU = Math.PI * 2;
  const dur = 8;
  const tracks = [];
  const add = (bone, f) => {
    const [t, v] = sampled(dur, 12, f);
    tracks.push(qTrack(bone, t, v));
  };
  const breathe = (u) => Math.sin(u * TAU * 2); // two breaths per loop
  const shift = (u) => Math.sin(u * TAU); // one weight shift per loop: + = onto the left leg
  const tilt = (u) => 0.028 * shift(u);
  const [ht, hv] = sampled(dur, 12, (u) => [0.012 * shift(u), REST.Hips[1] - 0.006 * Math.abs(shift(u)) - 0.001 * (1 + breathe(u)), 0.003 * Math.sin(u * TAU * 2 + 1)]);
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", ht, hv.flat()));
  add("Hips", (u) => [0.01, 0.03 * Math.sin(u * TAU + 0.6), tilt(u)]);
  add("Spine", (u) => [-0.006 * breathe(u), -0.012 * Math.sin(u * TAU + 0.6), -tilt(u) * 0.45]);
  add("Spine1", (u) => [-0.01 * breathe(u), 0, -tilt(u) * 0.3]);
  add("Spine2", (u) => [-0.016 * breathe(u), -0.01 * Math.sin(u * TAU + 0.6), -tilt(u) * 0.25]);
  add("Neck", (u) => [0.012 * breathe(u), 0, 0]);
  add("Head", (u) => [0.03 + 0.012 * Math.sin(u * TAU * 1.5 + 2), 0.09 * Math.sin(u * TAU + 1.4), 0.025 * Math.sin(u * TAU * 0.5 + 0.3) - tilt(u) * 0.2]);
  for (const s of ["L", "R"]) {
    const g = s === "L" ? 1 : -1;
    const standing = (u) => Math.max(0, g * shift(u)); // 1 when this leg carries the weight
    add(sideBone("Shoulder", s), (u) => [0, 0, g * 0.012 * breathe(u)]);
    add(sideBone("Arm", s), (u) => [0.05 + 0.02 * Math.sin(u * TAU + g), 0.04 * g, -g * (0.2 + 0.015 * breathe(u))]);
    add(sideBone("ForeArm", s), (u) => [-0.22 - 0.03 * Math.sin(u * TAU + 0.5 * g), 0, g * 0.04]);
    add(sideBone("Hand", s), () => [0, -g * 0.15, g * 0.06]);
    // Counter the hip tilt at the thigh; the free leg bends a little at the knee.
    add(sideBone("UpLeg", s), (u) => [-0.05 * (1 - standing(u)), 0, -tilt(u) - g * 0.012 * shift(u)]);
    add(sideBone("Leg", s), (u) => [0.1 * (1 - standing(u)) + 0.02, 0, 0]);
    add(sideBone("Foot", s), (u) => [-0.05 * (1 - standing(u)) - 0.02, 0, tilt(u) * 0.5]);
  }
  return new THREE.AnimationClip("idle", dur, tracks);
}

function cheerClip() {
  const cd = 1.8;
  const tracks = [];
  const ease = (u, a, b) => {
    const x = Math.min(1, Math.max(0, (u - a) / (b - a)));
    return x * x * (3 - 2 * x);
  };
  const up = (u) => ease(u, 0.05, 0.25) * (1 - ease(u, 0.75, 0.97));
  const add = (bone, f) => {
    const [t, v] = sampled(cd, 24, f);
    tracks.push(qTrack(bone, t, v));
  };
  for (const s of ["L", "R"]) {
    const g = s === "L" ? 1 : -1;
    add(sideBone("Arm", s), (u) => [0, 0, g * (2.3 * up(u) + 0.05 * Math.sin(u * 40 + (g < 0 ? 1 : 0)) * up(u))]);
    add(sideBone("Shoulder", s), (u) => [0, 0, g * 0.25 * up(u)]);
    add(sideBone("ForeArm", s), (u) => [0, 0, g * 0.35 * up(u)]);
  }
  add("Head", (u) => [-0.16 * up(u), 0, 0]);
  add("Spine2", (u) => [-0.06 * up(u), 0, 0]);
  const [ht, hv] = sampled(cd, 24, (u) => [0, 0.04 * Math.max(0, Math.sin(u * Math.PI * 4)) * up(u), 0]);
  const hipY = REST.Hips[1];
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", ht, hv.map((v) => [v[0], hipY + v[1], v[2]]).flat()));
  return new THREE.AnimationClip("cheer", cd, tracks);
}

/* ── export ──────────────────────────────────────────────────────────────── */

let quantizer;
/** Optional: KHR_mesh_quantization through glTF-Transform, when it's installed. */
async function quantize(glb) {
  if (process.env.AVATAR_NO_QUANTIZE) return glb;
  if (quantizer === undefined) {
    try {
      const [{ NodeIO }, { ALL_EXTENSIONS }, { quantize: q }] = await Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions"), import("@gltf-transform/functions")]);
      quantizer = { io: new NodeIO().registerExtensions(ALL_EXTENSIONS), q };
    } catch {
      quantizer = null;
      console.log("  (glTF-Transform isn't installed: writing unquantized GLBs)");
    }
  }
  if (!quantizer) return glb;
  const doc = await quantizer.io.readBinary(new Uint8Array(glb));
  await doc.transform(
    quantizer.q({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
      quantizeWeight: 8,
      quantizeGeneric: 12,
      normalizeWeights: true,
      // One grid for every mesh in the file: the body's region meshes share their border vertices,
      // and per-mesh grids would round those differently and open pixel cracks along the seams.
      quantizationVolume: "scene",
    })
    // Not glTF-Transform's sparse(): it writes sparse *normalized* (quantized) accessors with
    // their values zeroed, which silently flattened nearly every face and build blendshape
    // (nose, mouth, smile, jaw, blinks, slim/broad). sparse.mjs re-encodes them correctly.
  );
  return sparsifyMorphs(Buffer.from(await quantizer.io.writeBinary(doc)));
}

async function write(scene, file, anims = [], maps = []) {
  const exporter = new GLTFExporter();
  let raw = Buffer.from(await exporter.parseAsync(scene, { binary: true, animations: anims, onlyVisible: false }));
  if (maps.length) raw = addNormalMaps(raw, maps);
  const glb = await quantize(raw);
  writeFileSync(join(OUT, file), glb);
  let tris = 0;
  const per = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      tris += o.geometry.index.count / 3;
      per.push(`${o.name}:${o.geometry.index.count / 3}`);
    }
  });
  if (process.env.AVATAR_VERBOSE) console.log("   ", per.join(" "));
  console.log(`${file.padEnd(28)} ${(glb.byteLength / 1024).toFixed(0).padStart(5)} KB  ${String(tris).padStart(6)} tris`);
}

/* ── normal maps ─────────────────────────────────────────────────────────── */

/** Normal-map sizes (≤ 1024; 512 for small items); a quarter in preview. */
export const TEX = { body: 1024, heads: 1024, hair: 1024, beard: 512, top: 1024, outerwear: 1024, bottom: 1024, shoes: 512, hat: 512, eyewear: 256, accessory: 512 };
const texSize = (k) => (PREVIEW && !process.env.AVATAR_FULL_TEX ? Math.max(128, TEX[k] / 4) : TEX[k]);

/** A 2×2 box-filtered copy of a square RGBA image. */
function halfSize(img, size) {
  const h = size >> 1;
  const out = new Uint8Array(h * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < h; x++)
      for (let c = 0; c < 4; c++) {
        const i = ((y * 2) * size + x * 2) * 4 + c;
        out[(y * h + x) * 4 + c] = (img[i] + img[i + 4] + img[i + size * 4] + img[i + size * 4 + 4] + 2) >> 2;
      }
  return out;
}

/**
 * Lays out the given meshes in one atlas and bakes their fields into a
 * normal map: returns the meshes with UVs (same order) and the image (JPEG).
 * items: [{ md, field, detail? }].
 */
function bakeSet(items, size, { quality = 92 } = {}) {
  const t0 = Date.now();
  const lay = atlas(items.map((it) => ({ P: it.md.positions, I: it.md.indices, weight: it.weight })), size);
  const mds = items.map((it, i) => withUVs(it.md, lay.entries[i].triChart, lay.entries[i].uv));
  const img = bakeNormals(mds.map((md, i) => ({ md, field: items[i].field, detail: items[i].detail, flow: items[i].flow })), size);
  const png = encodeJPEG(img.normal, size, size, quality);
  // Strand flow changes slowly across the scalp: half resolution holds it.
  const aniso = img.aniso ? encodeJPEG(halfSize(img.aniso, size), size >> 1, size >> 1, 85) : null;
  if (process.env.AVATAR_VERBOSE) console.log(`    bake ${size}²: ${(lay.density / 1000).toFixed(2)} texels/mm, ${(png.length / 1024).toFixed(0)} KB${aniso ? ` + ${(aniso.length / 1024).toFixed(0)} KB anisotropy` : ""}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { mds, png, aniso };
}

/* ── base ────────────────────────────────────────────────────────────────── */

/** The neck column inside the head: the body stops here and the head skin takes over. */
const NECK_CUT = C.NECK_CUT;
const inNeckColumn = (x, y, z) => y > NECK_CUT && Math.abs(x) < 0.1 && z > -0.13 && z < 0.12;

/** The head skin merged into the top of the neck (smooth under the jaw), for one face shape. */
const headSkin = (face) => (x, y, z) => C.headSkinD(face, x, y, z);

async function buildBody() {
  const t0 = Date.now();
  const m = await fieldMesh(bodyField, [[-0.5, -0.004, -0.17], [0.5, 1.62, 0.22]], 0.0021, {
    targetTris: TRIS.body,
    keep: (x, y, z) => !inNeckColumn(x, y, z),
    error: 0.004,
  });
  const md = meshData(m);
  const n = m.positions.length / 3;
  const P = m.positions;
  md.weights = Array.from({ length: n }, (_, v) => regionWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  const both = (x, y, z) => Math.min(C.bodyD(x, y, z), y > 1.47 ? C.headD("oval", x, y, z) : 1);
  const ao = bakeAO(both, m, { step: 0.007, strength: 1.2 });
  md.colors = rgba(ao, (v) => C.bodyTint(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  addBuildMorphs(md);
  // The hide region of every triangle (the body ships as one mesh per region).
  const region = new Array(m.indices.length / 3);
  for (let t = 0; t < region.length; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    region[t] = C.regionOf((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
  }
  console.log(`  body: ${m.indices.length / 3} tris, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { md, region };
}

/** The body split by hide region (triangle order — and so `region` — survives withUVs). */
function bodyRegions(md, region) {
  const parts = {};
  for (const r of BODY_REGIONS) {
    const sm = subMesh(md, (t) => region[t] === r);
    if (sm.indices.length) parts[r] = sm;
  }
  return parts;
}

/** A plain base layer so the body is never shown bare below the waist (hidden under any bottoms). */
const underwearField = (() => {
  const legPast = (t1, x, y, z) => {
    for (const s of ["L", "R"]) {
      const p = C.limbParam("leg", s, x, y, z);
      if (p.t > 0.08 && (s === "L" ? x > -0.02 : x < 0.02)) return (p.t - t1) * 0.9;
    }
    return -1;
  };
  return (x, y, z) => {
    const r = Math.max(y - 0.99, legPast(0.2, x, y, z));
    if (r > 0.03) return r;
    return Math.max(C.bodyD(x, y, z) - LAYER_OFFSET.base, r);
  };
})();

async function buildUnderwear() {
  const f = underwearField;
  const m = await fieldMesh(f, [[-0.22, 0.7, -0.17], [0.22, 1.02, 0.17]], 0.0024, { targetTris: TRIS.underwear, keep: (x, y, z) => C.bodyD(x, y, z) > -0.0015, error: 0.0015 });
  const md = meshData(m);
  const P = m.positions;
  md.weights = Array.from({ length: P.length / 3 }, (_, v) => regionWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  md.colors = rgba(bakeAO((x, y, z) => Math.min(f(x, y, z), C.bodyD(x, y, z)), m, { step: 0.006, strength: 0.9 }));
  addBuildMorphs(md, { transfer: true });
  return md;
}

const NOSE_MORPHS = { noseStraight: { nose: "straight" }, noseBroad: { nose: "broad" } };
const MOUTH_MORPHS = { lipsFull: { mouth: "full" }, mouthWide: { mouth: "wide" } };
const FACE_MORPHS = { ...NOSE_MORPHS, ...MOUTH_MORPHS };
const mouthBox = ([x, y, z]) => (Math.abs(x) < 0.05 && y > 1.52 && y < 1.6 && z > 0.06 ? 1 : 0);

/**
 * One head per face shape × nose shape. Noses used to be blendshapes on the
 * button head, but a straight or broad nose is up to 15 mm bigger than the
 * button: the button's few nose triangles, its baked normal map and shading
 * stretched over it tore and folded. Meshing each nose gives it its own
 * triangles, normals and normal map; only one head is ever drawn.
 */
export const headName = (face, nose = "button") => (nose === "button" ? `Head_${face}` : `Head_${face}_${nose}`);

async function buildHead(face, nose = "button") {
  const t0 = Date.now();
  const f = atFace({ nose }, headSkin(face));
  const m = await fieldMesh(f, [[-0.15, 1.472, -0.15], [0.15, 1.81, 0.165]], 0.00095, {
    targetTris: TRIS.head,
    keep: (x, y, z) => y > 1.476,
    error: 0.0025,
  });
  const md = meshData(m);
  const P = m.positions;
  const n = P.length / 3;
  const ao = bakeAO((x, y, z) => Math.min(f(x, y, z), y < 1.6 ? C.bodyD(x, y, z) : 1), m, { step: 0.005, strength: 0.7, min: 0.62 });
  md.colors = rgba(ao, (v) => C.headTint(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  md.weights = Array.from({ length: n }, (_, v) => headWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  // The neck at the bottom follows the body build.
  for (const name of BUILD_MORPHS) {
    md.morphs[name] = fieldMorph(md, f, atBuild(BUILD_VALUES[name], f), { weight: ([, y]) => sstep(1.58, 1.53, y), maxMove: 0.03 });
  }
  for (const [name, detail] of Object.entries(MOUTH_MORPHS)) {
    md.morphs[name] = fieldMorph(md, f, atFace({ nose, ...detail }, headSkin(face)), { weight: mouthBox, maxMove: 0.012 });
  }
  // Lids blink on their own meshes; the head carries the mouth and jaw.
  for (const name of EXPRESSIONS) if (!name.startsWith("eyeBlink")) md.morphs[name] = fnMorph(md, X.EXPRESSION_FNS[name]);
  console.log(`  head ${face}/${nose}: ${m.indices.length / 3} tris, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return md;
}

function builtData(build) {
  const b = new MeshBuilder();
  build(b);
  if (!b.idx.length) return null;
  const g = b.toGeometry({ skinned: false });
  return {
    positions: g.attributes.position.array,
    normals: g.attributes.normal.array,
    indices: g.index.array,
    colors: g.attributes.color ? g.attributes.color.array : null,
    weights: null,
    morphs: {},
  };
}

async function base() {
  const ctx = newScene({
    kind: "base",
    faces: FACE_SHAPES,
    eyes: EYE_SHAPES,
    eyebrows: EYEBROWS,
    noses: NOSE_SHAPES,
    mouths: MOUTH_SHAPES,
    regions: BODY_REGIONS,
    sockets: Object.keys(SOCKETS),
    morphs: { build: BUILD_MORPHS, face: Object.keys(MOUTH_MORPHS), facialHair: Object.keys(FACE_MORPHS), expressions: EXPRESSIONS },
  });
  const maps = [];
  {
    // Body and base layer share one normal map.
    const body = await buildBody();
    const { mds, png } = bakeSet([{ md: body.md, field: bodyField }, { md: await buildUnderwear(), field: underwearField }], texSize("body"));
    const names = [];
    for (const [region, md] of Object.entries(bodyRegions(mds[0], body.region))) {
      addMesh(ctx, `Body_${region}`, "skin", toGeometry(md), { skinned: true });
      names.push(`Body_${region}`);
    }
    addMesh(ctx, "Underwear", "base_layer", toGeometry(mds[1]), { skinned: true });
    maps.push({ png, meshes: [...names, "Underwear"] });
  }
  for (const nose of NOSE_SHAPES) {
    // The four face shapes with one nose share a normal map.
    const heads = [];
    for (const face of FACE_SHAPES) heads.push({ md: await headMesh(face, nose), field: atFace({ nose }, headSkin(face)) });
    const { mds, png } = bakeSet(heads, texSize("heads"));
    FACE_SHAPES.forEach((face, i) => addMesh(ctx, headName(face, nose), "skin", toGeometry(mds[i]), { skinned: true }));
    maps.push({ png, meshes: FACE_SHAPES.map((f) => headName(f, nose)) });
  }

  const head = REST.Head;
  addMesh(ctx, "Eyes", "eye_white", toGeometry(builtData((b) => F.eyeballs(b)), head));
  addMesh(ctx, "Iris", "iris", toGeometry(builtData((b) => F.irises(b)), head));
  addMesh(ctx, "Pupils", "pupil", toGeometry(builtData((b) => F.pupils(b)), head));
  {
    const m = await fieldMesh(F.teethD, F.TEETH_BOX, 0.0005, { targetTris: 200, error: 0.0006 });
    addMesh(ctx, "Teeth", "teeth", toGeometry(meshData(m), head));
  }
  for (const shape of EYE_SHAPES) {
    // Lids: both eyes in one mesh, with the skin's AO so the crease reads, and a blink per eye.
    const parts = [];
    for (const s of [1, -1]) {
      const f = (x, y, z) => F.lidD(shape, s, x, y, z);
      const m = await fieldMesh(f, F.lidBox(s), 0.00045, { targetTris: TRIS.lids / 2, error: 0.0009 });
      if (!m) continue;
      const ao = bakeAO((x, y, z) => Math.min(f(x, y, z), C.headD("oval", x, y, z)), m, { step: 0.0025, strength: 0.6, min: 0.72 });
      parts.push({ m, ao });
    }
    const md = meshData(mergeMeshes(parts.map((p) => p.m)));
    md.colors = rgba(new Float32Array(parts.flatMap((p) => [...p.ao])));
    md.morphs.eyeBlinkLeft = fnMorph(md, (p) => X.eyeBlink(shape, "L", p));
    md.morphs.eyeBlinkRight = fnMorph(md, (p) => X.eyeBlink(shape, "R", p));
    addMesh(ctx, `Lids_${shape}`, "skin", toGeometry(md, head));
    const lash = builtData((b) => F.lashes(b, shape));
    lash.morphs.eyeBlinkLeft = fnMorph(lash, (p) => X.eyeBlink(shape, "L", p, { lashes: true }));
    lash.morphs.eyeBlinkRight = fnMorph(lash, (p) => X.eyeBlink(shape, "R", p, { lashes: true }));
    addMesh(ctx, `Lashes_${shape}`, "lash", toGeometry(lash, head));
  }
  for (const style of EYEBROWS) {
    if (style === "none") continue;
    const f = (x, y, z) => F.browD(style, x, y, z);
    const m = await fieldMesh(f, F.browBox(), 0.0005, { targetTris: TRIS.brows, error: 0.0009 });
    addMesh(ctx, `Brows_${style}`, "brow", toGeometry(meshData(m), head));
  }
  await write(ctx.scene, `${BASE_KEY}.glb`, [idleClip(), cheerClip()], maps);
}

function mergeMeshes(list) {
  let nv = 0;
  for (const m of list) nv += m.positions.length / 3;
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const indices = [];
  let o = 0;
  for (const m of list) {
    positions.set(m.positions, o * 3);
    normals.set(m.normals, o * 3);
    for (const i of m.indices) indices.push(i + o);
    o += m.positions.length / 3;
  }
  return { positions, normals, indices: new Uint32Array(indices) };
}

/* ── hair ────────────────────────────────────────────────────────────────── */

async function hairAsset(style) {
  const ctx = newScene({ kind: "hair", part: `hair_${style}`, style, modes: HAIR_MODES });
  const f = H.HAIR[style];
  const box = H.HAIR_BOX[style] ?? H.HAIR_BOX.default;
  // The part of the field inside the skull is buried; drop it.
  const keep = (x, y, z) => scalpD(x, y, z) > -0.004 && C.headD("oval", x, y, z) > -0.003;
  const variants = [];
  for (const mode of [null, ...HAIR_MODES]) {
    // A soft intersection with the hat's allowance: a hard one left razor-thin
    // slivers where a big style (afro, curls) grazes it below the brim.
    // Headphones (banded) only press a strap's width: the free shape stays.
    const under = (mode !== "banded" && H.HAIR_UNDER_HAT[style]) || f;
    const g = !mode ? f : style === "ponytail" ? (x, y, z) => H.ponytailPressedD(mode, x, y, z) : (x, y, z) => smax(under(x, y, z), hairAllowance(mode, x, y, z), 0.004);
    const t0 = Date.now();
    const m = await fieldMesh(g, box, 0.0013, { targetTris: mode ? TRIS.hairPressed : TRIS.hair, keep, error: 0.004, minPiece: 30 });
    if (!m) continue;
    const md = meshData(m);
    const ao = bakeAO((x, y, z) => Math.min(g(x, y, z), C.headD("oval", x, y, z)), m, { step: 0.004, strength: 0.9, min: 0.5 });
    // Roots a touch darker than the tips.
    const P = m.positions;
    md.colors = rgba(ao, (v) => {
      const k = 0.88 + 0.12 * sstep(-0.001, 0.014, scalpD(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
      return [k, k, k];
    });
    variants.push({ name: mode ? `Hair_${mode}` : "Hair", md, field: g, detail: H.HAIR_DETAIL[style], flow: H.HAIR_FLOW[style], weight: mode ? 0.6 : 1 });
    console.log(`  hair ${style}${mode ? `/${mode}` : ""}: ${m.indices.length / 3} tris, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  // One atlas for every variant (the pressed ones at lower density: mostly under a hat).
  // Hair detail is fine noise: a lower JPEG quality costs nothing visible and keeps the file near 1 MB.
  const { mds, png, aniso } = bakeSet(variants, texSize("hair"), { quality: 85 });
  variants.forEach((v, i) => addMesh(ctx, v.name, "hair", toGeometry(mds[i], REST.Head)));
  if (style === "ponytail") {
    for (const mode of [null, ...HAIR_MODES]) {
      const g = (x, y, z) => H.ponytailTieD(x, y, z, mode);
      const m = await fieldMesh(g, [[-0.04, 1.54, -0.17], [0.04, 1.71, -0.08]], 0.0009, { targetTris: 240, error: 0.0008 });
      if (m) addMesh(ctx, mode ? `HairTie_${mode}` : "HairTie", "hair_tie", toGeometry(meshData(m), REST.Head));
    }
  }
  await write(ctx.scene, `hair_${style}.glb`, [], [{ png, aniso: aniso && { png: aniso, strength: 0.5 }, meshes: variants.map((v) => v.name) }]);
}

/* ── facial hair ─────────────────────────────────────────────────────────── */

const headCache = new Map();
const headMesh = async (face, nose = "button") => {
  const key = `${face}/${nose}`;
  if (!headCache.has(key)) headCache.set(key, await buildHead(face, nose));
  return headCache.get(key);
};

/**
 * Stubble: not geometry worth meshing (it's ~0.5 mm), but a shadow on the
 * skin. The head's own triangles in the beard area, lifted 0.6 mm, in a
 * translucent material whose alpha fades out toward the edge of the area.
 * Same vertices as the head, so it carries the head's face and expression
 * blendshapes exactly.
 */
async function stubbleMesh(face, style = "stubble", { grow = 0, fade = 0.009, alpha = 0.85, inner = -Infinity } = {}) {
  const head = await headMesh(face);
  const P = head.positions;
  const raw = (i) => H.beardRegion(style, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const region = (i) => raw(i) - grow;
  // `inner`: drop skin deeper inside the region than this (under a full beard, where nothing shows).
  const sm = subMesh(head, (t) => {
    const [a, b, c] = [head.indices[t * 3], head.indices[t * 3 + 1], head.indices[t * 3 + 2]];
    return Math.min(region(a), region(b), region(c)) < -0.0005 && Math.max(raw(a), raw(b), raw(c)) > inner && P[a * 3 + 1] > NECK_CUT - 0.004;
  });
  const n = sm.positions.length / 3;
  const colors = new Uint8Array(n * 4);
  // Carry the head's own baked shading (AO and skin tint): with plain white the
  // shell read as a lighter, flat patch over the cheeks instead of a shadow.
  const shade = sm.colors;
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) sm.positions[v * 3 + k] += sm.normals[v * 3 + k] * 0.0006;
    const r = H.beardRegion(style, sm.positions[v * 3], sm.positions[v * 3 + 1], sm.positions[v * 3 + 2]) - grow;
    const rgb = shade ? [shade[v * 4], shade[v * 4 + 1], shade[v * 4 + 2]] : [255, 255, 255];
    colors.set([...rgb, Math.round(255 * alpha * sstep(0, -fade, r) * sstep(NECK_CUT - 0.004, NECK_CUT + 0.006, sm.positions[v * 3 + 1]))], v * 4);
  }
  sm.colors = colors;
  sm.weights = null;
  for (const k of BUILD_MORPHS) delete sm.morphs[k];
  // The heads mesh each nose separately; the shell follows the chosen nose like the beards do.
  const hs = headSkin(face);
  for (const [name, detail] of Object.entries(NOSE_MORPHS)) sm.morphs[name] = noseMorph(sm, hs, atFace(detail, hs), { transfer: true, normals: false });
  return sm;
}

async function beardAsset(style) {
  const ctx = newScene({ kind: "facialHair", part: `beard_${style}`, style, faces: FACE_SHAPES });
  const baked = [];
  for (const face of FACE_SHAPES) {
    if (style === "stubble") {
      const geo = toGeometry(await stubbleMesh(face), REST.Head);
      addMesh(ctx, `Beard_${face}`, "stubble", geo);
      continue;
    }
    const f = (x, y, z) => H.beardD(style, face, x, y, z);
    const m = await fieldMesh(f, H.BEARD_BOX, 0.0013, {
      targetTris: TRIS.beard,
      // Only the outer surface: the shell's inner side lies just under the skin.
      keep: (x, y, z) => Math.min(C.headD(face, x, y, z), y < 1.53 ? C.bodyD(x, y, z) : 1) > 0.00005,
      error: 0.0022, // clumps live in the normal map; the shell keeps the silhouette and the taper
      minPiece: 40,
    });
    if (!m) continue;
    const md = meshData(m);
    md.colors = rgba(bakeAO((x, y, z) => Math.min(f(x, y, z), C.headD(face, x, y, z)), m, { step: 0.003, strength: 0.6, min: 0.65 }));
    // Facial hair moves with the face: shape options carried from the head surface, expressions sampled directly.
    const hs = headSkin(face);
    for (const [name, detail] of Object.entries(NOSE_MORPHS)) md.morphs[name] = noseMorph(md, hs, atFace(detail, hs), { transfer: true, normals: false });
    for (const [name, detail] of Object.entries(MOUTH_MORPHS)) {
      md.morphs[name] = fieldMorph(md, hs, atFace(detail, hs), { transfer: true, weight: mouthBox, maxMove: 0.012, normals: false });
    }
    for (const name of EXPRESSIONS) if (!name.startsWith("eyeBlink")) md.morphs[name] = fnMorph(md, X.EXPRESSION_FNS[name]);
    for (const k of Object.keys(md.morphs)) md.morphs[k].dnrm = null;
    baked.push({ name: `Beard_${face}`, md, field: f, detail: H.beardDetail });
    // Round a goatee's short edge, a shadow of growth just past it, so it grows out of the skin instead
    // of ending on it (a full beard's own taper does that job, and the ring would push the fullest
    // look past the 30k-triangle budget).
    if (style !== "beard") addMesh(ctx, `BeardShadow_${face}`, "stubble", toGeometry(await stubbleMesh(face, style, { grow: 0.007, fade: 0.008, alpha: 0.7, inner: -0.0015 }), REST.Head));
  }
  const maps = [];
  if (baked.length) {
    const { mds, png } = bakeSet(baked, texSize("beard"));
    baked.forEach((b, i) => addMesh(ctx, b.name, "beard", toGeometry(mds[i], REST.Head)));
    maps.push({ png, meshes: baked.map((b) => b.name) });
  }
  await write(ctx.scene, `beard_${style}.glb`, [], maps);
}

/* ── garments ────────────────────────────────────────────────────────────── */

let SPECS = null;

function area(m) {
  const P = m.positions;
  let a = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = m.indices[t] * 3, j = m.indices[t + 1] * 3, k = m.indices[t + 2] * 3;
    const u = [P[j] - P[i], P[j + 1] - P[i + 1], P[j + 2] - P[i + 2]];
    const v = [P[k] - P[i], P[k + 1] - P[i + 1], P[k + 2] - P[i + 2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
}

/**
 * Takes a meshed part down toward `target` triangles, back onto its field.
 * `error` caps how far the surface may move: under the gap between stacked
 * layers (a band 2–3 mm over the cloth beneath), or they'd cut into each other.
 */
async function reduce(m, f, target, error = 0.0012) {
  let r = await simplify(m, target, { error });
  if (r.indices.length / 3 > target * 1.05) r = await simplify(r, target, { error, lockBorder: false });
  project(f, r.positions, 2);
  const normals = new Float32Array(r.positions.length);
  for (let i = 0; i < r.positions.length; i += 3) normals.set(gradient(f, r.positions[i], r.positions[i + 1], r.positions[i + 2]).slice(0, 3), i);
  return { ...r, normals };
}

async function garment(key, t) {
  SPECS ??= attachmentSpecs();
  const attach = t.socket ? SPECS[key] : null;
  const ctx = newScene({
    kind: "garment",
    template: key,
    slot: t.slot,
    hairMode: t.hairMode ?? null,
    excludes: t.excludes ?? [],
    hides: t.hides ?? [],
    layer: t.layer ?? LAYERS[t.slot],
    ...(attach ? { attach } : {}),
  });
  const socket = t.socket ? SOCKETS[t.socket] : null;
  const parent = socket ? ctx.sockets[t.socket] : null;
  const origin = socket ? socket.position : [0, 0, 0];
  const lookOf = (p) => p.look ?? (p.material in OWN_LOOK ? OWN_LOOK[p.material] : t.look ?? null);

  // Mesh every part, then share the garment's triangle budget between them.
  const parts = [];
  for (const p of t.parts) {
    if (p.kind === "built") {
      const b = new MeshBuilder();
      p.build(b);
      if (b.idx.length) parts.push({ p, b, tris: b.idx.length / 3 });
      continue;
    }
    const keep = p.keep ?? (p.kind === "skinned" ? (x, y, z) => C.bodyD(x, y, z) > -0.0015 : null);
    const m = await fieldMesh(p.field, p.box, p.h, { targetTris: p.tris, keep, error: p.error });
    if (!m) {
      console.warn(`  ${key}/${p.material}: empty`);
      continue;
    }
    parts.push({ p, m, tris: m.indices.length / 3 });
  }
  const total = parts.reduce((n, x) => n + x.tris, 0);
  const budget = t.tris ?? GARMENT_TRIS[t.slot] ?? 4000;
  if (total > budget) {
    // Share by surface area (a little in favour of small parts, which need a minimum to hold their shape)…
    const fixed = parts.filter((x) => x.b).reduce((n, x) => n + x.tris, 0);
    const flex = parts.filter((x) => x.m);
    for (const x of flex) x.w = area(x.m) ** 0.8;
    const W = flex.reduce((n, x) => n + x.w, 0);
    for (const x of flex) {
      const target = Math.min(x.tris, Math.max(60, Math.floor(((budget - fixed) * x.w) / W)));
      if (target < x.tris) x.m = await reduce(x.m, x.p.field, target);
      x.tris = x.m.indices.length / 3;
    }
    // …then, where thin layers held some parts above their share, take the rest from the big smooth ones,
    // allowing a little more error each round until the garment fits its slot's budget.
    let over = parts.reduce((n, x) => n + x.tris, 0) - budget;
    for (const err of [0.002, 0.003, 0.0045]) {
      for (const x of [...flex].sort((a, b) => b.tris - a.tris)) {
        if (over <= 0) break;
        x.m = await reduce(x.m, x.p.field, Math.max(60, x.tris - over), err);
        over -= x.tris - x.m.indices.length / 3;
        x.tris = x.m.indices.length / 3;
      }
      if (over <= 0) break;
    }
  }

  let i = 0;
  const baked = [];
  for (const { p, b, m } of parts) {
    const name = `${key}_${i++}_${p.material}`;
    const look = lookOf(p);
    if (b) {
      if (p.skinned) {
        const g = b.toGeometry({ skinned: true });
        const md = { positions: g.attributes.position.array, normals: g.attributes.normal.array, indices: g.index.array, colors: null, weights: null, morphs: {} };
        addBuildMorphs(md, { transfer: true });
        g.morphTargetsRelative = true;
        g.morphAttributes.position = BUILD_MORPHS.map((k) => new THREE.BufferAttribute(md.morphs[k].dpos, 3));
        g.userData.morphList = BUILD_MORPHS;
        addMesh(ctx, name, p.material, g, { skinned: true, doubleSided: true, vertexColors: false, look });
      } else {
        addMesh(ctx, name, p.material, b.toGeometry({ skinned: false, origin }), { parent, doubleSided: true, vertexColors: false, look });
      }
      continue;
    }
    const md = meshData(m);
    if (p.ao) {
      const ctxField = p.kind === "skinned" ? (x, y, z) => Math.min(p.field(x, y, z), C.bodyD(x, y, z)) : (x, y, z) => Math.min(p.field(x, y, z), y > 1.45 ? C.headD("oval", x, y, z) : C.bodyD(x, y, z));
      md.colors = rgba(bakeAO(ctxField, m, { step: 0.004, strength: 0.8, min: 0.6 }));
    }
    if (p.kind === "skinned") {
      const P = m.positions;
      md.weights = Array.from({ length: P.length / 3 }, (_, v) => regionWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
      addBuildMorphs(md, { transfer: true });
      // Cloth only grows or shrinks with the build, so its shading barely turns: positions alone (a third of the file).
      for (const k of BUILD_MORPHS) md.morphs[k].dnrm = null;
    }
    // Fabric texture finer than the mesh: the template's weave/knit on its cloth parts (not on metal, lenses, soles).
    const detail = p.detail ?? (t.texture && !(p.material in OWN_LOOK) ? t.texture : undefined);
    baked.push({ name, p, md, look, field: p.field, detail });
  }
  const maps = [];
  if (baked.length) {
    const { mds, png } = bakeSet(baked, texSize(t.slot), { quality: 85 });
    baked.forEach(({ name, p, look }, k) => {
      if (p.kind === "skinned") addMesh(ctx, name, p.material, toGeometry(mds[k]), { skinned: true, doubleSided: true, look });
      else addMesh(ctx, name, p.material, toGeometry(mds[k], origin), { parent, doubleSided: true, look });
    });
    maps.push({ png, meshes: baked.map((b) => b.name) });
  }
  console.log(`  ${key}: ${parts.map((x) => `${x.p.material}:${x.tris}`).join(" ")}${total > budget ? ` (from ${total})` : ""}`);
  await write(ctx.scene, `${key}.glb`, [], maps);
}

/* ── driver ──────────────────────────────────────────────────────────────── */

export const ALL_KEYS = [
  "base",
  ...HAIR_STYLES.filter((h) => h !== "bald").map((h) => `hair_${h}`),
  ...FACIAL_HAIR.filter((f) => f !== "none").map((f) => `beard_${f}`),
  ...Object.keys(TEMPLATES),
];

async function run(key) {
  if (key === "base") return base();
  if (key.startsWith("hair_")) return hairAsset(key.slice(5));
  if (key.startsWith("beard_")) return beardAsset(key.slice(6));
  if (TEMPLATES[key]) return garment(key, TEMPLATES[key]);
  throw new Error(`unknown asset key ${key}`);
}

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = arg("--only");
  const keys = only ? only.split(",") : ALL_KEYS;
  const jobs = Math.max(1, Number(arg("--jobs") ?? 1) || 1);
  if (jobs === 1 || keys.length === 1) {
    for (const k of keys) await run(k);
  } else {
    // One child process per asset, `jobs` at a time — the base and the long hair are the slow ones, so start them first.
    const queue = [...keys].sort((a, b) => (b === "base") - (a === "base"));
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const k = queue.shift();
        const extra = PREVIEW ? ["--preview"] : [];
        await new Promise((resolve) => {
          const p = spawn(process.execPath, [fileURLToPath(import.meta.url), "--only", k, ...extra], { stdio: "inherit", env: process.env });
          p.on("exit", (code) => {
            if (code) failed++;
            resolve();
          });
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, cpus().length) }, worker));
    if (failed) process.exit(1);
  }
}

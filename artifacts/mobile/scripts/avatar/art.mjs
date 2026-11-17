/**
 * Hand-made ("art") assets: meshes sculpted or modelled in Blender against
 * sd_rig_v3 and exported with blender/sd_export.py into scripts/avatar/art/.
 *
 * generate.mjs is art-first: when art/<key>.glb exists it builds that asset
 * from the art's meshes instead of the procedural fields, and fills in only
 * what the art leaves out, from the same sources the procedural assets use:
 *   - skin weights      → the body's region weights (cloth: at the skin beneath it)
 *   - build / frameFem  → transferred from the procedural body's shape fields
 *   - face blendshapes  → the head's analytic expressions and mouth fields
 *   - body regions      → each triangle classified by character.regionOf
 * Everything the art does author (weights, shape keys, normal maps, vertex
 * colours, UVs) is kept as is. Output goes through the same writer, so the
 * files carry the same metadata and compression and pass the same checks.
 *
 * This module only reads art files and converts them; the rest lives in
 * generate.mjs next to the procedural code it shares.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BONE_NAMES, HEAD } from "./rig.mjs";
import { boneName } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const ART_DIR = process.env.AVATAR_ART ?? join(here, "art");

/** The art file for an asset key ("base", "hair_fade", "beard_goatee", "outerwear_varsity"), or null. */
export const artFile = (key) => {
  if (process.env.AVATAR_NO_ART) return null;
  const f = join(ART_DIR, `${key}.glb`);
  return existsSync(f) ? f : null;
};

let io;
async function reader() {
  if (io) return io;
  try {
    const [{ NodeIO }, { ALL_EXTENSIONS }] = await Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions")]);
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    return io;
  } catch {
    throw new Error("art/*.glb needs glTF-Transform to read (see AVATAR_3D.md §2.1 for the install line)");
  }
}

/** Blender adds .001-style suffixes to duplicated names; the contract uses the bare name. */
const bare = (n) => (n ?? "").replace(/\.\d{3}$/, "");

/** 4×4 column-major multiply (glTF matrices). */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const xfPoint = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const xfDir = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];

/** Accessor values as plain floats (dequantising normalised integer accessors). */
function floats(acc) {
  if (!acc) return null;
  const n = acc.getCount(), k = acc.getElementSize();
  const out = new Float32Array(n * k);
  const el = new Array(k);
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    for (let j = 0; j < k; j++) out[i * k + j] = el[j];
  }
  return out;
}

/**
 * Reads an art GLB. Returns { meta, meshes: [{ name, material, look, parent,
 * skinned, positions, normals, indices, uvs, tangents, colors, weights,
 * morphs, normalMap }] } in the rig's rest pose, world space (metres, y up).
 */
export async function readArt(file) {
  const doc = await (await reader()).read(file);
  const root = doc.getRoot();
  const meta = root.listScenes()[0]?.getExtras()?.sdAvatar ?? root.getExtras()?.sdAvatar ?? {};
  const meshes = [];
  const warnings = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    // Skinned: rest pose = bind pose by contract, so a vertex's place is Σ w · (joint world × inverse bind) · v.
    let jointXf = null, jointNames = null;
    if (skin) {
      const ibm = floats(skin.getInverseBindMatrices());
      jointNames = skin.listJoints().map((j) => boneName(j.getName()));
      jointXf = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm ? Array.from(ibm.subarray(i * 16, i * 16 + 16)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      for (const j of jointNames) if (!BONE_NAMES.includes(j)) warnings.push(`${node.getName()}: joint ${j} is not an sd_rig_v3 bone (its weight goes to the nearest kept bone's)`);
    }
    const world = node.getWorldMatrix();
    const parent = node.getParentNode?.() ?? root.listNodes().find((p) => p.listChildren().includes(node)) ?? null;
    const targetNames = mesh.getExtras()?.targetNames ?? [];
    for (const [pi, prim] of mesh.listPrimitives().entries()) {
      const P = floats(prim.getAttribute("POSITION"));
      const N = floats(prim.getAttribute("NORMAL"));
      const n = P.length / 3;
      const J = floats(prim.getAttribute("JOINTS_0")), W = floats(prim.getAttribute("WEIGHTS_0"));
      const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
      const vxf = (v) => {
        if (!jointXf || !J) return world;
        const m = new Array(16).fill(0);
        let tot = 0;
        for (let k = 0; k < 4; k++) {
          const w = W[v * 4 + k];
          if (!w) continue;
          tot += w;
          const x = jointXf[J[v * 4 + k]];
          for (let e = 0; e < 16; e++) m[e] += w * x[e];
        }
        if (!tot) return world;
        for (let e = 0; e < 16; e++) m[e] /= tot;
        return m;
      };
      const xfs = new Array(n);
      for (let v = 0; v < n; v++) {
        const m = (xfs[v] = vxf(v));
        positions.set(xfPoint(m, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), v * 3);
        if (N) {
          const d = xfDir(m, N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          const l = Math.hypot(...d) || 1;
          normals.set([d[0] / l, d[1] / l, d[2] / l], v * 3);
        }
      }
      if (!N) warnings.push(`${node.getName()}: no normals; computed flat-shaded ones`);
      const idxAcc = prim.getIndices();
      const indices = idxAcc ? Uint32Array.from(floats(idxAcc)) : Uint32Array.from({ length: n }, (_, i) => i);
      const T = floats(prim.getAttribute("TANGENT"));
      let tangents = null;
      if (T) {
        tangents = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) {
          const d = xfDir(xfs[v], T[v * 4], T[v * 4 + 1], T[v * 4 + 2]);
          const l = Math.hypot(...d) || 1;
          tangents.set([d[0] / l, d[1] / l, d[2] / l, T[v * 4 + 3]], v * 4);
        }
      }
      const C = floats(prim.getAttribute("COLOR_0"));
      let colors = null;
      if (C) {
        const k = prim.getAttribute("COLOR_0").getElementSize();
        colors = new Uint8Array(n * 4);
        for (let v = 0; v < n; v++) for (let c = 0; c < 4; c++) colors[v * 4 + c] = Math.round(255 * Math.min(1, Math.max(0, c < k ? C[v * k + c] : 1)));
      }
      let weights = null;
      if (jointNames && J && W) {
        weights = new Array(n);
        for (let v = 0; v < n; v++) {
          const w = {};
          for (let k = 0; k < 4; k++) {
            const b = jointNames[J[v * 4 + k]];
            if (W[v * 4 + k] > 0 && BONE_NAMES.includes(b)) w[b] = (w[b] ?? 0) + W[v * 4 + k];
          }
          weights[v] = Object.keys(w).length ? w : null;
        }
        if (weights.some((w) => !w)) weights = null; // partly weighted: re-weight the whole mesh
      }
      const morphs = {};
      prim.listTargets().forEach((t, ti) => {
        const name = targetNames[ti];
        const dp = floats(t.getAttribute("POSITION"));
        if (!name || !dp) return;
        const dpos = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) dpos.set(xfDir(xfs[v], dp[v * 3], dp[v * 3 + 1], dp[v * 3 + 2]), v * 3);
        const dn = floats(t.getAttribute("NORMAL"));
        let dnrm = null;
        if (dn) {
          dnrm = new Float32Array(n * 3);
          for (let v = 0; v < n; v++) dnrm.set(xfDir(xfs[v], dn[v * 3], dn[v * 3 + 1], dn[v * 3 + 2]), v * 3);
        }
        morphs[name] = { dpos, dnrm };
      });
      const mat = prim.getMaterial();
      const tex = mat?.getNormalTexture();
      const img = tex?.getImage();
      const name = bare(node.getName()) + (mesh.listPrimitives().length > 1 && pi ? `_${pi}` : "");
      meshes.push({
        name,
        material: bare(mat?.getName() ?? ""),
        look: mat?.getExtras()?.sdLook ?? node.getExtras()?.sdLook ?? null,
        doubleSided: mat?.getDoubleSided() ?? false,
        parent: parent ? boneName(bare(parent.getName())) : null,
        skinned: !!skin,
        positions,
        normals,
        indices,
        uvs: floats(prim.getAttribute("TEXCOORD_0")),
        tangents,
        colors,
        weights,
        morphs,
        normalMap: img ? { bytes: Buffer.from(img), mime: tex.getMimeType() } : null,
        hasBaseColorMap: !!mat?.getBaseColorTexture(),
      });
    }
  }
  for (const m of meshes) if (m.hasBaseColorMap) warnings.push(`${m.name}: base-colour texture ignored (colour comes from the tint; bake shading into vertex colours instead)`);
  return { meta, meshes, warnings };
}

const cache = new Map();
/** readArt for an asset key, cached; null when there's no art for it. Prints the art's warnings once. */
export async function loadArt(key) {
  if (cache.has(key)) return cache.get(key);
  const f = artFile(key);
  const art = f ? await readArt(f) : null;
  if (art) {
    console.log(`  ${key}: art/${key}.glb (${art.meshes.length} meshes)`);
    for (const w of art.warnings) console.warn(`    warning: ${w}`);
  }
  cache.set(key, art);
  return art;
}

/** The art mesh with this contract name (exact), or null. */
export const artMesh = (art, name) => art?.meshes.find((m) => m.name === name) ?? null;

/**
 * How far an art head's scalp strays from the shared cranium (rig.HEAD) that
 * hair and headwear are fitted to: over the area a cap covers, the worst
 * distance outside it and inside it (metres). Beyond a few mm, hats and the
 * procedural hair no longer sit right on this head.
 */
export function craniumDeviation(positions) {
  const [cx, cy, cz] = HEAD.center, [rx, ry, rz] = HEAD.radii;
  let out = 0, inn = 0;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v] - cx, y = positions[v + 1] - cy, z = positions[v + 2] - cz;
    if (positions[v + 1] < 1.69 || (z > 0.06 && positions[v + 1] < 1.72)) continue; // above the brow, the area hats sit on
    const k = Math.hypot(x / rx, y / ry, z / rz);
    const d = (k - 1) * Math.min(rx, ry, rz);
    out = Math.max(out, d);
    inn = Math.min(inn, d);
  }
  return { out, in: inn };
}

/** The art's meshes grouped by normal map, for addNormalMaps: [{ png, meshes }]. */
export function artNormalMaps(list) {
  const groups = new Map();
  for (const { name, art } of list) {
    if (!art.normalMap || !art.uvs) continue;
    const k = art.normalMap.bytes;
    let g = [...groups.keys()].find((b) => b.equals(k));
    if (!g) groups.set((g = k), []);
    groups.get(g).push(name);
  }
  return [...groups.entries()].map(([png, meshes]) => ({ png, meshes }));
}

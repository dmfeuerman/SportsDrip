#!/usr/bin/env node
/**
 * Validates avatar GLBs against the rig contract, without a renderer — it
 * reads the glTF JSON and binary chunks directly, so it runs anywhere Node
 * does (CI, a pre-commit hook, the test suite).
 *
 *   node scripts/avatar/validate.mjs                 # every assets/avatar/*.glb
 *   node scripts/avatar/validate.mjs path/to/new.glb # one file
 *
 * Checks: rig id and asset metadata; every skin's joints are rig bones with
 * the rig's parents and rest offsets; sockets sit where the rig says; skin
 * weights are present and sum to 1; rigid parts hang off a socket or a bone;
 * attachment specs, hide regions and layers are well formed; material names;
 * triangle and size budgets (what one avatar draws, and the whole file);
 * that every variant the app can ask for exists — each body hide region,
 * face shape, eye shape and brow in the base, each hat mode in a hairstyle,
 * each face shape in a facial-hair style; and that every part carries the
 * blendshapes the runtime drives (build, face options, ARKit expressions).
 * Bone names may carry Blender's Mixamo prefix (mixamorig:Hips).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessor, readGlb } from "./glb.mjs";
import { BODY_REGIONS, BONES, BUILD_MORPHS, EXPRESSIONS, EYE_SHAPES, EYEBROWS, FACE_SHAPES, HAIR_MODES, HAIR_STYLES, NOSE_SHAPES, RIG_ID, SOCKETS } from "./rig.mjs";

export const SLOTS = ["hat", "eyewear", "top", "outerwear", "bottom", "shoes", "accessory"];
export const TINT_MATERIALS = ["primary", "secondary", "primary_dark", "secondary_dark", "metal", "lens", "sole", "laces"];
const MATERIALS = {
  base: ["skin", "eye_white", "iris", "pupil", "teeth", "brow", "lash", "base_layer"],
  hair: ["hair", "hair_tie"],
  facialHair: ["beard", "stubble"],
  garment: TINT_MATERIALS,
};
/**
 * Mobile budgets. `drawn` is what one avatar draws from the file (the base
 * carries every head, lid and brow variant, a hairstyle one variant per hat
 * mode, but only one of each is shown); `tris`/`bytes` cap the whole file.
 */
const BUDGET = {
  // One body, twelve heads (4 face shapes × 3 noses, one drawn), lids/lashes for three eye shapes,
  // brows; ~half the file is blendshapes. Meshing each nose instead of morphing the button
  // (which tore) costs ~1.4 MB: still one bundled file, parsed once.
  base: { drawn: 15_000, tris: 60_000, bytes: 3_200_000 },
  garment: { drawn: 5_000, tris: 5_000, bytes: 600_000 },
  // A hairstyle and its four under-hat variants.
  hair: { drawn: 5_000, tris: 25_000, bytes: 1_200_000 },
  // One beard per face shape, each with its face and expression blendshapes.
  facialHair: { drawn: 2_500, tris: 12_000, bytes: 750_000 },
};
const KINDS = Object.keys(BUDGET);
/** Blendshapes the runtime drives, per part. */
const MOUTH_MORPHS = ["lipsFull", "mouthWide"];
const FACE_MORPHS = ["noseStraight", "noseBroad", ...MOUTH_MORPHS];
const MOUTH_EXPRESSIONS = EXPRESSIONS.filter((e) => !e.startsWith("eyeBlink"));
/** Skinned rigs exported from Blender with a Mixamo armature name their bones mixamorig:Hips etc. */
export const boneName = (n) => (n ?? "").replace(/^mixamorig\d*[:_]?/, "");

const PARENT = Object.fromEntries(BONES.map(([n, p]) => [n, p]));
const REST = Object.fromEntries(BONES.map(([n, , pos]) => [n, pos]));

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Problems with an attachment spec (see lib/avatar3d/attach.ts). */
export function attachErrors(spec) {
  const errs = [];
  if (!spec || typeof spec !== "object") return ["attach must be an object"];
  if (spec.socket !== undefined && !SOCKETS[spec.socket]) errs.push(`attach.socket ${spec.socket} is not a rig socket`);
  if (spec.socket && spec.bone && SOCKETS[spec.socket] && SOCKETS[spec.socket].bone !== spec.bone) errs.push(`attach.bone ${spec.bone} isn't ${spec.socket}'s bone`);
  const transform = (t, where) => {
    if (!t || typeof t !== "object") return errs.push(`${where} must be an object`);
    if (t.position !== undefined && !isVec3(t.position)) errs.push(`${where}.position must be [x, y, z]`);
    if (t.rotation !== undefined && !isVec3(t.rotation)) errs.push(`${where}.rotation must be [x, y, z] degrees`);
    if (t.scale !== undefined && !((isNum(t.scale) && t.scale > 0) || (isVec3(t.scale) && t.scale.every((s) => s > 0)))) errs.push(`${where}.scale must be a positive number or [x, y, z]`);
    if (t.hidden !== undefined && typeof t.hidden !== "boolean") errs.push(`${where}.hidden must be true/false`);
    if (t.position && Math.hypot(...t.position) > 0.3) errs.push(`${where}.position moves it ${Math.hypot(...t.position).toFixed(2)} m — more than 30 cm off its socket`);
  };
  transform(spec, "attach");
  for (const [k, t] of Object.entries(spec.perHair ?? {})) {
    if (!HAIR_STYLES.includes(k)) errs.push(`attach.perHair.${k}: unknown hairstyle`);
    transform(t, `attach.perHair.${k}`);
  }
  for (const [k, t] of Object.entries(spec.perFace ?? {})) {
    if (!FACE_SHAPES.includes(k)) errs.push(`attach.perFace.${k}: unknown face shape`);
    transform(t, `attach.perFace.${k}`);
  }
  for (const [k, t] of Object.entries(spec.with ?? {})) transform(t, `attach.with.${k}`);
  return errs;
}

export function validateGlb(file) {
  const errors = [];
  const warnings = [];
  const buf = readFileSync(file);
  let gltf;
  let bin;
  try {
    ({ json: gltf, bin } = readGlb(buf));
  } catch (e) {
    return { file, ok: false, errors: [e.message], warnings, meta: null };
  }

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const meta = scene?.extras?.sdAvatar ?? null;
  if (!meta) errors.push("scene extras.sdAvatar missing (asset metadata)");
  else {
    if (meta.rig !== RIG_ID) errors.push(`rig is ${meta.rig}, expected ${RIG_ID}`);
    if (!KINDS.includes(meta.kind)) errors.push(`kind must be ${KINDS.join("|")}, got ${meta.kind}`);
    if (!Number.isInteger(meta.version)) errors.push("version must be an integer");
    if (meta.kind === "garment") {
      if (!SLOTS.includes(meta.slot)) errors.push(`unknown slot ${meta.slot}`);
      if (meta.hairMode && !HAIR_MODES.includes(meta.hairMode)) errors.push(`unknown hairMode ${meta.hairMode}`);
      for (const s of meta.excludes ?? []) if (!SLOTS.includes(s)) errors.push(`excludes unknown slot ${s}`);
      if (meta.template && meta.template !== basename(file, ".glb")) warnings.push(`template ${meta.template} differs from file name`);
      if (meta.attach !== undefined) errors.push(...attachErrors(meta.attach));
      for (const r of meta.hides ?? []) if (!BODY_REGIONS.includes(r)) errors.push(`hides unknown body region ${r}`);
      if (meta.layer !== undefined && !Number.isInteger(meta.layer)) errors.push("layer must be an integer");
    }
    if ((meta.kind === "hair" || meta.kind === "facialHair") && meta.part && meta.part !== basename(file, ".glb")) warnings.push(`part ${meta.part} differs from file name`);
  }

  const nodes = gltf.nodes ?? [];
  const parentOf = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  const nameOf = (i) => boneName(nodes[i]?.name);
  const translation = (n) => (n.matrix ? [n.matrix[12], n.matrix[13], n.matrix[14]] : n.translation ?? [0, 0, 0]);
  const rotated = (n) =>
    n.matrix ? [n.matrix[1], n.matrix[2], n.matrix[4], n.matrix[6], n.matrix[8], n.matrix[9]].some((v) => Math.abs(v) > 1e-4) : (n.rotation ?? [0, 0, 0, 1]).slice(0, 3).some((v) => Math.abs(v) > 1e-4);

  // Rig bones present, correctly parented, at the rig's rest offsets.
  const byName = new Map(nodes.map((n, i) => [boneName(n.name), i]));
  for (const [bone, parent] of Object.entries(PARENT)) {
    const i = byName.get(bone);
    if (i === undefined) {
      errors.push(`rig bone ${bone} missing`);
      continue;
    }
    const p = parentOf.get(i);
    if (parent && nameOf(p) !== parent) errors.push(`bone ${bone} parent is ${nameOf(p)}, expected ${parent}`);
    const t = translation(nodes[i]);
    const pp = parent ? REST[parent] : [0, 0, 0];
    const want = REST[bone].map((v, k) => v - pp[k]);
    if (parent && t.some((v, k) => Math.abs(v - want[k]) > 0.001)) errors.push(`bone ${bone} rest offset differs from rig`);
    if (rotated(nodes[i])) errors.push(`bone ${bone} has a rest rotation (rig bones are world-aligned)`);
  }

  // Sockets: wherever present they must sit where the rig says. The base must have all of them.
  for (const [name, s] of Object.entries(SOCKETS)) {
    const i = byName.get(`Socket_${name}`);
    if (i === undefined) {
      if (meta?.kind === "base") errors.push(`base is missing socket ${name}`);
      continue;
    }
    if (nameOf(parentOf.get(i)) !== s.bone) errors.push(`socket ${name} must be on ${s.bone}`);
    const want = s.position.map((v, k) => v - REST[s.bone][k]);
    if (translation(nodes[i]).some((v, k) => Math.abs(v - want[k]) > 0.001)) errors.push(`socket ${name} is not at the rig's position`);
    if (rotated(nodes[i])) errors.push(`socket ${name} has a rotation (sockets are world-aligned)`);
  }

  let tris = 0;
  const materials = new Set();
  const meshNames = new Set();
  const meshTris = {};
  const morphsOf = {};
  let rigidOnSocket = false;
  nodes.forEach((n, ni) => {
    if (n.mesh === undefined) return;
    meshNames.add(n.name);
    const mesh = gltf.meshes[n.mesh];
    morphsOf[n.name] = mesh.extras?.targetNames ?? [];
    for (const prim of mesh.primitives) {
      const mat = gltf.materials?.[prim.material]?.name ?? "(none)";
      materials.add(mat);
      const t = prim.indices !== undefined ? gltf.accessors[prim.indices].count / 3 : gltf.accessors[prim.attributes.POSITION].count / 3;
      tris += t;
      meshTris[n.name] = (meshTris[n.name] ?? 0) + t;
      if ((prim.targets?.length ?? 0) !== morphsOf[n.name].length) errors.push(`${n.name}: ${prim.targets?.length ?? 0} morph targets but ${morphsOf[n.name].length} target names`);
      if (n.skin !== undefined) {
        if (prim.attributes.JOINTS_0 === undefined || prim.attributes.WEIGHTS_0 === undefined) {
          errors.push(`${n.name}: skinned mesh without JOINTS_0/WEIGHTS_0`);
          continue;
        }
        if (bin) {
          const w = accessor(gltf, bin, prim.attributes.WEIGHTS_0);
          let bad = 0;
          for (let v = 0; v < w.length; v += 4) if (Math.abs(w[v] + w[v + 1] + w[v + 2] + w[v + 3] - 1) > 0.01) bad++;
          if (bad) errors.push(`${n.name}: ${bad} vertices have weights that don't sum to 1`);
        }
      } else {
        const parent = nameOf(parentOf.get(ni));
        const onSocket = typeof parent === "string" && parent.startsWith("Socket_");
        if (onSocket) rigidOnSocket = true;
        // Rigid parts must ride a bone or a socket; a loose mesh would never move.
        if (!PARENT.hasOwnProperty(parent) && !onSocket && meta?.kind !== "base") errors.push(`${n.name}: rigid part must be a child of a rig bone or socket (is under ${parent ?? "scene root"})`);
      }
    }
    if (n.skin !== undefined) {
      const skin = gltf.skins[n.skin];
      for (const j of skin.joints) if (!PARENT.hasOwnProperty(nameOf(j))) errors.push(`${n.name}: joint ${nameOf(j)} is not a rig bone`);
      // Skinned garments should follow the body build; without the shapes they'd clip on a broad build.
      if (meta?.kind === "garment" && !BUILD_MORPHS.every((m) => morphsOf[n.name].includes(m))) warnings.push(`${n.name}: no ${BUILD_MORPHS.join("/")} blendshapes; it won't follow the body build`);
    }
  });
  if (meta?.kind === "garment" && rigidOnSocket && !meta.attach) warnings.push("rigid parts on a socket but no attach spec; they'll sit at the socket as authored");

  const allowed = MATERIALS[meta?.kind] ?? TINT_MATERIALS;
  for (const m of materials) if (!allowed.includes(m)) warnings.push(`material "${m}" is not a ${meta?.kind ?? "tint"} material name; it will render as authored`);

  const need = (list, what) => {
    for (const n of list) if (!meshNames.has(n)) errors.push(`${what} is missing part ${n}`);
  };
  const needMorphs = (names, list) => {
    for (const n of names) {
      if (!meshNames.has(n)) continue;
      const missing = list.filter((m) => !morphsOf[n].includes(m));
      if (missing.length) errors.push(`${n} is missing blendshapes ${missing.join(", ")}`);
    }
  };
  const sum = (names) => names.reduce((t, n) => t + (meshTris[n] ?? 0), 0);
  const max = (names) => Math.max(0, ...names.map((n) => meshTris[n] ?? 0));
  let drawn = tris;
  if (meta?.kind === "base") {
    const body = BODY_REGIONS.map((r) => `Body_${r}`);
    need([...body, "Underwear", "Eyes", "Iris", "Pupils", "Teeth"], "base");
    const heads = FACE_SHAPES.flatMap((f) => NOSE_SHAPES.map((n) => (n === "button" ? `Head_${f}` : `Head_${f}_${n}`)));
    need(heads, "base");
    need(EYE_SHAPES.flatMap((e) => [`Lids_${e}`, `Lashes_${e}`]), "base");
    need(EYEBROWS.filter((s) => s !== "none").map((s) => `Brows_${s}`), "base");
    needMorphs([...body, "Underwear"], BUILD_MORPHS);
    needMorphs(heads, [...BUILD_MORPHS, ...MOUTH_MORPHS, ...MOUTH_EXPRESSIONS]);
    needMorphs(EYE_SHAPES.flatMap((e) => [`Lids_${e}`, `Lashes_${e}`]), ["eyeBlinkLeft", "eyeBlinkRight"]);
    const clips = (gltf.animations ?? []).map((a) => a.name);
    if (!clips.includes("idle")) errors.push("base needs an idle animation");
    drawn =
      sum([...body, "Underwear", "Eyes", "Iris", "Pupils", "Teeth"]) +
      max(heads) +
      max(EYE_SHAPES.map((e) => `Lids_${e}`)) +
      max(EYE_SHAPES.map((e) => `Lashes_${e}`)) +
      max(EYEBROWS.map((s) => `Brows_${s}`));
  }
  if (meta?.kind === "hair") {
    need(["Hair", ...HAIR_MODES.map((m) => `Hair_${m}`)], "hairstyle");
    drawn = Math.max(...[null, ...HAIR_MODES].map((m) => sum([m ? `Hair_${m}` : "Hair", m ? `HairTie_${m}` : "HairTie"])));
  }
  if (meta?.kind === "facialHair") {
    need(FACE_SHAPES.map((f) => `Beard_${f}`), "facial hair");
    needMorphs(FACE_SHAPES.map((f) => `Beard_${f}`), [...FACE_MORPHS, ...MOUTH_EXPRESSIONS]);
    drawn = Math.max(...FACE_SHAPES.map((f) => sum([`Beard_${f}`, `BeardShadow_${f}`])));
  }

  const budget = BUDGET[meta?.kind] ?? BUDGET.garment;
  const bytes = statSync(file).size;
  if (drawn > budget.drawn) errors.push(`${drawn} triangles drawn exceeds the ${budget.drawn} budget`);
  if (tris > budget.tris) errors.push(`${tris} triangles in the file exceeds the ${budget.tris} budget`);
  if (bytes > budget.bytes) errors.push(`${(bytes / 1024).toFixed(0)} KB exceeds the ${(budget.bytes / 1024).toFixed(0)} KB budget`);

  return { file, ok: errors.length === 0, errors, warnings, meta, tris, drawn, bytes };
}

export function assetDir() {
  return process.env.AVATAR_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "avatar");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const files = args.length ? args : readdirSync(assetDir()).filter((f) => f.endsWith(".glb")).map((f) => join(assetDir(), f));
  let failed = 0;
  for (const f of files) {
    const r = validateGlb(f);
    const tag = r.ok ? "ok  " : "FAIL";
    console.log(`${tag} ${basename(f).padEnd(28)} ${String(r.drawn ?? "-").padStart(6)} drawn ${String(r.tris ?? "-").padStart(6)} tris ${((r.bytes ?? 0) / 1024).toFixed(0).padStart(5)} KB`);
    for (const e of r.errors) console.log(`     error: ${e}`);
    for (const w of r.warnings) console.log(`     warn:  ${w}`);
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

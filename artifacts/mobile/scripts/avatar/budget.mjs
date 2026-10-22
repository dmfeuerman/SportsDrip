#!/usr/bin/env node
/**
 * Triangles one avatar actually draws: the base with the regions its
 * garments hide taken out, one head / lid / lash / brow variant, the hair
 * variant for the worn hat, the facial hair for the face shape, and each
 * garment (rigid parts its attachment spec hides, e.g. a chain under a
 * zipped jacket, left out). The mobile budget is 30k.
 *
 *   node scripts/avatar/budget.mjs top_tee bottom_shorts shoes_sneaker --hair long --beard beard
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BODY_REGIONS } from "./rig.mjs";
import { assetDir } from "./validate.mjs";

export const AVATAR_TRIS = 30_000;
const PRIORITY = { banded: 1, capped: 2, covered: 3, helmet: 4 };

function meshTris(file) {
  const buf = readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString("utf8"));
  const tris = {};
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    for (const p of json.meshes[n.mesh].primitives) tris[n.name] = (tris[n.name] ?? 0) + json.accessors[p.indices].count / 3;
  }
  return { tris, meta: json.scenes[0].extras?.sdAvatar ?? {} };
}

/**
 * templates: garment template keys worn; avatar: { hairStyle, facialHair,
 * faceShape, eyeShape, eyebrows }. Returns { total, parts: {name: tris} }.
 */
export function drawnTriangles(templates, avatar = {}, dir = assetDir()) {
  const parts = {};
  const garments = templates.map((t) => ({ key: t, ...meshTris(join(dir, `${t}.glb`)) }));
  const hidden = new Set(garments.flatMap((g) => g.meta.hides ?? []));
  let mode = null;
  for (const g of garments) if (g.meta.hairMode && (!mode || PRIORITY[g.meta.hairMode] > PRIORITY[mode])) mode = g.meta.hairMode;

  const base = meshTris(join(dir, "sd_base_v3.glb")).tris;
  if (!hidden.has("hips")) {
    parts.Underwear = base.Underwear;
    hidden.add("hips");
  }
  let body = 0;
  for (const r of BODY_REGIONS) if (!hidden.has(r)) body += base[`Body_${r}`] ?? 0;
  parts.body = body;
  const face = avatar.faceShape ?? "oval", eyes = avatar.eyeShape ?? "round", brows = avatar.eyebrows ?? "soft";
  parts.head = base[`Head_${face}`] + base.Eyes + base.Iris + base.Pupils + base.Teeth + base[`Lids_${eyes}`] + base[`Lashes_${eyes}`] + (brows === "none" ? 0 : base[`Brows_${brows}`]);

  const style = avatar.hairStyle ?? "short_crop";
  if (style !== "bald") {
    const h = meshTris(join(dir, `hair_${style}.glb`)).tris;
    const name = mode && h[`Hair_${mode}`] ? `Hair_${mode}` : "Hair";
    parts.hair = h[name] + (h[mode ? `HairTie_${mode}` : "HairTie"] ?? 0);
  }
  if (avatar.facialHair && avatar.facialHair !== "none") {
    const b = meshTris(join(dir, `beard_${avatar.facialHair}.glb`)).tris;
    parts.facialHair = (b[`Beard_${face}`] ?? 0) + (b[`BeardShadow_${face}`] ?? 0);
  }
  for (const g of garments) {
    const others = garments.filter((o) => o !== g);
    const rules = g.meta.attach?.with ?? {};
    const hiddenRigid = others.some((o) => (rules[o.key] ?? rules[o.meta.slot])?.hidden);
    parts[g.key] = hiddenRigid ? 0 : Object.values(g.tris).reduce((a, b) => a + b, 0);
  }
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const templates = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const r = drawnTriangles(templates, { hairStyle: opt("--hair"), facialHair: opt("--beard"), faceShape: opt("--face") });
  console.log(`${r.total} triangles (budget ${AVATAR_TRIS})`, JSON.stringify(r.parts));
  process.exit(r.total > AVATAR_TRIS ? 1 : 0);
}

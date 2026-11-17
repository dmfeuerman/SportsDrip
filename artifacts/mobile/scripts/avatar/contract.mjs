#!/usr/bin/env node
/**
 * The authoring contract for hand-made avatar assets, as one JSON file the
 * Blender tools read (blender/sd_contract.json). Everything in it comes from
 * the generator's own sources — rig, sockets, layer offsets, fit volumes,
 * templates, budgets — so Blender never hard-codes a number the runtime or
 * the checks also depend on.
 *
 *   node scripts/avatar/contract.mjs            # writes scripts/avatar/blender/sd_contract.json
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "./rig.mjs";
import { EYE, EYE_FEM_SCALE, MOUTH, NECK_CUT } from "./character.mjs";
import { TEMPLATES } from "./templates.mjs";
import { BUDGET, MATERIALS, TINT_MATERIALS } from "./validate.mjs";
import { FABRIC, GARMENT_TRIS, LAYERS, TRIS } from "./generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function contract() {
  const faceMorphs = { nose: ["noseStraight", "noseBroad"], mouth: ["lipsFull", "mouthWide"] };
  return {
    rig: R.RIG_ID,
    version: 3,
    units: "metres, +Y up (glTF), character faces +Z, feet on y = 0; Blender: metres, +Z up, faces -Y (the glTF exporter converts)",
    bones: R.BONES.map(([name, parent, rest]) => ({ name, parent, rest })),
    sockets: R.SOCKETS,
    layerOffset: R.LAYER_OFFSET,
    head: { cranium: R.HEAD, eye: EYE, eyeFemScale: EYE_FEM_SCALE, mouth: MOUTH, neckCut: NECK_CUT },
    ids: {
      faces: R.FACE_SHAPES,
      noses: R.NOSE_SHAPES,
      mouths: R.MOUTH_SHAPES,
      eyes: R.EYE_SHAPES,
      eyebrows: R.EYEBROWS.filter((b) => b !== "none"),
      hairStyles: R.HAIR_STYLES.filter((h) => h !== "bald"),
      facialHair: R.FACIAL_HAIR.filter((f) => f !== "none"),
      hairModes: R.HAIR_MODES,
      regions: R.BODY_REGIONS,
    },
    morphs: { build: R.BUILD_MORPHS, expressions: R.EXPRESSIONS, ...faceMorphs },
    materials: { ...MATERIALS, tint: TINT_MATERIALS },
    fabrics: Object.keys(FABRIC),
    budgets: { files: BUDGET, garmentSlot: GARMENT_TRIS, parts: TRIS },
    templates: Object.fromEntries(
      Object.entries(TEMPLATES).map(([key, t]) => [
        key,
        { slot: t.slot, socket: t.socket ?? null, hairMode: t.hairMode ?? null, hides: t.hides ?? [], layer: t.layer ?? LAYERS[t.slot], look: t.look ?? null, tris: t.tris ?? GARMENT_TRIS[t.slot] },
      ])
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(here, "blender", "sd_contract.json");
  writeFileSync(out, JSON.stringify(contract(), null, 1) + "\n");
  console.log(`wrote ${out}`);
}

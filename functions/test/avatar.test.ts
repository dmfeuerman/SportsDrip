import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, db, rejects, seedUser } from "./helpers";
import { saveAppearance } from "../src/callable/avatar";
import { equipItem } from "../src/callable/shop";
import { createProfile, updateAvatar } from "../src/callable/profile";
import {
  appearanceErrors,
  applyEquip,
  BODY_REGIONS,
  DEFAULT_AVATAR,
  EYE_SHAPE_IDS,
  EYEBROW_IDS,
  FACE_SHAPE_IDS,
  FACIAL_HAIR_IDS,
  HAIR_MODES,
  HAIR_STYLE_IDS,
  hairModeOf,
  hidesOf,
  layerOf,
  MOUTH_SHAPE_IDS,
  NOSE_SHAPE_IDS,
  outfitConflicts,
  sanitizeAppearance,
  SLOT_LAYER,
  TEMPLATE_INFO,
  templateFor,
  type ItemLike,
} from "../src/lib/avatarRules";
import { mergeAttach, resolveAttach } from "../../artifacts/mobile/lib/avatar3d/attach";
import { lookKey, pieceFor, resolveOutfit, type OutfitItem } from "../../artifacts/mobile/lib/avatar3d/outfit";
import { OUTFIT_PRESETS } from "../../artifacts/mobile/lib/avatar3d/outfitPresets";
import { rigName } from "../../artifacts/mobile/lib/avatar3d/rigNames";

// Compiled to build-test/functions/test/, so the repo root is four levels up.
const ROOT = join(__dirname, "..", "..", "..", "..");
const MOBILE = join(ROOT, "artifacts", "mobile");
const ASSETS = join(MOBILE, "assets", "avatar");
const esm = new Function("p", "return import(p)") as (p: string) => Promise<any>;

function readGlb(file: string) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const rest = buf.subarray(20 + jsonLen);
  return { json, rest };
}

function writeGlb(file: string, json: unknown, rest: Buffer) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (text.length % 4)) % 4;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(file, Buffer.concat([header, text, rest]));
}

const catalogItem = (id: string, slot: ItemLike["slot"], model: string | null, extra: Partial<OutfitItem> = {}) => ({
  id,
  slot,
  model,
  color: "#123456",
  secondaryColor: null,
  ...extra,
});

const CAT: Record<string, ReturnType<typeof catalogItem>> = {
  cap: catalogItem("cap", "hat", "hat_cap"),
  beanie: catalogItem("beanie", "hat", "hat_beanie"),
  cans: catalogItem("cans", "accessory", "acc_headphones"),
  chain: catalogItem("chain", "accessory", "acc_chain"),
  tee: catalogItem("tee", "top", "top_tee"),
  hoodie: catalogItem("hoodie", "top", "top_hoodie"),
  shorts: catalogItem("shorts", "bottom", "bottom_shorts"),
};
const lookup = (id: string) => CAT[id];

function seedCatalog() {
  for (const it of Object.values(CAT)) db.seed(`catalog/${it.id}`, { ...it, available: true, price: 10 });
}
function own(uid: string, ...ids: string[]) {
  for (const id of ids) db.seed(`users/${uid}/inventory/${id}`, { itemId: id });
}

beforeEach(() => db.reset());

// ── shared rules ────────────────────────────────────────────────────────────

test("avatarRules.ts is byte-identical in the app and in functions", () => {
  const a = readFileSync(join(MOBILE, "lib", "avatar3d", "avatarRules.ts"), "utf8");
  const b = readFileSync(join(ROOT, "functions", "src", "lib", "avatarRules.ts"), "utf8");
  assert.equal(a, b);
});

test("every bundled garment's GLB metadata matches TEMPLATE_INFO, and every template has a GLB", () => {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".glb"));
  const garments = new Map<string, any>();
  for (const f of files) {
    const meta = readGlb(join(ASSETS, f)).json.scenes[0].extras.sdAvatar;
    if (meta.kind === "garment") garments.set(f.replace(/\.glb$/, ""), meta);
  }
  assert.deepEqual([...garments.keys()].sort(), Object.keys(TEMPLATE_INFO).sort());
  for (const [k, meta] of garments) {
    const info = TEMPLATE_INFO[k]!;
    assert.equal(meta.slot, info.slot, k);
    assert.equal(meta.hairMode ?? null, info.hairMode, k);
    assert.deepEqual(meta.excludes ?? [], info.excludes, k);
    assert.deepEqual(meta.hides ?? [], info.hides, `${k} hides`);
    assert.equal(meta.layer, SLOT_LAYER[info.slot], `${k} layer`);
  }
});

const targetNames = (json: any, node: string) => {
  const n = json.nodes.find((x: { name: string }) => x.name === node);
  return (n && json.meshes[n.mesh].extras?.targetNames) ?? [];
};

test("the base GLB: Mixamo rig, every body region, face variant and blendshape the rules allow", () => {
  const { json } = readGlb(join(ASSETS, "sd_base_v3.glb"));
  const names = new Set<string>(json.nodes.map((n: { name: string }) => n.name));
  assert.equal(json.scenes[0].extras.sdAvatar.rig, "sd_rig_v3");
  for (const bone of ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]) assert.ok(names.has(bone), bone);
  for (const r of BODY_REGIONS) assert.ok(names.has(`Body_${r}`), r);
  for (const part of ["Underwear", "Eyes", "Iris", "Pupils", "Teeth"]) assert.ok(names.has(part), part);
  for (const f of FACE_SHAPE_IDS) {
    assert.ok(names.has(`Head_${f}`), f);
    const t = targetNames(json, `Head_${f}`);
    for (const m of ["buildSlim", "buildBroad", "noseStraight", "noseBroad", "lipsFull", "mouthWide", "mouthSmileLeft", "mouthSmileRight", "jawOpen"]) assert.ok(t.includes(m), `${f} ${m}`);
  }
  for (const e of EYE_SHAPE_IDS) {
    for (const p of [`Lids_${e}`, `Lashes_${e}`]) assert.deepEqual(targetNames(json, p), ["eyeBlinkLeft", "eyeBlinkRight"], p);
  }
  for (const b of EYEBROW_IDS) if (b !== "none") assert.ok(names.has(`Brows_${b}`), b);
  for (const r of BODY_REGIONS) assert.deepEqual(targetNames(json, `Body_${r}`), ["buildSlim", "buildBroad"], r);
  assert.deepEqual(json.animations.map((a: { name: string }) => a.name).sort(), ["cheer", "idle"]);
  assert.ok(json.materials.some((m: any) => m.normalTexture), "baked normal maps");
});

test("every hairstyle ships a variant per hat mode, every facial-hair style one per face shape", () => {
  for (const h of HAIR_STYLE_IDS) {
    if (h === "bald") continue;
    const { json } = readGlb(join(ASSETS, `hair_${h}.glb`));
    const names = new Set<string>(json.nodes.map((n: { name: string }) => n.name));
    for (const v of ["Hair", ...HAIR_MODES.map((m) => `Hair_${m}`)]) assert.ok(names.has(v), `${h} ${v}`);
    assert.ok((json.extensionsUsed ?? []).includes("KHR_materials_anisotropy"), `${h} strand highlights`);
  }
  for (const f of FACIAL_HAIR_IDS) {
    if (f === "none") continue;
    const { json } = readGlb(join(ASSETS, `beard_${f}.glb`));
    for (const face of FACE_SHAPE_IDS) {
      const t = targetNames(json, `Beard_${face}`);
      for (const m of ["jawOpen", "mouthSmileLeft", "lipsFull"]) assert.ok(t.includes(m), `${f}/${face} ${m}`);
    }
  }
});

test("every seeded catalog item renders with its declared model, and the demo catalog agrees", async () => {
  const { CATALOG } = await esm(join(ROOT, "scripts", "catalog-data.mjs"));
  assert.ok(CATALOG.length >= 25);
  for (const it of CATALOG) {
    assert.ok(TEMPLATE_INFO[it.model], `${it.id}: unknown model ${it.model}`);
    assert.equal(templateFor(it), it.model, it.id);
  }
  const demo = readFileSync(join(MOBILE, "lib", "demo.ts"), "utf8");
  const seeded = new Map<string, string>(CATALOG.map((i: { id: string; model: string }) => [i.id, i.model]));
  const rows = [...demo.matchAll(/item\("([a-z_]+)", "[^"]+", "[a-z]+", "([a-z_]+)"/g)];
  assert.ok(rows.length >= 15);
  for (const [, id, model] of rows) assert.equal(seeded.get(id!), model, `demo ${id}`);
});

test("editor option labels cover exactly the allowed ids", () => {
  const src = readFileSync(join(MOBILE, "constants", "avatarOptions.ts"), "utf8");
  const block = (name: string) => {
    const m = src.match(new RegExp(`export const ${name}[^=]*= \\[([\\s\\S]*?)\\];`));
    return [...(m?.[1] ?? "").matchAll(/id: "([a-z_]+)"/g)].map((x) => x[1]);
  };
  assert.deepEqual(block("HAIR_STYLES"), HAIR_STYLE_IDS);
  assert.deepEqual(block("FACE_SHAPES"), FACE_SHAPE_IDS);
  assert.deepEqual(block("EYEBROWS"), EYEBROW_IDS);
  assert.deepEqual(block("EYE_SHAPES"), EYE_SHAPE_IDS);
  assert.deepEqual(block("NOSE_SHAPES"), NOSE_SHAPE_IDS);
  assert.deepEqual(block("MOUTH_SHAPES"), MOUTH_SHAPE_IDS);
  assert.deepEqual(block("FACIAL_HAIR"), FACIAL_HAIR_IDS);
});

test("legacy catalog items without a model still map to a sensible template", () => {
  assert.equal(templateFor({ id: "top_stealth_hoodie", slot: "top" }), "top_hoodie");
  assert.equal(templateFor({ id: "outerwear_letterman", slot: "outerwear" }), "outerwear_varsity");
  assert.equal(templateFor({ id: "x", slot: "shoes", shape: "high-top" }), "shoes_hightop");
  assert.equal(templateFor({ id: "mystery", slot: "bottom" }), "bottom_shorts");
  assert.equal(templateFor({ id: "cap", slot: "hat", model: "top_tee" }), "hat_cap", "a model for the wrong slot is ignored");
  assert.equal(templateFor({ id: "remote", slot: "top", assetUrl: "https://x/y.glb" }), null);
});

test("equipping takes off whatever can't be worn with the new item, in both directions", () => {
  let r = applyEquip({ hat: "cap", top: "tee" }, "accessory", "cans", lookup);
  assert.deepEqual(r.equipped, { top: "tee", accessory: "cans" });
  assert.deepEqual(r.removed, ["hat"]);

  r = applyEquip({ accessory: "cans", top: "tee" }, "hat", "beanie", lookup);
  assert.deepEqual(r.equipped, { top: "tee", hat: "beanie" });
  assert.deepEqual(r.removed, ["accessory"]);

  r = applyEquip({ hat: "cap" }, "accessory", "chain", lookup);
  assert.deepEqual(r.equipped, { hat: "cap", accessory: "chain" });
  assert.deepEqual(r.removed, []);

  assert.deepEqual(applyEquip({ top: "tee" }, "bottom", "tee", lookup).equipped, { top: "tee" }, "wrong slot is a no-op");
  assert.deepEqual(applyEquip({ top: "tee" }, "top", null, lookup).equipped, {});
  assert.deepEqual(outfitConflicts({ hat: "cap", accessory: "cans" }, lookup), [["hat", "accessory"]]);
  assert.deepEqual(outfitConflicts({ hat: "cap", accessory: "chain" }, lookup), []);
});

test("appearance validation rejects bad values and sanitising fills defaults", () => {
  assert.deepEqual(appearanceErrors(DEFAULT_AVATAR), []);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, skinTone: "#ff00ff" }), ["skinTone"]);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, height: 2 }), ["height"]);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, hairStyle: "mohawk" }), ["hairStyle"]);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, isAdmin: true }), ["isAdmin"]);
  assert.deepEqual(appearanceErrors("nope"), ["avatar"]);

  const old = { height: 0.3, bodyType: 0.9, skinTone: "#c68642", hairStyle: "fade", hairColor: "#2B1B12" };
  assert.deepEqual(appearanceErrors(old), [], "pre-3D documents are still valid");
  const s = sanitizeAppearance(old);
  assert.equal(s.skinTone, "#C68642", "case is canonicalised");
  assert.equal(s.faceStyle, "features");
  assert.equal(s.base, "sd_base_v3");
  assert.equal(s.noseShape, "button");
  assert.equal(s.mouthShape, "neutral");
  assert.equal(sanitizeAppearance({ ...old, base: "sd_base_v1" }).base, "sd_base_v3", "the old base renders as its replacement");
  assert.equal(sanitizeAppearance({ ...old, base: "sd_base_v2" }).base, "sd_base_v3");
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, noseShape: "hooked" }), ["noseShape"]);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, mouthShape: "wide", eyeShape: "almond", facialHair: "goatee" }), []);
  assert.deepEqual(appearanceErrors({ ...DEFAULT_AVATAR, base: "sd_base_v1", faceStyle: "mannequin" }), [], "v1 looks still validate");
  assert.equal(sanitizeAppearance({ hairStyle: "mohawk", height: "tall" }).hairStyle, "short_crop");
  assert.equal(sanitizeAppearance(null).height, 0.5);
});

// ── renderer-side pure logic (artifacts/mobile/lib/avatar3d/outfit.ts) ───────

test("resolveOutfit picks templates, reports what it can't render, and lets a beanie cover hair over a cap", () => {
  const catalog = new Map<string, OutfitItem>(Object.values(CAT).map((i) => [i.id, i]));
  const o = resolveOutfit({ hat: "beanie", top: "hoodie", bottom: "ghost", shoes: "tee" }, catalog);
  assert.deepEqual(o.pieces.map((p) => [p.slot, p.template]), [["hat", "hat_beanie"], ["top", "top_hoodie"]]);
  assert.deepEqual(o.missing.sort(), ["ghost", "tee"]);
  assert.equal(o.hairMode, "covered");
  assert.equal(resolveOutfit({ hat: "cap" }, catalog).hairMode, "capped");
  assert.equal(resolveOutfit({ top: "tee" }, catalog).hairMode, null);
});

test("lookKey is stable for the same look and changes with anything visible", () => {
  const catalog = new Map<string, OutfitItem>(Object.values(CAT).map((i) => [i.id, i]));
  const a = DEFAULT_AVATAR;
  const o = resolveOutfit({ top: "tee", hat: "cap" }, catalog);
  const k = lookKey(a, o, "bust");
  assert.equal(lookKey({ ...a }, resolveOutfit({ hat: "cap", top: "tee" }, catalog), "bust"), k);
  assert.notEqual(lookKey(a, o, "full"), k);
  assert.notEqual(lookKey({ ...a, skinTone: "#7E8A93" }, o, "bust"), k);
  assert.notEqual(lookKey({ ...a, height: 0.9 }, o, "bust"), k);
  assert.notEqual(lookKey(a, resolveOutfit({ top: "hoodie", hat: "cap" }, catalog), "bust"), k);
  assert.notEqual(lookKey({ ...a, eyeColor: "#2E5FA3" }, o, "bust"), k, "eye colour is part of the look");
  assert.notEqual(lookKey({ ...a, eyebrows: "bold" }, o, "bust"), k);
  assert.notEqual(lookKey({ ...a, noseShape: "broad" }, o, "bust"), k);
  assert.notEqual(lookKey({ ...a, facialHair: "stubble" }, o, "bust"), k);
});

test("catalog overrides: hides, layer and hair mode, with template defaults otherwise", () => {
  assert.deepEqual(hidesOf({ id: "t", slot: "top", model: "top_hoodie" }), TEMPLATE_INFO.top_hoodie!.hides);
  assert.deepEqual(hidesOf({ id: "t", slot: "top", model: "top_tee", hides: ["chest", "bogus" as never] }), ["chest"]);
  assert.equal(hidesOf({ id: "r", slot: "top", assetUrl: "https://x/y.glb" }), null, "a remote asset's own metadata decides");
  assert.equal(layerOf({ id: "t", slot: "outerwear" }), SLOT_LAYER.outerwear);
  assert.equal(layerOf({ id: "t", slot: "top", layer: 7 }), 7);
  assert.equal(hairModeOf({ id: "h", slot: "hat", model: "hat_cap" }), "capped");
  assert.equal(hairModeOf({ id: "h", slot: "hat", model: "hat_cap", hairMode: null }), null);
  assert.equal(hairModeOf({ id: "h", slot: "hat", assetUrl: "https://x/h.glb", hairMode: "covered" }), "covered");
  const p = pieceFor({ id: "r", slot: "top", assetUrl: "https://x/y.glb", assetVersion: 3, color: "#fff", hides: ["chest"], layer: 4 })!;
  assert.deepEqual([p.url, p.version, p.hides, p.layer], ["https://x/y.glb", 3, ["chest"], 4]);
});

test("attachment specs: per-build offsets scale with the build slider, catalog overrides merge", () => {
  const spec = mergeAttach({ socket: "Neck", perBuild: { broad: { position: [0, 0, 0.01], scale: 1.2 } } }, { position: [0, 0.002, 0] });
  const mid = resolveAttach(spec, { build: 0.5 });
  assert.ok(Math.abs(mid.position[2] - 0.005) < 1e-9 && Math.abs(mid.position[1] - 0.002) < 1e-9);
  assert.ok(Math.abs(mid.scale[0] - Math.sqrt(1.2)) < 1e-9);
  assert.deepEqual(resolveAttach(spec, { build: -1 }).position, [0, 0.002, 0], "slim end has no entry");
});

test("Mixamo-prefixed bone names bind to the rig", () => {
  assert.equal(rigName("mixamorig:LeftForeArm"), "LeftForeArm");
  assert.equal(rigName("mixamorigHips"), "Hips");
  assert.equal(rigName("mixamorig1_Spine2"), "Spine2");
  assert.equal(rigName("Socket_HeadTop"), "Socket_HeadTop");
});

// ── asset validator ─────────────────────────────────────────────────────────

test("the asset validator passes every bundled asset and catches broken ones", async () => {
  const { validateGlb } = await esm(join(MOBILE, "scripts", "avatar", "validate.mjs"));
  for (const f of readdirSync(ASSETS).filter((x) => x.endsWith(".glb"))) {
    const r = validateGlb(join(ASSETS, f));
    assert.ok(r.ok, `${f}: ${r.errors.join("; ")}`);
  }

  const dir = mkdtempSync(join(tmpdir(), "sdavatar-"));
  const src = readGlb(join(ASSETS, "top_tee.glb"));
  const broken = (name: string, mutate: (j: any) => void) => {
    const j = JSON.parse(JSON.stringify(src.json));
    mutate(j);
    const f = join(dir, `${name}.glb`);
    writeGlb(f, j, src.rest);
    return validateGlb(f);
  };

  const wrongRig = broken("top_tee", (j) => (j.scenes[0].extras.sdAvatar.rig = "mixamo"));
  assert.ok(!wrongRig.ok && wrongRig.errors.some((e: string) => /rig/.test(e)));

  const noMeta = broken("nometa", (j) => delete j.scenes[0].extras);
  assert.ok(!noMeta.ok && noMeta.errors.some((e: string) => /sdAvatar/.test(e)));

  const badSlot = broken("badslot", (j) => (j.scenes[0].extras.sdAvatar.slot = "cape"));
  assert.ok(!badSlot.ok && badSlot.errors.some((e: string) => /slot/.test(e)));

  const renamedBone = broken("bone", (j) => {
    const n = j.nodes.find((x: { name: string }) => x.name === "LeftForeArm");
    n.name = "forearm.L";
  });
  assert.ok(!renamedBone.ok, "a garment on a different skeleton is rejected");

  const mixamo = broken("mixamo", (j) => {
    for (const n of j.nodes) if (["Hips", "Spine", "LeftForeArm"].includes(n.name)) n.name = `mixamorig:${n.name}`;
  });
  assert.ok(mixamo.ok, `Blender's Mixamo prefix is fine: ${mixamo.errors.join("; ")}`);

  const badHides = broken("hides", (j) => (j.scenes[0].extras.sdAvatar.hides = ["torso"]));
  assert.ok(!badHides.ok && badHides.errors.some((e: string) => /region/.test(e)));

  writeFileSync(join(dir, "junk.glb"), "not a glb");
  assert.ok(!validateGlb(join(dir, "junk.glb")).ok);
});

test("no garment shows skin through cloth, and each covers every body region it hides", async () => {
  const { fitCheck, hideCoverage } = await esm(join(MOBILE, "scripts", "avatar", "fitcheck.mjs"));
  const base = join(ASSETS, "sd_base_v3.glb");
  for (const k of Object.keys(TEMPLATE_INFO)) {
    const file = join(ASSETS, `${k}.glb`);
    // Headphone cups enclose the ears; the creases behind them are false positives (fitcheck.mjs).
    if (k !== "acc_headphones") {
      const r = fitCheck(base, file);
      assert.ok(r.covered > 0, `${k} covers nothing`);
      assert.ok(r.poke / r.covered <= 0.015, `${k}: ${r.poke} of ${r.covered} covered skin vertices show through`);
    }
    const hides = TEMPLATE_INFO[k]!.hides;
    if (!hides.length) continue;
    const cov = hideCoverage(base, file);
    for (const region of hides) assert.equal(cov[region].clear, cov[region].verts, `${k} doesn't fully cover ${region}`);
  }
  // The base layer stands in for bottoms over the hips.
  const uw = hideCoverage(base, base, { cover: (m: { name: string }) => m.name === "Underwear" });
  assert.equal(uw.hips.clear, uw.hips.verts, "base layer covers the hips");
});

test("every preset outfit stays inside the 30k-triangle mobile budget", async () => {
  const { drawnTriangles, AVATAR_TRIS } = await esm(join(MOBILE, "scripts", "avatar", "budget.mjs"));
  const { CATALOG } = await esm(join(ROOT, "scripts", "catalog-data.mjs"));
  const model = new Map<string, string>(CATALOG.map((i: { id: string; model: string }) => [i.id, i.model]));
  const looks = [{}, { hairStyle: "long", facialHair: "beard", faceShape: "square" }, { hairStyle: "afro", facialHair: "goatee" }];
  for (const preset of OUTFIT_PRESETS) {
    const templates = Object.values(preset.items).map((id) => model.get(id!)!);
    for (const look of looks) {
      const r = drawnTriangles(templates, look, ASSETS);
      assert.ok(r.total <= AVATAR_TRIS, `${preset.id} ${JSON.stringify(look)}: ${r.total} triangles ${JSON.stringify(r.parts)}`);
    }
  }
});

// ── callables ───────────────────────────────────────────────────────────────

test("saveAppearance writes appearance and outfit together", async () => {
  seedUser("ana");
  seedCatalog();
  own("ana", "beanie", "hoodie", "shorts");
  const look = { ...DEFAULT_AVATAR, skinTone: "#7E8A93", hairStyle: "afro", faceStyle: "features" as const };
  const res = await call<{ equipped: Record<string, string> }>(saveAppearance, "ana", {
    avatar: look,
    equipped: { hat: "beanie", top: "hoodie", bottom: "shorts", shoes: null },
  });
  assert.deepEqual(res.equipped, { hat: "beanie", top: "hoodie", bottom: "shorts" });
  const user = db.read("users/ana")!;
  assert.deepEqual(user.avatar, look);
  assert.deepEqual(user.equipped, { hat: "beanie", top: "hoodie", bottom: "shorts" });
});

test("saveAppearance is all-or-nothing: unowned, wrong-slot, conflicting or invalid looks write nothing", async () => {
  seedUser("ben");
  seedCatalog();
  own("ben", "cap", "cans", "tee");
  const before = JSON.stringify(db.read("users/ben"));
  const ok = { ...DEFAULT_AVATAR, hairStyle: "long" };

  await rejects(call(saveAppearance, "ben", { avatar: ok, equipped: { top: "hoodie" } }), /don't own/);
  await rejects(call(saveAppearance, "ben", { avatar: ok, equipped: { bottom: "tee" } }), /wrong slot/);
  await rejects(call(saveAppearance, "ben", { avatar: ok, equipped: { hat: "cap", accessory: "cans" } }), /can't be worn together/);
  await rejects(call(saveAppearance, "ben", { avatar: { ...ok, skinTone: "#00ff00" }, equipped: {} }), /skinTone/);
  await rejects(call(saveAppearance, "ben", { avatar: ok, equipped: { cape: "tee" } }), /./);
  await rejects(call(saveAppearance, null, { avatar: ok, equipped: {} }), /./);
  assert.equal(JSON.stringify(db.read("users/ben")), before);
});

test("equipItem clears incompatible slots and reports them", async () => {
  seedUser("cy");
  seedCatalog();
  own("cy", "cap", "cans", "tee");
  await call(equipItem, "cy", { slot: "hat", itemId: "cap" });
  await call(equipItem, "cy", { slot: "top", itemId: "tee" });
  const r = await call<{ removed: string[] }>(equipItem, "cy", { slot: "accessory", itemId: "cans" });
  assert.deepEqual(r.removed, ["hat"]);
  assert.deepEqual(db.read("users/cy")!.equipped, { top: "tee", accessory: "cans" });
  await call(equipItem, "cy", { slot: "accessory", itemId: null });
  assert.deepEqual(db.read("users/cy")!.equipped, { top: "tee" });
  await rejects(call(equipItem, "cy", { slot: "top", itemId: "hoodie" }), /don't own/);
});

test("updateAvatar and createProfile validate appearance against the shared rules", async () => {
  seedUser("dee");
  await rejects(call(updateAvatar, "dee", { avatar: { ...DEFAULT_AVATAR, hairStyle: "mohawk" } }), /hairStyle/);
  await call(updateAvatar, "dee", { avatar: { ...DEFAULT_AVATAR, hairStyle: "braids" } });
  assert.equal((db.read("users/dee")!.avatar as { hairStyle: string }).hairStyle, "braids");

  await call(createProfile, "eve", { username: "eve_1", displayName: "Eve" });
  assert.deepEqual(db.read("users/eve")!.avatar, DEFAULT_AVATAR);
  await rejects(
    call(createProfile, "fay", { username: "fay_1", displayName: "Fay", avatar: { ...DEFAULT_AVATAR, faceShape: "triangle" } }),
    /faceShape/
  );
  assert.equal(db.read("users/fay"), undefined);
});

/**
 * Avatar rules shared by the app and Cloud Functions.
 *
 * This file is copied byte-for-byte to functions/src/lib/avatarRules.ts — the
 * functions test suite fails if the two differ. Keep it dependency-free (no
 * imports, no path aliases) so it compiles in both projects.
 *
 *  - allowed appearance values (every id names a mesh variant in the base GLB,
 *    or a hair_<style> / beard_<style> asset)
 *  - garment templates: slot, hair handling, slots they rule out, body
 *    regions they hide, layer
 *  - which template a catalog item renders with
 *  - what equipping an item takes off
 */

export type Slot = "hat" | "top" | "outerwear" | "bottom" | "shoes" | "eyewear" | "accessory";
export const SLOTS: Slot[] = ["hat", "eyewear", "top", "outerwear", "bottom", "shoes", "accessory"];

export type FaceStyle = "mannequin" | "features";
/**
 * How a head item treats the hair under it. Each mode is a fit volume shared
 * by the item and every hairstyle (scripts/avatar/fit.mjs): hair is pressed
 * inside the item's covered region and flares back out below its edge.
 */
export type HairMode = "capped" | "covered" | "helmet" | "banded";
export const HAIR_MODES: HairMode[] = ["capped", "covered", "helmet", "banded"];

/**
 * The base body is split into these regions (one mesh each, Body_<region>).
 * A garment lists the regions it covers completely; the renderer hides them
 * while it's worn, so skin can never poke through it, even mid-animation.
 */
export type BodyRegion =
  | "neck" | "shoulders" | "chest" | "abdomen" | "waist" | "hips" | "upperArms" | "elbows"
  | "forearms" | "hands" | "thighs" | "knees" | "shins" | "ankles" | "feet";
export const BODY_REGIONS: BodyRegion[] = [
  "neck", "shoulders", "chest", "abdomen", "waist", "hips", "upperArms", "elbows",
  "forearms", "hands", "thighs", "knees", "shins", "ankles", "feet",
];

/** Draw order of worn layers, inner → outer (a depth bias between coincident surfaces). */
export const SLOT_LAYER: Record<Slot, number> = { shoes: 1, bottom: 2, top: 3, outerwear: 4, hat: 5, eyewear: 5, accessory: 5 };

export interface AvatarConfig {
  /** 0..1 → about ±7% overall scale around the base height. */
  height: number;
  /** 0..1 → slim to broad. */
  bodyType: number;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  faceShape?: string;
  eyeColor?: string;
  /** Eyelid shape — round, almond, sleepy. */
  eyeShape?: string;
  eyebrows?: string;
  /** none, stubble, goatee, beard. */
  facialHair?: string;
  /** button, straight, broad (a blendshape on the head). */
  noseShape?: string;
  /** neutral, full, wide (blendshapes on the head). */
  mouthShape?: string;
  /**
   * Legacy. sd_base_v1 offered a featureless mannequin face; sd_base_v2 always
   * has eyes, brows, lashes and a mouth. Kept so older documents validate.
   */
  faceStyle?: FaceStyle;
  /** Base character asset id. Lets a future base ship without migrating anyone. */
  base?: string;
}

export type Equipped = Partial<Record<Slot, string>>;

/**
 * Base characters a saved look may name. Older keys stay valid (documents
 * written before them must still pass validation) and render as their
 * replacement — see LEGACY_BASE.
 */
export const BASE_MODELS = ["sd_base_v3", "sd_base_v2", "sd_base_v1"];
export const DEFAULT_BASE = "sd_base_v3";
/** sd_base_v1 was the articulated mannequin, v2 the realistic procedural body; v3 replaced both. */
export const LEGACY_BASE: Record<string, string> = { sd_base_v1: "sd_base_v3", sd_base_v2: "sd_base_v3" };

export const SKIN_TONES = [
  // Human range, spanning the Fitzpatrick scale.
  "#F5D9C4", "#EFC8A6", "#E5B18C", "#D69F72", "#C68642", "#A9683A", "#8D5524", "#6B3F1D", "#4E2C13", "#33200D",
  // Stylised finishes (kept from the mannequin base; saved looks may use them).
  "#D8C3A5", "#C2A47E", "#EDE6DA", "#7E8A93",
];
export const HAIR_COLORS = [
  "#0F0A08", "#2B1B12", "#4A2C1A", "#6F4023", "#A9662E", "#C9963F",
  "#E0C088", "#9E9E9E", "#E8E8E8", "#B03030", "#2E5FA3", "#5B3A8C",
];
export const EYE_COLORS = ["#3B2415", "#6B4423", "#4A7C59", "#2E5FA3", "#6E7B8B", "#1A202C"];
export const HAIR_STYLE_IDS = ["buzz", "short_crop", "fade", "curls", "afro", "braids", "long", "ponytail", "bald"];
export const FACE_SHAPE_IDS = ["oval", "round", "square", "heart"];
export const EYE_SHAPE_IDS = ["round", "almond", "sleepy"];
export const EYEBROW_IDS = ["soft", "arched", "bold", "none"];
export const FACIAL_HAIR_IDS = ["none", "stubble", "goatee", "beard"];
export const NOSE_SHAPE_IDS = ["button", "straight", "broad"];
export const MOUTH_SHAPE_IDS = ["neutral", "full", "wide"];
export const FACE_STYLE_IDS: FaceStyle[] = ["mannequin", "features"];

export const DEFAULT_AVATAR: AvatarConfig = {
  height: 0.5,
  bodyType: 0.5,
  skinTone: "#E5B18C",
  hairStyle: "short_crop",
  hairColor: "#2B1B12",
  faceShape: "oval",
  eyeColor: "#3B2415",
  eyeShape: "round",
  eyebrows: "soft",
  facialHair: "none",
  noseShape: "button",
  mouthShape: "neutral",
  faceStyle: "features",
  base: DEFAULT_BASE,
};

export interface TemplateInfo {
  slot: Slot;
  hairMode: HairMode | null;
  excludes: Slot[];
  /** Body regions the garment covers completely (hidden while it's worn). */
  hides: BodyRegion[];
}

/**
 * Every bundled garment template. Must match the `sdAvatar` metadata inside
 * assets/avatar/<id>.glb — the asset tests compare them, and fitcheck.mjs
 * proves each garment really covers the regions it hides.
 */
export const TEMPLATE_INFO: Record<string, TemplateInfo> = {
  hat_cap: { slot: "hat", hairMode: "capped", excludes: [], hides: [] },
  hat_beanie: { slot: "hat", hairMode: "covered", excludes: [], hides: [] },
  hat_bucket: { slot: "hat", hairMode: "covered", excludes: [], hides: [] },
  hat_helmet: { slot: "hat", hairMode: "helmet", excludes: [], hides: [] },
  hat_crown: { slot: "hat", hairMode: null, excludes: [], hides: [] },
  eyewear_shades: { slot: "eyewear", hairMode: null, excludes: [], hides: [] },
  top_tee: { slot: "top", hairMode: null, excludes: [], hides: ["chest", "abdomen"] },
  top_longsleeve: { slot: "top", hairMode: null, excludes: [], hides: ["chest", "abdomen"] },
  top_jersey: { slot: "top", hairMode: null, excludes: [], hides: [] },
  top_hoodie: { slot: "top", hairMode: null, excludes: [], hides: ["chest", "abdomen", "waist"] },
  outerwear_bomber: { slot: "outerwear", hairMode: null, excludes: [], hides: ["chest"] },
  outerwear_varsity: { slot: "outerwear", hairMode: null, excludes: [], hides: ["shoulders", "chest", "abdomen", "elbows"] },
  outerwear_puffer: { slot: "outerwear", hairMode: null, excludes: [], hides: ["chest"] },
  outerwear_bomber_open: { slot: "outerwear", hairMode: null, excludes: [], hides: [] },
  outerwear_varsity_open: { slot: "outerwear", hairMode: null, excludes: [], hides: ["elbows"] },
  bottom_shorts: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips"] },
  bottom_pants: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips", "thighs", "knees"] },
  bottom_joggers: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips", "thighs", "knees"] },
  shoes_sneaker: { slot: "shoes", hairMode: null, excludes: [], hides: [] },
  shoes_hightop: { slot: "shoes", hairMode: null, excludes: [], hides: ["feet"] },
  acc_chain: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_star: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_bolt: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_crown: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_heart: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_ball: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_football: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_trophy: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_number: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_diamond: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_dogtag: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_chain_cuban: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_watch: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
  acc_headphones: { slot: "accessory", hairMode: "banded", excludes: ["hat"], hides: [] },
};

/** The catalog fields these rules read. */
export interface ItemLike {
  id: string;
  slot: Slot;
  model?: string | null;
  assetUrl?: string | null;
  shape?: string | null;
  excludes?: Slot[] | null;
  /** Overrides the asset's hair handling (a remote hat that sits on top of the hair: null). */
  hairMode?: HairMode | null;
  /** Overrides the asset's hidden body regions. */
  hides?: BodyRegion[] | null;
  /** Overrides the slot's layer (SLOT_LAYER). */
  layer?: number | null;
}

/** When two worn items both press the hair, the one that covers more wins. */
export const HAIR_MODE_PRIORITY: Record<HairMode, number> = { banded: 1, capped: 2, covered: 3, helmet: 4 };

/** Default silhouette per slot, refined by `shape` or the item id. First match wins. */
const INFER: Array<[Slot, RegExp, string]> = [
  ["hat", /helmet/, "hat_helmet"],
  ["hat", /crown|tiara/, "hat_crown"],
  ["hat", /beanie/, "hat_beanie"],
  ["hat", /bucket/, "hat_bucket"],
  ["hat", /./, "hat_cap"],
  ["top", /hood/, "top_hoodie"],
  ["top", /jersey|tank/, "top_jersey"],
  ["top", /long/, "top_longsleeve"],
  ["top", /./, "top_tee"],
  ["outerwear", /open.*(varsity|letterman)|(varsity|letterman).*open/, "outerwear_varsity_open"],
  ["outerwear", /open/, "outerwear_bomber_open"],
  ["outerwear", /varsity|letterman/, "outerwear_varsity"],
  ["outerwear", /puffer|parka/, "outerwear_puffer"],
  ["outerwear", /./, "outerwear_bomber"],
  ["bottom", /jogger/, "bottom_joggers"],
  ["bottom", /pant|jean|trouser/, "bottom_pants"],
  ["bottom", /./, "bottom_shorts"],
  ["shoes", /high|boot/, "shoes_hightop"],
  ["shoes", /./, "shoes_sneaker"],
  ["eyewear", /./, "eyewear_shades"],
  ["accessory", /watch/, "acc_watch"],
  ["accessory", /headphone/, "acc_headphones"],
  ["accessory", /./, "acc_chain"],
];

/**
 * The template an item renders with: its explicit `model`, else a best guess
 * from shape/id so documents written before models existed still render.
 * Null for a remote-asset item (`assetUrl`) or when nothing fits the slot.
 */
export function templateFor(item: ItemLike): string | null {
  if (item.assetUrl) return null;
  if (item.model && TEMPLATE_INFO[item.model]?.slot === item.slot) return item.model;
  const hint = `${item.shape ?? ""} ${item.id}`.toLowerCase();
  for (const [slot, re, key] of INFER) {
    if (slot === item.slot && re.test(hint) && TEMPLATE_INFO[key]?.slot === slot) return key;
  }
  return null;
}

/** Hair handling under this item (hats), or null. */
export function hairModeOf(item: ItemLike): HairMode | null {
  if (item.hairMode === null || HAIR_MODES.includes(item.hairMode as HairMode)) return item.hairMode ?? null;
  const t = templateFor(item);
  if (t) return TEMPLATE_INFO[t]?.hairMode ?? null;
  return item.slot === "hat" ? "capped" : null;
}

/**
 * Body regions hidden under an item: its own `hides`, else its template's.
 * Null for a remote asset without an override — the asset's metadata decides.
 */
export function hidesOf(item: ItemLike): BodyRegion[] | null {
  if (Array.isArray(item.hides)) return item.hides.filter((r) => BODY_REGIONS.includes(r));
  const t = templateFor(item);
  return t ? (TEMPLATE_INFO[t]?.hides ?? []) : null;
}

/** Layer of an item: its own, else its slot's. */
export function layerOf(item: ItemLike): number {
  return typeof item.layer === "number" && Number.isFinite(item.layer) ? item.layer : SLOT_LAYER[item.slot];
}

/** Slots an item can't be worn with: its own `excludes`, else its template's. */
export function excludesOf(item: ItemLike): Slot[] {
  if (item.excludes && item.excludes.length) return item.excludes.filter((s) => s !== item.slot);
  const t = templateFor(item);
  return t ? (TEMPLATE_INFO[t]?.excludes ?? []) : [];
}

/** True when the two items can't be worn together (either one rules out the other's slot). */
export function conflicts(a: ItemLike, b: ItemLike): boolean {
  return excludesOf(a).includes(b.slot) || excludesOf(b).includes(a.slot);
}

/**
 * Puts `itemId` in `slot` (or clears it when null) and takes off anything
 * that can't be worn with it. Returns the new outfit and the slots cleared.
 * An unknown or wrong-slot item leaves the outfit unchanged.
 */
export function applyEquip(
  equipped: Equipped,
  slot: Slot,
  itemId: string | null,
  lookup: (id: string) => ItemLike | undefined
): { equipped: Equipped; removed: Slot[] } {
  const next: Equipped = { ...equipped };
  if (!itemId) {
    delete next[slot];
    return { equipped: next, removed: [] };
  }
  const item = lookup(itemId);
  if (!item || item.slot !== slot) return { equipped: { ...equipped }, removed: [] };
  next[slot] = itemId;
  const removed: Slot[] = [];
  for (const s of SLOTS) {
    const otherId = next[s];
    if (s === slot || !otherId) continue;
    const other = lookup(otherId);
    if (other && conflicts(item, other)) {
      delete next[s];
      removed.push(s);
    }
  }
  return { equipped: next, removed };
}

/** Pairs of equipped slots that can't be worn together. Empty when the outfit is valid. */
export function outfitConflicts(equipped: Equipped, lookup: (id: string) => ItemLike | undefined): Array<[Slot, Slot]> {
  const out: Array<[Slot, Slot]> = [];
  const worn = SLOTS.filter((s) => equipped[s]);
  for (let i = 0; i < worn.length; i++) {
    for (let j = i + 1; j < worn.length; j++) {
      const a = lookup(equipped[worn[i]!]!);
      const b = lookup(equipped[worn[j]!]!);
      if (a && b && conflicts(a, b)) out.push([worn[i]!, worn[j]!]);
    }
  }
  return out;
}

const inList = (v: unknown, list: string[]) =>
  typeof v === "string" ? list.find((c) => c.toLowerCase() === v.toLowerCase()) : undefined;
/**
 * Skin, hair and eye colours: one of the preset swatches (canonical casing), or
 * any custom #RRGGBB from the colour wheel, upper-cased so equal colours compare equal.
 */
const HEX6 = /^#[0-9a-f]{6}$/i;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX6.test(v);
const colorIn = (v: unknown, list: string[]) => inList(v, list) ?? (isHexColor(v) ? v.toUpperCase() : undefined);
const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);

/**
 * Problems with an appearance, as field names. Empty means valid. Used by the
 * server to reject a bad save outright rather than silently "fixing" it.
 */
export function appearanceErrors(a: unknown): string[] {
  if (!a || typeof a !== "object") return ["avatar"];
  const x = a as Record<string, unknown>;
  const errs: string[] = [];
  if (unit(x.height) === undefined || x.height !== unit(x.height)) errs.push("height");
  if (unit(x.bodyType) === undefined || x.bodyType !== unit(x.bodyType)) errs.push("bodyType");
  if (!colorIn(x.skinTone, SKIN_TONES)) errs.push("skinTone");
  if (!inList(x.hairStyle, HAIR_STYLE_IDS)) errs.push("hairStyle");
  if (!colorIn(x.hairColor, HAIR_COLORS)) errs.push("hairColor");
  if (x.faceShape !== undefined && !inList(x.faceShape, FACE_SHAPE_IDS)) errs.push("faceShape");
  if (x.eyeColor !== undefined && !colorIn(x.eyeColor, EYE_COLORS)) errs.push("eyeColor");
  if (x.eyeShape !== undefined && !inList(x.eyeShape, EYE_SHAPE_IDS)) errs.push("eyeShape");
  if (x.eyebrows !== undefined && !inList(x.eyebrows, EYEBROW_IDS)) errs.push("eyebrows");
  if (x.facialHair !== undefined && !inList(x.facialHair, FACIAL_HAIR_IDS)) errs.push("facialHair");
  if (x.noseShape !== undefined && !inList(x.noseShape, NOSE_SHAPE_IDS)) errs.push("noseShape");
  if (x.mouthShape !== undefined && !inList(x.mouthShape, MOUTH_SHAPE_IDS)) errs.push("mouthShape");
  if (x.faceStyle !== undefined && !inList(x.faceStyle, FACE_STYLE_IDS)) errs.push("faceStyle");
  if (x.base !== undefined && !inList(x.base, BASE_MODELS)) errs.push("base");
  const known = ["height", "bodyType", "skinTone", "hairStyle", "hairColor", "faceShape", "eyeColor", "eyeShape", "eyebrows", "facialHair", "noseShape", "mouthShape", "faceStyle", "base"];
  for (const k of Object.keys(x)) if (!known.includes(k)) errs.push(k);
  return errs;
}

/**
 * Any stored or partial appearance as a complete valid one: unknown values
 * fall back to defaults, so a document from an older (or newer) client still
 * renders a character instead of failing.
 */
export function sanitizeAppearance(a: unknown): AvatarConfig {
  const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const d = DEFAULT_AVATAR;
  return {
    height: unit(x.height) ?? d.height,
    bodyType: unit(x.bodyType) ?? d.bodyType,
    skinTone: colorIn(x.skinTone, SKIN_TONES) ?? d.skinTone,
    hairStyle: inList(x.hairStyle, HAIR_STYLE_IDS) ?? d.hairStyle,
    hairColor: colorIn(x.hairColor, HAIR_COLORS) ?? d.hairColor,
    faceShape: inList(x.faceShape, FACE_SHAPE_IDS) ?? d.faceShape,
    eyeColor: colorIn(x.eyeColor, EYE_COLORS) ?? d.eyeColor,
    eyeShape: inList(x.eyeShape, EYE_SHAPE_IDS) ?? d.eyeShape,
    eyebrows: inList(x.eyebrows, EYEBROW_IDS) ?? d.eyebrows,
    facialHair: inList(x.facialHair, FACIAL_HAIR_IDS) ?? d.facialHair,
    noseShape: inList(x.noseShape, NOSE_SHAPE_IDS) ?? d.noseShape,
    mouthShape: inList(x.mouthShape, MOUTH_SHAPE_IDS) ?? d.mouthShape,
    faceStyle: (inList(x.faceStyle, FACE_STYLE_IDS) as FaceStyle | undefined) ?? d.faceStyle,
    base: (() => {
      const b = inList(x.base, BASE_MODELS) ?? DEFAULT_BASE;
      return LEGACY_BASE[b] ?? b;
    })(),
  };
}

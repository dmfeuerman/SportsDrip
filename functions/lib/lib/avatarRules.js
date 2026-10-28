"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HAIR_MODE_PRIORITY = exports.TEMPLATE_INFO = exports.DEFAULT_AVATAR = exports.FACE_STYLE_IDS = exports.MOUTH_SHAPE_IDS = exports.NOSE_SHAPE_IDS = exports.FACIAL_HAIR_IDS = exports.EYEBROW_IDS = exports.EYE_SHAPE_IDS = exports.FACE_SHAPE_IDS = exports.HAIR_STYLE_IDS = exports.EYE_COLORS = exports.HAIR_COLORS = exports.SKIN_TONES = exports.LEGACY_BASE = exports.DEFAULT_BASE = exports.BASE_MODELS = exports.SLOT_LAYER = exports.BODY_REGIONS = exports.HAIR_MODES = exports.SLOTS = void 0;
exports.templateFor = templateFor;
exports.hairModeOf = hairModeOf;
exports.hidesOf = hidesOf;
exports.layerOf = layerOf;
exports.excludesOf = excludesOf;
exports.conflicts = conflicts;
exports.applyEquip = applyEquip;
exports.outfitConflicts = outfitConflicts;
exports.appearanceErrors = appearanceErrors;
exports.sanitizeAppearance = sanitizeAppearance;
exports.SLOTS = ["hat", "eyewear", "top", "outerwear", "bottom", "shoes", "accessory"];
exports.HAIR_MODES = ["capped", "covered", "helmet", "banded"];
exports.BODY_REGIONS = [
    "neck", "shoulders", "chest", "abdomen", "waist", "hips", "upperArms", "elbows",
    "forearms", "hands", "thighs", "knees", "shins", "ankles", "feet",
];
/** Draw order of worn layers, inner → outer (a depth bias between coincident surfaces). */
exports.SLOT_LAYER = { shoes: 1, bottom: 2, top: 3, outerwear: 4, hat: 5, eyewear: 5, accessory: 5 };
/**
 * Base characters a saved look may name. Older keys stay valid (documents
 * written before them must still pass validation) and render as their
 * replacement — see LEGACY_BASE.
 */
exports.BASE_MODELS = ["sd_base_v3", "sd_base_v2", "sd_base_v1"];
exports.DEFAULT_BASE = "sd_base_v3";
/** sd_base_v1 was the articulated mannequin, v2 the realistic procedural body; v3 replaced both. */
exports.LEGACY_BASE = { sd_base_v1: "sd_base_v3", sd_base_v2: "sd_base_v3" };
exports.SKIN_TONES = [
    // Human range, spanning the Fitzpatrick scale.
    "#F5D9C4", "#EFC8A6", "#E5B18C", "#D69F72", "#C68642", "#A9683A", "#8D5524", "#6B3F1D", "#4E2C13", "#33200D",
    // Stylised finishes (kept from the mannequin base; saved looks may use them).
    "#D8C3A5", "#C2A47E", "#EDE6DA", "#7E8A93",
];
exports.HAIR_COLORS = [
    "#0F0A08", "#2B1B12", "#4A2C1A", "#6F4023", "#A9662E", "#C9963F",
    "#E0C088", "#9E9E9E", "#E8E8E8", "#B03030", "#2E5FA3", "#5B3A8C",
];
exports.EYE_COLORS = ["#3B2415", "#6B4423", "#4A7C59", "#2E5FA3", "#6E7B8B", "#1A202C"];
exports.HAIR_STYLE_IDS = ["buzz", "short_crop", "fade", "curls", "afro", "braids", "long", "ponytail", "bald"];
exports.FACE_SHAPE_IDS = ["oval", "round", "square", "heart"];
exports.EYE_SHAPE_IDS = ["round", "almond", "sleepy"];
exports.EYEBROW_IDS = ["soft", "arched", "bold", "none"];
exports.FACIAL_HAIR_IDS = ["none", "stubble", "goatee", "beard"];
exports.NOSE_SHAPE_IDS = ["button", "straight", "broad"];
exports.MOUTH_SHAPE_IDS = ["neutral", "full", "wide"];
exports.FACE_STYLE_IDS = ["mannequin", "features"];
exports.DEFAULT_AVATAR = {
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
    base: exports.DEFAULT_BASE,
};
/**
 * Every bundled garment template. Must match the `sdAvatar` metadata inside
 * assets/avatar/<id>.glb — the asset tests compare them, and fitcheck.mjs
 * proves each garment really covers the regions it hides.
 */
exports.TEMPLATE_INFO = {
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
    bottom_shorts: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips"] },
    bottom_pants: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips", "thighs", "knees"] },
    bottom_joggers: { slot: "bottom", hairMode: null, excludes: [], hides: ["hips", "thighs", "knees"] },
    shoes_sneaker: { slot: "shoes", hairMode: null, excludes: [], hides: [] },
    shoes_hightop: { slot: "shoes", hairMode: null, excludes: [], hides: ["feet"] },
    acc_chain: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
    acc_watch: { slot: "accessory", hairMode: null, excludes: [], hides: [] },
    acc_headphones: { slot: "accessory", hairMode: "banded", excludes: ["hat"], hides: [] },
};
/** When two worn items both press the hair, the one that covers more wins. */
exports.HAIR_MODE_PRIORITY = { banded: 1, capped: 2, covered: 3, helmet: 4 };
/** Default silhouette per slot, refined by `shape` or the item id. First match wins. */
const INFER = [
    ["hat", /helmet/, "hat_helmet"],
    ["hat", /crown|tiara/, "hat_crown"],
    ["hat", /beanie/, "hat_beanie"],
    ["hat", /bucket/, "hat_bucket"],
    ["hat", /./, "hat_cap"],
    ["top", /hood/, "top_hoodie"],
    ["top", /jersey|tank/, "top_jersey"],
    ["top", /long/, "top_longsleeve"],
    ["top", /./, "top_tee"],
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
function templateFor(item) {
    if (item.assetUrl)
        return null;
    if (item.model && exports.TEMPLATE_INFO[item.model]?.slot === item.slot)
        return item.model;
    const hint = `${item.shape ?? ""} ${item.id}`.toLowerCase();
    for (const [slot, re, key] of INFER) {
        if (slot === item.slot && re.test(hint) && exports.TEMPLATE_INFO[key]?.slot === slot)
            return key;
    }
    return null;
}
/** Hair handling under this item (hats), or null. */
function hairModeOf(item) {
    if (item.hairMode === null || exports.HAIR_MODES.includes(item.hairMode))
        return item.hairMode ?? null;
    const t = templateFor(item);
    if (t)
        return exports.TEMPLATE_INFO[t]?.hairMode ?? null;
    return item.slot === "hat" ? "capped" : null;
}
/**
 * Body regions hidden under an item: its own `hides`, else its template's.
 * Null for a remote asset without an override — the asset's metadata decides.
 */
function hidesOf(item) {
    if (Array.isArray(item.hides))
        return item.hides.filter((r) => exports.BODY_REGIONS.includes(r));
    const t = templateFor(item);
    return t ? (exports.TEMPLATE_INFO[t]?.hides ?? []) : null;
}
/** Layer of an item: its own, else its slot's. */
function layerOf(item) {
    return typeof item.layer === "number" && Number.isFinite(item.layer) ? item.layer : exports.SLOT_LAYER[item.slot];
}
/** Slots an item can't be worn with: its own `excludes`, else its template's. */
function excludesOf(item) {
    if (item.excludes && item.excludes.length)
        return item.excludes.filter((s) => s !== item.slot);
    const t = templateFor(item);
    return t ? (exports.TEMPLATE_INFO[t]?.excludes ?? []) : [];
}
/** True when the two items can't be worn together (either one rules out the other's slot). */
function conflicts(a, b) {
    return excludesOf(a).includes(b.slot) || excludesOf(b).includes(a.slot);
}
/**
 * Puts `itemId` in `slot` (or clears it when null) and takes off anything
 * that can't be worn with it. Returns the new outfit and the slots cleared.
 * An unknown or wrong-slot item leaves the outfit unchanged.
 */
function applyEquip(equipped, slot, itemId, lookup) {
    const next = { ...equipped };
    if (!itemId) {
        delete next[slot];
        return { equipped: next, removed: [] };
    }
    const item = lookup(itemId);
    if (!item || item.slot !== slot)
        return { equipped: { ...equipped }, removed: [] };
    next[slot] = itemId;
    const removed = [];
    for (const s of exports.SLOTS) {
        const otherId = next[s];
        if (s === slot || !otherId)
            continue;
        const other = lookup(otherId);
        if (other && conflicts(item, other)) {
            delete next[s];
            removed.push(s);
        }
    }
    return { equipped: next, removed };
}
/** Pairs of equipped slots that can't be worn together. Empty when the outfit is valid. */
function outfitConflicts(equipped, lookup) {
    const out = [];
    const worn = exports.SLOTS.filter((s) => equipped[s]);
    for (let i = 0; i < worn.length; i++) {
        for (let j = i + 1; j < worn.length; j++) {
            const a = lookup(equipped[worn[i]]);
            const b = lookup(equipped[worn[j]]);
            if (a && b && conflicts(a, b))
                out.push([worn[i], worn[j]]);
        }
    }
    return out;
}
const inList = (v, list) => typeof v === "string" ? list.find((c) => c.toLowerCase() === v.toLowerCase()) : undefined;
const unit = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
/**
 * Problems with an appearance, as field names. Empty means valid. Used by the
 * server to reject a bad save outright rather than silently "fixing" it.
 */
function appearanceErrors(a) {
    if (!a || typeof a !== "object")
        return ["avatar"];
    const x = a;
    const errs = [];
    if (unit(x.height) === undefined || x.height !== unit(x.height))
        errs.push("height");
    if (unit(x.bodyType) === undefined || x.bodyType !== unit(x.bodyType))
        errs.push("bodyType");
    if (!inList(x.skinTone, exports.SKIN_TONES))
        errs.push("skinTone");
    if (!inList(x.hairStyle, exports.HAIR_STYLE_IDS))
        errs.push("hairStyle");
    if (!inList(x.hairColor, exports.HAIR_COLORS))
        errs.push("hairColor");
    if (x.faceShape !== undefined && !inList(x.faceShape, exports.FACE_SHAPE_IDS))
        errs.push("faceShape");
    if (x.eyeColor !== undefined && !inList(x.eyeColor, exports.EYE_COLORS))
        errs.push("eyeColor");
    if (x.eyeShape !== undefined && !inList(x.eyeShape, exports.EYE_SHAPE_IDS))
        errs.push("eyeShape");
    if (x.eyebrows !== undefined && !inList(x.eyebrows, exports.EYEBROW_IDS))
        errs.push("eyebrows");
    if (x.facialHair !== undefined && !inList(x.facialHair, exports.FACIAL_HAIR_IDS))
        errs.push("facialHair");
    if (x.noseShape !== undefined && !inList(x.noseShape, exports.NOSE_SHAPE_IDS))
        errs.push("noseShape");
    if (x.mouthShape !== undefined && !inList(x.mouthShape, exports.MOUTH_SHAPE_IDS))
        errs.push("mouthShape");
    if (x.faceStyle !== undefined && !inList(x.faceStyle, exports.FACE_STYLE_IDS))
        errs.push("faceStyle");
    if (x.base !== undefined && !inList(x.base, exports.BASE_MODELS))
        errs.push("base");
    const known = ["height", "bodyType", "skinTone", "hairStyle", "hairColor", "faceShape", "eyeColor", "eyeShape", "eyebrows", "facialHair", "noseShape", "mouthShape", "faceStyle", "base"];
    for (const k of Object.keys(x))
        if (!known.includes(k))
            errs.push(k);
    return errs;
}
/**
 * Any stored or partial appearance as a complete valid one: unknown values
 * fall back to defaults, so a document from an older (or newer) client still
 * renders a character instead of failing.
 */
function sanitizeAppearance(a) {
    const x = (a && typeof a === "object" ? a : {});
    const d = exports.DEFAULT_AVATAR;
    return {
        height: unit(x.height) ?? d.height,
        bodyType: unit(x.bodyType) ?? d.bodyType,
        skinTone: inList(x.skinTone, exports.SKIN_TONES) ?? d.skinTone,
        hairStyle: inList(x.hairStyle, exports.HAIR_STYLE_IDS) ?? d.hairStyle,
        hairColor: inList(x.hairColor, exports.HAIR_COLORS) ?? d.hairColor,
        faceShape: inList(x.faceShape, exports.FACE_SHAPE_IDS) ?? d.faceShape,
        eyeColor: inList(x.eyeColor, exports.EYE_COLORS) ?? d.eyeColor,
        eyeShape: inList(x.eyeShape, exports.EYE_SHAPE_IDS) ?? d.eyeShape,
        eyebrows: inList(x.eyebrows, exports.EYEBROW_IDS) ?? d.eyebrows,
        facialHair: inList(x.facialHair, exports.FACIAL_HAIR_IDS) ?? d.facialHair,
        noseShape: inList(x.noseShape, exports.NOSE_SHAPE_IDS) ?? d.noseShape,
        mouthShape: inList(x.mouthShape, exports.MOUTH_SHAPE_IDS) ?? d.mouthShape,
        faceStyle: inList(x.faceStyle, exports.FACE_STYLE_IDS) ?? d.faceStyle,
        base: (() => {
            const b = inList(x.base, exports.BASE_MODELS) ?? exports.DEFAULT_BASE;
            return exports.LEGACY_BASE[b] ?? b;
        })(),
    };
}
//# sourceMappingURL=avatarRules.js.map
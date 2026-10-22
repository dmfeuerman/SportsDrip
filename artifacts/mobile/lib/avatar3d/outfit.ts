/**
 * Pure outfit logic for the renderer: which asset each equipped item renders
 * with, how hair sits under a hat, and a stable key for a whole look. The
 * rules themselves (templates, exclusions, valid appearance) are in
 * avatarRules.ts, shared with the server.
 */
import type { AttachSpec } from "./attach";
import type { AvatarConfig, BodyRegion, Equipped, HairMode, ItemLike, Slot } from "./avatarRules";
import { HAIR_MODE_PRIORITY, hairModeOf, hidesOf, layerOf, SLOTS, templateFor } from "./avatarRules";

export interface OutfitItem extends ItemLike {
  color: string;
  secondaryColor?: string | null;
  /** Per-item override of the asset's attachment spec (see attach.ts). */
  attach?: AttachSpec | null;
  /** Bumped whenever a remote asset's file changes, so caches re-download it. */
  assetVersion?: number | null;
}

export interface OutfitPiece {
  slot: Slot;
  itemId: string;
  /** Bundled template key, or null when `url` is used. */
  template: string | null;
  url: string | null;
  primary: string;
  secondary: string | null;
  /** Catalog override for where a rigid item sits; merged over the asset's own spec. */
  attach?: AttachSpec | null;
  /** Body regions hidden under it; null → the asset's own metadata decides. */
  hides: BodyRegion[] | null;
  /** Layer, inner → outer (a depth bias between coincident surfaces). */
  layer: number;
  /** Cache-busting version of a remote asset. */
  version?: number | null;
}

export interface ResolvedOutfit {
  pieces: OutfitPiece[];
  hairMode: HairMode | null;
  /** Equipped ids we can't render (not in the catalog, wrong slot, or no usable model). */
  missing: string[];
}

/** How one catalog item renders, or null when it has no usable model. */
export function pieceFor(item: OutfitItem): OutfitPiece | null {
  const template = templateFor(item);
  if (!template && !item.assetUrl) return null;
  return {
    slot: item.slot,
    itemId: item.id,
    template,
    url: template ? null : item.assetUrl!,
    primary: item.color,
    secondary: item.secondaryColor ?? null,
    ...(item.attach ? { attach: item.attach } : {}),
    hides: hidesOf(item),
    layer: layerOf(item),
    ...(!template && item.assetVersion ? { version: item.assetVersion } : {}),
  };
}

export function resolveOutfit(equipped: Equipped, catalog: Map<string, OutfitItem>): ResolvedOutfit {
  const pieces: OutfitPiece[] = [];
  const missing: string[] = [];
  let hairMode: HairMode | null = null;

  for (const slot of SLOTS) {
    const id = equipped[slot];
    if (!id) continue;
    const item = catalog.get(id);
    const piece = item && item.slot === slot ? pieceFor(item) : null;
    if (!item || !piece) {
      missing.push(id);
      continue;
    }
    pieces.push(piece);
    const mode = hairModeOf(item);
    if (mode && (!hairMode || HAIR_MODE_PRIORITY[mode] > HAIR_MODE_PRIORITY[hairMode])) hairMode = mode;
  }
  return { pieces, hairMode, missing };
}

/** Stable, order-independent key for a look — used to cache portraits. */
export function lookKey(avatar: AvatarConfig, outfit: ResolvedOutfit, framing: string): string {
  const a = [
    avatar.base ?? "",
    Math.round(avatar.height * 100),
    Math.round(avatar.bodyType * 100),
    avatar.skinTone.toLowerCase(),
    avatar.hairStyle,
    avatar.hairColor.toLowerCase(),
    avatar.faceShape ?? "",
    `${avatar.eyeColor ?? ""}:${avatar.eyebrows ?? ""}:${avatar.eyeShape ?? ""}:${avatar.facialHair ?? ""}:${avatar.noseShape ?? ""}:${avatar.mouthShape ?? ""}`,
  ].join("|");
  const o = [...outfit.pieces]
    .sort((x, y) => x.slot.localeCompare(y.slot))
    .map((p) => `${p.slot}:${p.template ?? p.url}@${p.version ?? ""}:${p.primary.toLowerCase()}:${(p.secondary ?? "").toLowerCase()}${p.attach ? `:${JSON.stringify(p.attach)}` : ""}:${p.hides?.join("+") ?? "-"}:${p.layer}`)
    .join(",");
  return `${framing}#${hash(`${a}/${o}`)}`;
}

/** FNV-1a, 32-bit, as hex. Plenty for a cache key. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

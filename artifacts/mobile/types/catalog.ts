import { RARITY_RAMP } from "@/constants/colors";
import type { AttachSpec } from "@/lib/avatar3d/attach";
import type { BodyRegion, HairMode } from "@/lib/avatar3d/avatarRules";
import type { Slot } from "@/types/avatar";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/**
 * Shape of catalog/{itemId}. Replaces the hardcoded `constants/shopItems.ts`
 * array — adding an item is now a Firestore write, not an app release.
 */
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  slot: Slot;
  price: number;
  rarity: Rarity;
  color: string;
  secondaryColor: string | null;
  thumbnailUrl: string | null;
  /**
   * Bundled garment template this item renders with (assets/avatar/<model>.glb,
   * e.g. "top_hoodie"). Colours come from `color`/`secondaryColor`, so one
   * template serves any number of items. Missing on older documents: the
   * renderer infers one from `shape`/id.
   */
  model?: string | null;
  /**
   * Remote GLB on the shared sd_rig_v3 skeleton (Mixamo bone names); overrides
   * `model` when set. Lets a new item ship with a Firestore write, no app release.
   */
  assetUrl: string | null;
  /** Bump when the file at `assetUrl` changes: devices cache downloads per URL + version. */
  assetVersion?: number | null;
  /** Slots this item can't be worn with (headphones → hat). Template default if omitted. */
  excludes?: Slot[] | null;
  /** Hair handling under a head item. Template / asset default if omitted. */
  hairMode?: HairMode | null;
  /** Body regions this item covers completely and hides. Asset metadata if omitted. */
  hides?: BodyRegion[] | null;
  /** Layer order, inner → outer. Slot default (SLOT_LAYER) if omitted. */
  layer?: number | null;
  /** Where a rigid item sits on its socket, merged over the asset's own spec (lib/avatar3d/attach.ts). */
  attach?: AttachSpec | null;
  available: boolean;
  releaseAt: number | null;
  /**
   * Variant within a slot's default silhouette ("hoodie", "beanie", "boot"…).
   * Free text on the document; the renderer falls back to the slot default.
   * The 3D garments already read this — it was just missing from the type.
   */
  shape?: string | null;
}

export const RARITY_COLORS: Record<Rarity, string> = { ...RARITY_RAMP };

export const SLOT_LABELS: Record<Slot, string> = {
  hat: "Hats",
  top: "Tops",
  outerwear: "Jackets",
  bottom: "Bottoms",
  shoes: "Shoes",
  eyewear: "Eyewear",
  accessory: "Accessories",
};

export const SLOT_ICONS: Record<Slot, string> = {
  hat: "hat-fedora",
  top: "tshirt-crew",
  outerwear: "coat-rack",
  bottom: "human-male",
  shoes: "shoe-sneaker",
  eyewear: "sunglasses",
  accessory: "watch-variant",
};

/** Render/z order, back to front. */
export const SLOT_ORDER: Slot[] = [
  "hat",
  "eyewear",
  "outerwear",
  "top",
  "bottom",
  "shoes",
  "accessory",
];

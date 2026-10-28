/**
 * Runtime half of the avatar contract. The authoring half (bone positions,
 * layer offsets, how assets are built) is scripts/avatar/rig.mjs; this file
 * holds only what the renderer needs.
 */
import type { HairMode, Slot } from "./avatarRules";
export { DEFAULT_BASE } from "./avatarRules";
export type { HairMode } from "./avatarRules";

export const RIG_ID = "sd_rig_v3";

export interface AvatarAssetEntry {
  module: number;
  /** base character, garment template, or an appearance part (one hairstyle / facial-hair style). */
  kind: "base" | "garment" | "hair" | "facialHair";
  version: number;
  slot?: Slot;
  hairMode?: HairMode | null;
  excludes?: Slot[];
  bytes: number;
}

/** Appearance parts load per look: one hairstyle and one facial-hair style at a time. */
export const hairAssetKey = (style: string | undefined | null) => (style && style !== "bald" ? `hair_${style}` : null);
export const facialHairAssetKey = (style: string | undefined | null) => (style && style !== "none" ? `beard_${style}` : null);

/** Camera framings, in the avatar's rest-pose metres (sd_base_v3: 1.78 tall, eyes at 1.64). */
export type Focus = "full" | "head" | "torso" | "legs" | "feet" | "reaction" | "hero";

export const FOCUS: Record<Focus, { target: [number, number, number]; distance: number; height: number }> = {
  full: { target: [0, 0.9, 0], distance: 4.5, height: 0.02 },
  head: { target: [0, 1.63, 0], distance: 1.3, height: 0.02 },
  torso: { target: [0, 1.24, 0], distance: 2.55, height: 0.05 },
  legs: { target: [0, 0.55, 0], distance: 2.6, height: 0.05 },
  feet: { target: [0, 0.12, 0], distance: 1.6, height: 0.13 },
  /** Knees to raised hands: bet-result reactions (fist pumps, hands to the face). */
  reaction: { target: [0, 1.18, 0], distance: 3.2, height: 0.05 },
  /** Head to toe with headroom for a cheer's raised arms (Home). */
  hero: { target: [0, 1.0, 0], distance: 4.3, height: 0.03 },
};

export const CAMERA_FOV = 28;

type Framing3 = (typeof FOCUS)[Focus];

/** Where a category's framing sits on the manual zoom path. */
export function focusToZoom(f: Focus): number {
  return f === "head" ? 2 : f === "torso" ? 1 : 0;
}

/** Continuous framing along full body (0) → torso (1) → face (2), for pinch and wheel. */
export function zoomFraming(z: number): Framing3 {
  const [a, b, t] = z <= 1 ? [FOCUS.full, FOCUS.torso, z] : [FOCUS.torso, FOCUS.head, z - 1];
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    target: [m(a.target[0], b.target[0]), m(a.target[1], b.target[1]), m(a.target[2], b.target[2])],
    distance: m(a.distance, b.distance),
    height: m(a.height, b.height),
  };
}

/** Portrait framings rendered offscreen for small avatars. */
export type Framing = "bust" | "full" | "hero";
export const PORTRAIT_SIZE = { width: 256, height: 320 } as const;
/** The large full-body still at the top of Home: same 4:5 frame, more pixels. */
export const HERO_SIZE = { width: 480, height: 600 } as const;
export const PORTRAIT_FOCUS: Record<Framing, { target: [number, number, number]; distance: number; height: number }> = {
  bust: { target: [0, 1.53, 0], distance: 1.62, height: 0.04 },
  full: { target: [0, 0.9, 0], distance: 4.6, height: 0.04 },
  hero: { target: [0, 0.89, 0], distance: 4.15, height: 0.06 },
};

export const SLOT_FOCUS: Record<Slot, Focus> = {
  hat: "head",
  eyewear: "head",
  top: "torso",
  outerwear: "torso",
  bottom: "legs",
  shoes: "feet",
  accessory: "torso",
};

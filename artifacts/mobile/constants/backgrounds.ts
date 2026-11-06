/**
 * Backgrounds: the scene behind your character on Home and your profile.
 * The scenes are drawn in components/avatar/AvatarBackdrop.tsx; this is the
 * list this build can draw, with default store data. Prices and gates come
 * from Firestore `backgrounds/{id}` (hooks/useBackgrounds.ts) when listed, and
 * purchases are priced server-side (functions/src/callable/backgrounds.ts).
 *
 * Mirrors functions/src/lib/backgrounds.ts and scripts/background-data.mjs
 * (a functions test keeps them in step). No React Native imports.
 */

export type BackgroundRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface BackgroundInfo {
  id: string;
  name: string;
  description: string;
  rarity: BackgroundRarity;
  /** Default store price (Firestore overrides). 0 = free or a level reward. */
  price: number;
  /** Only buyable at or above this level. */
  levelRequired: number | null;
  /** Never sold: granted on reaching this level. */
  levelReward: number | null;
}

export const FREE_BACKGROUNDS = ["locker_room"] as const;
export const DEFAULT_BACKGROUND = "locker_room";

const bg = (
  id: string,
  name: string,
  price: number,
  rarity: BackgroundRarity,
  description: string,
  extra: Partial<Pick<BackgroundInfo, "levelRequired" | "levelReward">> = {}
): BackgroundInfo => ({ id, name, price, rarity, description, levelRequired: null, levelReward: null, ...extra });

export const BACKGROUND_LIBRARY: BackgroundInfo[] = [
  bg("locker_room", "Locker Room", 0, "common", "Where every career starts."),
  bg("night_stadium", "Night Game", 1200, "common", "Floodlights on, stands packed."),
  bg("hardwood_court", "Hardwood", 1400, "common", "Center court under the arena lights."),
  bg("beach_court", "Beach Court", 2900, "uncommon", "Sand, sun and a net."),
  bg("sunset_field", "Golden Hour", 3200, "uncommon", "The field at sunset."),
  bg("ice_rink", "Ice Rink", 3600, "uncommon", "Fresh sheet, cold air."),
  bg("neon_city", "Neon City", 7500, "rare", "Skyline after dark. Buy it, or unlock free at level 4.", { levelReward: 4 }),
  bg("confetti_podium", "Podium", 9000, "rare", "Confetti and a top step. Buy it, or unlock free at level 5.", { levelReward: 5 }),
  bg("gold_vault", "Gold Vault", 16000, "epic", "Bars stacked to the ceiling. Buy it, or unlock free at level 10.", { levelReward: 10 }),
  bg("champions_hall", "Champions Hall", 24000, "epic", "Banners and trophies. Buy it, or unlock free at level 15.", { levelReward: 15 }),
  bg("galaxy", "Deep Space", 42000, "legendary", "Out of this world. Buy it, or unlock free at level 20.", { levelReward: 20 }),
];

export const BACKGROUNDS_BY_ID = new Map(BACKGROUND_LIBRARY.map((b) => [b.id, b]));

export const isFreeBackground = (id: string) => (FREE_BACKGROUNDS as readonly string[]).includes(id);

/** A stored choice made safe to draw: unknown ids fall back to the default. */
export function backgroundOf(stored: unknown): string {
  return typeof stored === "string" && BACKGROUNDS_BY_ID.has(stored) ? stored : DEFAULT_BACKGROUND;
}

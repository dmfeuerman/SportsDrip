import { useMemo } from "react";
import { useBundle } from "@/lib/bundleStore";
import { BACKGROUND_LIBRARY, isFreeBackground, type BackgroundInfo, type BackgroundRarity } from "@/constants/backgrounds";
import { DEMO } from "@/lib/demo";

export interface StoreBackground extends BackgroundInfo {
  /** Everyone has it (the Locker Room). */
  free: boolean;
  /** Listed, released and not a level reward: can be bought. */
  forSale: boolean;
}

interface BackgroundDoc {
  name?: string;
  description?: string;
  price?: number;
  rarity?: BackgroundRarity;
  available?: boolean;
  releaseAt?: number | null;
  levelRequired?: number | null;
  levelReward?: number | null;
}

/**
 * The Backgrounds store: the scenes this build can draw
 * (constants/backgrounds.ts), priced and gated from Firestore
 * `backgrounds/{id}`. Without a backend (demo) the defaults are used.
 */
const NO_DOCS: never[] = [];

export function useBackgrounds() {
  // Shared listener + the phone's last copy (lib/bundleStore.ts). Demo: built-in defaults.
  const bundle = useBundle("backgrounds", DEMO ? NO_DOCS : null);
  const docs = useMemo(
    () => (DEMO || !bundle.items ? null : new Map(bundle.items.map(({ id, ...d }) => [id, d as unknown as BackgroundDoc]))),
    [bundle.items]
  );

  const backgrounds = useMemo<StoreBackground[]>(() => {
    const now = Date.now();
    return BACKGROUND_LIBRARY.map((b) => {
      const free = isFreeBackground(b.id);
      const d = docs?.get(b.id);
      const listed = docs ? !!d && d.available !== false && !(d.releaseAt && d.releaseAt > now) : true;
      const levelReward = d ? (d.levelReward ?? null) : b.levelReward;
      const price = free ? 0 : typeof d?.price === "number" ? d.price : b.price;
      return {
        ...b,
        name: d?.name ?? b.name,
        description: d?.description ?? b.description,
        rarity: d?.rarity ?? b.rarity,
        price,
        levelRequired: d ? (d.levelRequired ?? null) : b.levelRequired,
        levelReward,
        free,
        forSale: !free && listed && price > 0,
      };
    });
  }, [docs]);

  const byId = useMemo(() => new Map(backgrounds.map((b) => [b.id, b])), [backgrounds]);
  return { backgrounds, byId };
}

import { subscribeBundle } from "@/lib/bundles";
import { useEffect, useMemo, useState } from "react";
import { BACKGROUND_LIBRARY, isFreeBackground, type BackgroundInfo, type BackgroundRarity } from "@/constants/backgrounds";
import { getDb } from "@/lib/firebase";
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
export function useBackgrounds() {
  const [docs, setDocs] = useState<Map<string, BackgroundDoc> | null>(null);

  useEffect(() => {
    const db = DEMO ? null : getDb();
    if (!db) return;
    return subscribeBundle(
      db,
      "backgrounds",
      (items) => setDocs(new Map(items.map(({ id, ...d }) => [id, d as unknown as BackgroundDoc]))),
      () => {}
    );
  }, []);

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

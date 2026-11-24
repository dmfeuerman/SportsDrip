import { useMemo } from "react";
import { useBundle, type BundleItem } from "@/lib/bundleStore";
import type { CatalogItem } from "@/types/catalog";
import { getFirebaseAuth } from "@/lib/firebase";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { DEMO, demoCatalog } from "@/lib/demo";
import { isLeavingSoon, windowState } from "@/lib/storeWindow";
import { useNow } from "@/hooks/useNow";

/**
 * Subscribes to catalog/*. The store is now data-driven (requirement §14): a
 * new hat is a Firestore document, not a code change and an app release.
 *
 * `items` is what the store sells (available, released). `byId` holds every
 * document, retired ones included — a friend still wearing last season's
 * jacket must still render in it.
 */
/**
 * Store order: buyable items cheapest first, then level-reward items last in
 * level order, so a free-to-earn crown never sorts to the top as a "free" item.
 */
export function storeOrder(a: { price: number; levelReward?: number | null }, b: { price: number; levelReward?: number | null }) {
  const al = a.levelReward ?? 0;
  const bl = b.levelReward ?? 0;
  if (al || bl) return al && bl ? al - bl : al ? 1 : -1;
  return a.price - b.price;
}

const EMPTY: CatalogItem[] = [];
const maps = new WeakMap<CatalogItem[], Map<string, CatalogItem>>();
function byIdOf(all: CatalogItem[]) {
  let map = maps.get(all);
  if (!map) {
    map = new Map();
    for (const i of all) map.set(i.id, i);
    maps.set(all, map);
  }
  return map;
}

export function useCatalog() {
  // One shared listener and the phone's last copy (lib/bundleStore.ts): every
  // screen has the catalog the moment it opens.
  const bundle = useBundle("catalog", DEMO ? (demoCatalog as unknown as BundleItem[]) : null);
  const all = (bundle.items as unknown as CatalogItem[] | null) ?? EMPTY;
  const loading = bundle.loading;
  const error = bundle.error;

  // Re-evaluated each minute so a window opening or closing updates the grid.
  const minute = Math.floor(useNow(60_000) / 60_000);
  // shop_rotation_v1: control / holdout get the static shop — rotating items
  // always on sale, no Featured / Leaving soon. Mirrors assertSellable.
  const staticShop = useExperiment(EXPERIMENTS.shopRotation, getFirebaseAuth()?.currentUser?.uid) === CONTROL;
  const items = useMemo(() => {
    const now = Date.now();
    // Same rules as purchaseItem, so an item that hasn't dropped or has left doesn't
    // show in the grid while purchaseItem would reject them.
    return all
      .filter((i) => (staticShop && i.rotation ? i.available !== false : windowState(i, now) === "on_sale"))
      .sort(storeOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, minute, staticShop]);

  const featured = useMemo(() => items.filter((i) => i.featured && !(staticShop && i.rotation)), [items, staticShop]);
  const leavingSoon = useMemo(() => {
    if (staticShop) return [];
    const now = Date.now();
    return items
      .filter((i) => isLeavingSoon(i, now))
      .sort((a, b) => (a.availableUntil ?? 0) - (b.availableUntil ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, minute, staticShop]);

  // Shared per catalog copy, so every screen hands the avatar the same map.
  const byId = useMemo(() => byIdOf(all), [all]);

  return { items, featured, leavingSoon, byId, loading, error };
}

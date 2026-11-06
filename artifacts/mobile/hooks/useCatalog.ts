import { subscribeBundle } from "@/lib/bundles";
import { useEffect, useMemo, useState } from "react";
import type { CatalogItem } from "@/types/catalog";
import { getDb, getFirebaseAuth } from "@/lib/firebase";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { firstAnswer } from "@/lib/devtrace";
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
export function useCatalog() {
  const [all, setAll] = useState<CatalogItem[]>(DEMO ? demoCatalog : []);
  const [loading, setLoading] = useState(!DEMO);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    if (!db) {
      setLoading(false);
      return;
    }

    const answer = firstAnswer("catalog", () => {
      setError("Can't reach the server. Check your connection.");
      setLoading(false);
    });
    const unsub = subscribeBundle(
      db,
      "catalog",
      (items) => {
        answer.hit();
        setAll(items as unknown as CatalogItem[]);
        setError(null);
        setLoading(false);
      },
      (err) => {
        answer.hit();
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      answer.cancel();
      unsub();
    };
  }, []);

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
      .sort((a, b) => a.price - b.price);
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

  const byId = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    all.forEach((i) => map.set(i.id, i));
    return map;
  }, [all]);

  return { items, featured, leavingSoon, byId, loading, error };
}

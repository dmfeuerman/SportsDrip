import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import type { CatalogItem } from "@/types/catalog";
import { getDb } from "@/lib/firebase";
import { firstAnswer } from "@/lib/devtrace";
import { DEMO, demoCatalog } from "@/lib/demo";

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
    const unsub = onSnapshot(
      collection(db, "catalog"),
      (snap) => {
        answer.hit();
        setAll(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CatalogItem));
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

  const items = useMemo(() => {
    const now = Date.now();
    // Unreleased drops are hidden client-side too, so they don't flash into
    // the grid a moment before purchaseItem rejects them.
    return all
      .filter((i) => i.available !== false && (!i.releaseAt || i.releaseAt <= now))
      .sort((a, b) => a.price - b.price);
  }, [all]);

  const byId = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    all.forEach((i) => map.set(i.id, i));
    return map;
  }, [all]);

  return { items, byId, loading, error };
}

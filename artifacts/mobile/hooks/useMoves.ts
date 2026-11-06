import { subscribeBundle } from "@/lib/bundles";
import { useEffect, useMemo, useState } from "react";
import { isFreeMove, MOVE_LIBRARY, type MoveInfo, type MoveRarity } from "@/constants/moves";
import { getDb } from "@/lib/firebase";
import { DEMO } from "@/lib/demo";

export interface StoreMove extends MoveInfo {
  /** Free for everyone (Cheer, Fist Pump). */
  free: boolean;
  /** Listed and released: can be bought (free moves are never "for sale"). */
  forSale: boolean;
}

interface MoveDoc {
  name?: string;
  description?: string;
  price?: number;
  rarity?: MoveRarity;
  available?: boolean;
  releaseAt?: number | null;
}

/**
 * The Moves store: the moves this build can animate (constants/moves.ts),
 * priced and listed from Firestore `moves/{id}`. A move with no listing (or
 * switched off) still plays for anyone who owns it; it just isn't for sale.
 * Without a backend (demo mode) every move is listed at its default price.
 */
export function useMoves() {
  const [docs, setDocs] = useState<Map<string, MoveDoc> | null>(null);
  const [loading, setLoading] = useState(!DEMO);

  useEffect(() => {
    const db = DEMO ? null : getDb();
    if (!db) {
      setLoading(false);
      return;
    }
    return subscribeBundle(
      db,
      "moves",
      (items) => {
        setDocs(new Map(items.map(({ id, ...d }) => [id, d as unknown as MoveDoc])));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  const moves = useMemo<StoreMove[]>(() => {
    const now = Date.now();
    return MOVE_LIBRARY.map((m) => {
      const free = isFreeMove(m.id);
      const d = docs?.get(m.id);
      // No listing doc = sold at the built-in price (the server falls back the same way).
      const listed = !d || (d.available !== false && !(d.releaseAt && d.releaseAt > now));
      return {
        ...m,
        name: d?.name ?? m.name,
        description: d?.description ?? m.description,
        rarity: d?.rarity ?? m.rarity,
        price: free ? 0 : typeof d?.price === "number" ? d.price : m.price,
        free,
        forSale: !free && listed,
      };
    });
  }, [docs]);

  const byId = useMemo(() => new Map(moves.map((m) => [m.id, m])), [moves]);
  return { moves, byId, loading };
}

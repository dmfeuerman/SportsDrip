import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { AvatarConfig, Equipped } from "@/types/avatar";

/**
 * The cart: store items picked in the character creator that the player
 * doesn't own yet, plus the look they were picked for, so checkout can buy
 * them and save that look in one go.
 *
 * In memory only. Buying goes through the server (`purchaseItem`), which owns
 * balances and inventory; the cart is just what's been selected.
 */
export interface CartDraft {
  avatar: AvatarConfig;
  equipped: Equipped;
}

interface CartContextType {
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  /** Replaces the cart (no-op when unchanged, so screens can mirror their selection into it). */
  setIds: (ids: string[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  draft: CartDraft | null;
  setDraft: (d: CartDraft | null) => void;
}

const CartContext = createContext<CartContextType | null>(null);

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIdsState] = useState<string[]>([]);
  const [draft, setDraftState] = useState<CartDraft | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const setIds = useCallback((next: string[]) => {
    const unique = [...new Set(next)];
    if (!sameIds(idsRef.current, unique)) setIdsState(unique);
  }, []);
  const remove = useCallback((id: string) => setIdsState((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur)), []);
  const clear = useCallback(() => {
    setIdsState((cur) => (cur.length ? [] : cur));
    setDraftState(null);
  }, []);
  const setDraft = useCallback((d: CartDraft | null) => setDraftState(d), []);

  const value = useMemo<CartContextType>(
    () => ({ ids, count: ids.length, has: (id) => ids.includes(id), setIds, remove, clear, draft, setDraft }),
    [ids, setIds, remove, clear, draft, setDraft]
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

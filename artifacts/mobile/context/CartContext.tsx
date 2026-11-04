import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { AvatarConfig, Equipped } from "@/types/avatar";

/**
 * The cart: store items the player doesn't own yet, added in the Drip Shop or
 * tried on in the character creator, plus the look they were tried on for so
 * checkout can buy them and save that look in one go.
 *
 * Items stay in the cart until they're bought or the player removes / clears
 * them on the checkout screen — leaving the shop or the creator keeps them.
 *
 * In memory only. Buying goes through the server (`purchaseItem`), which owns
 * balances and inventory; the cart is just what's been selected.
 */
export interface CartDraft {
  avatar: AvatarConfig;
  equipped: Equipped;
}

/** Where checkout was opened from — decides where "Continue shopping" goes. */
export type CartOrigin = "shop" | "customize" | "locker";

interface CartContextType {
  ids: string[];
  has: (id: string) => boolean;
  add: (id: string) => void;
  /** Adds or removes; returns whether it's in the cart afterwards. */
  toggle: (id: string) => boolean;
  remove: (id: string) => void;
  /** Empties the cart (the checkout screen's Clear cart). */
  clear: () => void;
  /** Empties the cart after a successful purchase, so screens being popped don't stop to ask. */
  checkedOut: () => void;
  /** True for a moment after `checkedOut`. */
  justCheckedOut: () => boolean;
  /** Live id count, including changes made this tick (before a re-render). */
  peekCount: () => number;
  draft: CartDraft | null;
  setDraft: (d: CartDraft | null) => void;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [draft, setDraftState] = useState<CartDraft | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const checkedOutAt = useRef(0);

  const write = useCallback((next: string[]) => {
    idsRef.current = next;
    setIds(next);
  }, []);
  const add = useCallback((id: string) => {
    if (!idsRef.current.includes(id)) write([...idsRef.current, id]);
  }, [write]);
  const remove = useCallback((id: string) => {
    if (idsRef.current.includes(id)) write(idsRef.current.filter((x) => x !== id));
  }, [write]);
  const toggle = useCallback(
    (id: string) => {
      const inCart = idsRef.current.includes(id);
      if (inCart) remove(id);
      else add(id);
      return !inCart;
    },
    [add, remove]
  );
  const clear = useCallback(() => {
    if (idsRef.current.length) write([]);
    setDraftState(null);
  }, [write]);
  const checkedOut = useCallback(() => {
    checkedOutAt.current = Date.now();
    clear();
  }, [clear]);
  const justCheckedOut = useCallback(() => Date.now() - checkedOutAt.current < 3000, []);
  const peekCount = useCallback(() => idsRef.current.length, []);
  const setDraft = useCallback((d: CartDraft | null) => setDraftState(d), []);

  const value = useMemo<CartContextType>(
    () => ({ ids, has: (id) => ids.includes(id), add, toggle, remove, clear, checkedOut, justCheckedOut, peekCount, draft, setDraft }),
    [ids, add, toggle, remove, clear, checkedOut, justCheckedOut, peekCount, draft, setDraft]
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

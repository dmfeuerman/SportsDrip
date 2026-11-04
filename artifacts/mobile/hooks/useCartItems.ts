import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useCatalog } from "@/hooks/useCatalog";
import type { CatalogItem } from "@/types/catalog";

/**
 * The cart as checkout would charge it: real catalog items the player doesn't
 * own yet. Every count and total shown for the cart comes from here, so the
 * badge, the exit popup and checkout always agree.
 */
export function useCartItems() {
  const cart = useCart();
  const { inventory } = useApp();
  const { byId } = useCatalog();
  return useMemo(() => {
    const owned = new Set(inventory);
    const items = cart.ids.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i && !owned.has(i.id));
    return { items, count: items.length, total: items.reduce((s, i) => s + i.price, 0) };
  }, [cart.ids, byId, inventory]);
}

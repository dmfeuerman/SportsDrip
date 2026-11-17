import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useBackgrounds } from "@/hooks/useBackgrounds";
import { useCatalog } from "@/hooks/useCatalog";
import { useMoves } from "@/hooks/useMoves";
import type { CatalogItem } from "@/types/catalog";

/** Cart ids for things that aren't clothing: prefixed so they never collide with catalog ids. */
export const moveCartId = (id: string) => `move:${id}`;
export const backgroundCartId = (id: string) => `bg:${id}`;

/** A dance move or scene in the cart (clothing stays a CatalogItem). */
export interface CartExtra {
  /** The id in the cart ("move:moonwalk"). */
  cartId: string;
  kind: "move" | "background";
  /** The move or background id. */
  refId: string;
  name: string;
  price: number;
  rarity: string;
  icon: string;
  description?: string;
}

/**
 * The cart as checkout would charge it: clothing, dance moves and scenes the
 * player doesn't own yet. Every count and total shown for the cart comes from
 * here, so the badge, the exit popup and checkout always agree.
 */
export function useCartItems() {
  const cart = useCart();
  const { inventory, ownedMoves, ownedBackgrounds } = useApp();
  const { byId } = useCatalog();
  const { byId: movesById } = useMoves();
  const { byId: bgById } = useBackgrounds();
  return useMemo(() => {
    const owned = new Set(inventory);
    const items = cart.ids.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i && !owned.has(i.id));
    const extras: CartExtra[] = [];
    for (const id of cart.ids) {
      if (id.startsWith("move:")) {
        const m = movesById.get(id.slice(5));
        if (m && !ownedMoves.has(m.id)) extras.push({ cartId: id, kind: "move", refId: m.id, name: m.name, price: m.price, rarity: m.rarity, icon: m.icon, description: m.description });
      } else if (id.startsWith("bg:")) {
        const b = bgById.get(id.slice(3));
        if (b && !ownedBackgrounds.has(b.id)) extras.push({ cartId: id, kind: "background", refId: b.id, name: b.name, price: b.price, rarity: b.rarity, icon: "image-filter-hdr", description: b.description });
      }
    }
    const total = items.reduce((s, i) => s + i.price, 0) + extras.reduce((s, e) => s + e.price, 0);
    return { items, extras, count: items.length + extras.length, total, names: [...items.map((i) => i.name), ...extras.map((e) => e.name)] };
  }, [cart.ids, byId, movesById, bgById, inventory, ownedMoves, ownedBackgrounds]);
}

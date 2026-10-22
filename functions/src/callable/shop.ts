import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { equipOne } from "./avatar";

export const SLOTS = [
  "hat",
  "top",
  "outerwear",
  "bottom",
  "shoes",
  "eyewear",
  "accessory",
] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * Buys a catalog item.
 *
 * Every failure mode from §17 is closed by doing the whole thing in one
 * transaction:
 *  - price comes from catalog/{itemId}, never from the client
 *  - the inventory doc id *is* the item id, so a duplicate purchase can't exist
 *  - debit and grant are the same commit: you cannot get the item without
 *    paying, or pay without getting the item
 *  - applyCredits refuses to go negative
 *  - the idempotency key absorbs rapid-click and retry storms
 */
export const purchaseItem = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { itemId, idempotencyKey } = z
    .object({ itemId: z.string().min(1), idempotencyKey: z.string().min(8).max(64) })
    .parse(req.data);

  const itemRef = db.collection("catalog").doc(itemId);
  const invRef = db.collection("users").doc(uid).collection("inventory").doc(itemId);

  return db.runTransaction(async (tx) => {
    const [item, owned] = await Promise.all([tx.get(itemRef), tx.get(invRef)]);

    if (!item.exists) throw new HttpsError("not-found", "That item isn't in the store.");
    if (owned.exists) throw new HttpsError("already-exists", "You already own this.");
    if (item.get("available") === false) {
      throw new HttpsError("failed-precondition", "That item isn't available right now.");
    }

    const releaseAt = item.get("releaseAt") as number | undefined;
    if (releaseAt && releaseAt > Date.now()) {
      throw new HttpsError("failed-precondition", "That item hasn't dropped yet.");
    }

    const price = item.get("price") as number;
    if (typeof price !== "number" || price < 0) {
      throw new HttpsError("internal", "Catalog item is misconfigured.");
    }

    const balance = await applyCredits(tx, uid, {
      delta: -price,
      type: "purchase",
      idempotencyKey: `purchase_${idempotencyKey}`,
      ref: itemId,
      note: (item.get("name") as string) ?? itemId,
    });

    tx.set(invRef, {
      itemId,
      slot: item.get("slot"),
      source: "purchase",
      pricePaid: price,
      acquiredAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, balance, itemId };
  });
});

/**
 * Equips or clears a slot. Ownership is verified server-side, so a crafted
 * write cannot put a Legendary jersey on an avatar that never bought it, and
 * anything incompatible with the new item (headphones → hat) comes off in the
 * same write. Passing `itemId: null` unequips.
 */
export const equipItem = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { slot, itemId } = z
    .object({ slot: z.enum(SLOTS), itemId: z.string().min(1).nullable() })
    .parse(req.data);
  return equipOne(uid, slot, itemId);
});

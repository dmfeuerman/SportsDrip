import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { equipOne } from "./avatar";
import { levelFromXp } from "../lib/progression";
import { windowError, windowState } from "../lib/storeWindow";
import { assignArm, CONTROL, EXPERIMENTS, type ExperimentsDoc } from "../lib/experiments";

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
 * Shared sale checks for purchase and gifting: time window, level rules, price.
 * `xp` is the level-gated party's xp (the buyer; for gifts, the recipient).
 * Returns the server price.
 */
export function assertSellable(item: FirebaseFirestore.DocumentSnapshot, xp: unknown, now: number, rotationArm: string = CONTROL): number {
  const data = item.data() ?? {};
  // shop_rotation_v1: control / holdout keep the static shop (rotating items always
  // on sale, windows ignored) so the rotation's retention lift is measured.
  const staticShop = data.rotation === true && rotationArm === CONTROL;
  const err = windowError(staticShop ? (data.available === false ? "disabled" : "on_sale") : windowState(data, now));
  if (err) throw new HttpsError("failed-precondition", err);

  // Level-exclusive items are granted by reaching the level (lib/xp.ts), never sold.
  const reward = item.get("levelReward") as number | null | undefined;
  if (typeof reward === "number" && reward > 0) {
    throw new HttpsError("failed-precondition", `Not for sale — unlocked by reaching level ${reward}.`);
  }
  const required = (item.get("levelRequired") as number | null | undefined) ?? 0;
  if (required > levelFromXp(xp)) {
    throw new HttpsError("failed-precondition", `Reach level ${required} to buy this.`);
  }

  const price = item.get("price") as number;
  if (typeof price !== "number" || price < 0) {
    throw new HttpsError("internal", "Catalog item is misconfigured.");
  }
  return price;
}

/** shop_rotation_v1 arm for the buyer. Read inside the transaction, before any write. */
export async function rotationArmFor(tx: FirebaseFirestore.Transaction, uid: string): Promise<string> {
  const snap = await tx.get(db.collection("meta").doc("experiments"));
  return assignArm(snap.exists ? (snap.data() as ExperimentsDoc) : null, EXPERIMENTS.shopRotation, { uid });
}

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
    const [item, owned, user] = await Promise.all([tx.get(itemRef), tx.get(invRef), tx.get(db.collection("users").doc(uid))]);

    if (!item.exists) throw new HttpsError("not-found", "That item isn't in the store.");
    if (owned.exists) throw new HttpsError("already-exists", "You already own this.");
    const price = assertSellable(item, user.get("xp"), Date.now(), await rotationArmFor(tx, uid));

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

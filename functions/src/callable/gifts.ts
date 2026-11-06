import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { assertSellable, rotationArmFor } from "./shop";
import { writeFriendDm } from "./friendMoney";

/** Sender account must be at least this old (blocks fresh alt accounts). */
export const GIFT_MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;

export function accountAgeOk(createdAtMs: number | null, now: number): boolean {
  return createdAtMs != null && now - createdAtMs >= GIFT_MIN_ACCOUNT_AGE_MS;
}

/**
 * Buys a catalog item for a friend. Items only — never credits — so a gift
 * can't be used to farm credits between alt accounts. One transaction, same
 * guarantees as purchaseItem: server price, debit and grant commit together,
 * idempotency key absorbs retries, recipient can't already own it.
 */
export const giftItem = onCall({ region: "us-central1" }, async (req) => {
  const from = requireAuth(req.auth);
  const { itemId, toUid, idempotencyKey, note } = z
    .object({ itemId: z.string().min(1), toUid: z.string().min(1), idempotencyKey: z.string().min(8).max(64), note: z.string().trim().max(140).optional() })
    .parse(req.data);
  if (toUid === from) throw new HttpsError("invalid-argument", "Buy it in the shop instead.");

  const itemRef = db.collection("catalog").doc(itemId);
  const fromRef = db.collection("users").doc(from);
  const toRef = db.collection("users").doc(toUid);
  const invRef = toRef.collection("inventory").doc(itemId);
  const friendshipRef = db.collection("friendships").doc(pairId(from, toUid));

  return db.runTransaction(async (tx) => {
    const [item, owned, sender, recipient, friendship] = await Promise.all([
      tx.get(itemRef),
      tx.get(invRef),
      tx.get(fromRef),
      tx.get(toRef),
      tx.get(friendshipRef),
    ]);
    const now = Date.now();

    if (!recipient.exists) throw new HttpsError("not-found", "That player doesn't exist.");
    if (!friendship.exists) throw new HttpsError("permission-denied", "You can only gift to friends.");
    const createdAt = sender.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
    if (!accountAgeOk(createdAt ? createdAt.toMillis() : null, now)) {
      throw new HttpsError("failed-precondition", "Gifting unlocks 7 days after you join.");
    }
    if (!item.exists) throw new HttpsError("not-found", "That item isn't in the store.");
    if (owned.exists) throw new HttpsError("already-exists", "They already own this.");
    const price = assertSellable(item, recipient.get("xp"), now, await rotationArmFor(tx, from));

    const balance = await applyCredits(tx, from, {
      delta: -price,
      type: "gift",
      idempotencyKey: `gift_${idempotencyKey}`,
      ref: `${itemId}:${toUid}`,
      note: `Gift: ${(item.get("name") as string) ?? itemId}`,
    });
    if (balance === null) return { ok: true, duplicate: true, balance: null, itemId };

    tx.set(invRef, {
      itemId,
      slot: item.get("slot"),
      source: "gift",
      giftedBy: from,
      pricePaid: 0,
      acquiredAt: FieldValue.serverTimestamp(),
    });
    const senderName = (sender.get("displayName") as string | undefined) || "A friend";
    const itemName = (item.get("name") as string) ?? itemId;
    // The sender always pays full price, even for an item they own themselves.
    writeFriendDm(tx, {
      id: `gift_${idempotencyKey}`,
      from,
      fromName: senderName,
      to: toUid,
      toName: (recipient.get("displayName") as string | undefined) || "Player",
      kind: "gift",
      text: note ? `Sent you ${itemName} 🎁: ${note}` : `Sent you ${itemName} 🎁`,
      now,
      extra: { itemId, itemName },
    });
    writeNotification(
      tx,
      toUid,
      simpleNotification({
        id: `gift_${from}_${itemId}`,
        type: "gift_received",
        title: `${senderName} sent you a gift 🎁`,
        body: `${(item.get("name") as string) ?? "A new item"} is in your wardrobe.`,
        now,
        popup: true,
        data: { itemId, fromUid: from },
      })
    );
    return { ok: true, duplicate: false, balance, itemId };
  });
});

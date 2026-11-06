"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.giftItem = exports.GIFT_MIN_ACCOUNT_AGE_MS = void 0;
exports.accountAgeOk = accountAgeOk;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const shop_1 = require("./shop");
const friendMoney_1 = require("./friendMoney");
/** Sender account must be at least this old (blocks fresh alt accounts). */
exports.GIFT_MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;
function accountAgeOk(createdAtMs, now) {
    return createdAtMs != null && now - createdAtMs >= exports.GIFT_MIN_ACCOUNT_AGE_MS;
}
/**
 * Buys a catalog item for a friend. Items only — never credits — so a gift
 * can't be used to farm credits between alt accounts. One transaction, same
 * guarantees as purchaseItem: server price, debit and grant commit together,
 * idempotency key absorbs retries, recipient can't already own it.
 */
exports.giftItem = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const from = (0, economy_1.requireAuth)(req.auth);
    const { itemId, toUid, idempotencyKey, note } = zod_1.z
        .object({ itemId: zod_1.z.string().min(1), toUid: zod_1.z.string().min(1), idempotencyKey: zod_1.z.string().min(8).max(64), note: zod_1.z.string().trim().max(140).optional() })
        .parse(req.data);
    if (toUid === from)
        throw new https_1.HttpsError("invalid-argument", "Buy it in the shop instead.");
    const itemRef = economy_1.db.collection("catalog").doc(itemId);
    const fromRef = economy_1.db.collection("users").doc(from);
    const toRef = economy_1.db.collection("users").doc(toUid);
    const invRef = toRef.collection("inventory").doc(itemId);
    const friendshipRef = economy_1.db.collection("friendships").doc((0, economy_1.pairId)(from, toUid));
    return economy_1.db.runTransaction(async (tx) => {
        const [item, owned, sender, recipient, friendship] = await Promise.all([
            tx.get(itemRef),
            tx.get(invRef),
            tx.get(fromRef),
            tx.get(toRef),
            tx.get(friendshipRef),
        ]);
        const now = Date.now();
        if (!recipient.exists)
            throw new https_1.HttpsError("not-found", "That player doesn't exist.");
        if (!friendship.exists)
            throw new https_1.HttpsError("permission-denied", "You can only gift to friends.");
        const createdAt = sender.get("createdAt");
        if (!accountAgeOk(createdAt ? createdAt.toMillis() : null, now)) {
            throw new https_1.HttpsError("failed-precondition", "Gifting unlocks 7 days after you join.");
        }
        if (!item.exists)
            throw new https_1.HttpsError("not-found", "That item isn't in the store.");
        if (owned.exists)
            throw new https_1.HttpsError("already-exists", "They already own this.");
        const price = (0, shop_1.assertSellable)(item, recipient.get("xp"), now, await (0, shop_1.rotationArmFor)(tx, from));
        const balance = await (0, economy_1.applyCredits)(tx, from, {
            delta: -price,
            type: "gift",
            idempotencyKey: `gift_${idempotencyKey}`,
            ref: `${itemId}:${toUid}`,
            note: `Gift: ${item.get("name") ?? itemId}`,
        });
        if (balance === null)
            return { ok: true, duplicate: true, balance: null, itemId };
        tx.set(invRef, {
            itemId,
            slot: item.get("slot"),
            source: "gift",
            giftedBy: from,
            pricePaid: 0,
            acquiredAt: economy_1.FieldValue.serverTimestamp(),
        });
        const senderName = sender.get("displayName") || "A friend";
        const itemName = item.get("name") ?? itemId;
        // The sender always pays full price, even for an item they own themselves.
        (0, friendMoney_1.writeFriendDm)(tx, {
            id: `gift_${idempotencyKey}`,
            from,
            fromName: senderName,
            to: toUid,
            toName: recipient.get("displayName") || "Player",
            kind: "gift",
            text: note ? `Sent you ${itemName} 🎁: ${note}` : `Sent you ${itemName} 🎁`,
            now,
            extra: { itemId, itemName },
        });
        (0, notify_1.writeNotification)(tx, toUid, (0, notifyModel_1.simpleNotification)({
            id: `gift_${from}_${itemId}`,
            type: "gift_received",
            title: `${senderName} sent you a gift 🎁`,
            body: `${item.get("name") ?? "A new item"} is in your wardrobe.`,
            now,
            popup: true,
            data: { itemId, fromUid: from },
        }));
        return { ok: true, duplicate: false, balance, itemId };
    });
});
//# sourceMappingURL=gifts.js.map
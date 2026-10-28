"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipItem = exports.purchaseItem = exports.SLOTS = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const avatar_1 = require("./avatar");
exports.SLOTS = [
    "hat",
    "top",
    "outerwear",
    "bottom",
    "shoes",
    "eyewear",
    "accessory",
];
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
exports.purchaseItem = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { itemId, idempotencyKey } = zod_1.z
        .object({ itemId: zod_1.z.string().min(1), idempotencyKey: zod_1.z.string().min(8).max(64) })
        .parse(req.data);
    const itemRef = economy_1.db.collection("catalog").doc(itemId);
    const invRef = economy_1.db.collection("users").doc(uid).collection("inventory").doc(itemId);
    return economy_1.db.runTransaction(async (tx) => {
        const [item, owned] = await Promise.all([tx.get(itemRef), tx.get(invRef)]);
        if (!item.exists)
            throw new https_1.HttpsError("not-found", "That item isn't in the store.");
        if (owned.exists)
            throw new https_1.HttpsError("already-exists", "You already own this.");
        if (item.get("available") === false) {
            throw new https_1.HttpsError("failed-precondition", "That item isn't available right now.");
        }
        const releaseAt = item.get("releaseAt");
        if (releaseAt && releaseAt > Date.now()) {
            throw new https_1.HttpsError("failed-precondition", "That item hasn't dropped yet.");
        }
        const price = item.get("price");
        if (typeof price !== "number" || price < 0) {
            throw new https_1.HttpsError("internal", "Catalog item is misconfigured.");
        }
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -price,
            type: "purchase",
            idempotencyKey: `purchase_${idempotencyKey}`,
            ref: itemId,
            note: item.get("name") ?? itemId,
        });
        tx.set(invRef, {
            itemId,
            slot: item.get("slot"),
            source: "purchase",
            pricePaid: price,
            acquiredAt: economy_1.FieldValue.serverTimestamp(),
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
exports.equipItem = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { slot, itemId } = zod_1.z
        .object({ slot: zod_1.z.enum(exports.SLOTS), itemId: zod_1.z.string().min(1).nullable() })
        .parse(req.data);
    return (0, avatar_1.equipOne)(uid, slot, itemId);
});
//# sourceMappingURL=shop.js.map
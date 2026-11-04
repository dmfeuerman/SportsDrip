"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBackground = exports.purchaseBackground = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const backgrounds_1 = require("../lib/backgrounds");
const progression_1 = require("../lib/progression");
const BackgroundId = zod_1.z.string().regex(backgrounds_1.BACKGROUND_ID_RE, "Unknown background.");
/**
 * Buys a background. Same guarantees as purchaseItem / purchaseMove, in one
 * transaction: server price, ownership doc id = background id (no double
 * purchase), debit and grant commit together, idempotency key. Level gates are
 * checked against the server-side XP. The new background goes straight on.
 */
exports.purchaseBackground = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z.object({ backgroundId: BackgroundId, idempotencyKey: zod_1.z.string().min(8).max(64) }).safeParse(req.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
    const { backgroundId, idempotencyKey } = parsed.data;
    if ((0, backgrounds_1.isFreeBackground)(backgroundId))
        throw new https_1.HttpsError("already-exists", "Everyone already has that background.");
    const userRef = economy_1.db.collection("users").doc(uid);
    const listingRef = economy_1.db.collection("backgrounds").doc(backgroundId);
    const ownRef = userRef.collection("backgrounds").doc(backgroundId);
    return economy_1.db.runTransaction(async (tx) => {
        const [listing, owned, user] = await Promise.all([tx.get(listingRef), tx.get(ownRef), tx.get(userRef)]);
        if (!listing.exists)
            throw new https_1.HttpsError("not-found", "That background isn't in the store.");
        if (owned.exists)
            throw new https_1.HttpsError("already-exists", "You already own this background.");
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        if (listing.get("available") === false)
            throw new https_1.HttpsError("failed-precondition", "That background isn't available right now.");
        const releaseAt = listing.get("releaseAt");
        if (releaseAt && releaseAt > Date.now())
            throw new https_1.HttpsError("failed-precondition", "That background hasn't dropped yet.");
        const reward = listing.get("levelReward");
        if (typeof reward === "number" && reward > 0) {
            throw new https_1.HttpsError("failed-precondition", `Not for sale — unlocked by reaching level ${reward}.`);
        }
        const required = listing.get("levelRequired") ?? 0;
        if (required > (0, progression_1.levelFromXp)(user.get("xp"))) {
            throw new https_1.HttpsError("failed-precondition", `Reach level ${required} to buy this background.`);
        }
        const price = listing.get("price");
        if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
            throw new https_1.HttpsError("internal", "Background is misconfigured.");
        }
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -price,
            type: "purchase",
            idempotencyKey: `bg_${idempotencyKey}`,
            ref: `background:${backgroundId}`,
            note: listing.get("name") ?? backgroundId,
        });
        if (balance === null)
            return { ok: true, balance: null, backgroundId };
        tx.set(ownRef, { backgroundId, source: "purchase", pricePaid: price, acquiredAt: economy_1.FieldValue.serverTimestamp() });
        tx.update(userRef, { background: backgroundId, updatedAt: economy_1.FieldValue.serverTimestamp() });
        return { ok: true, balance, backgroundId };
    });
});
/** Puts a free or owned background behind the character. `null` = the default. */
exports.setBackground = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z.object({ backgroundId: BackgroundId.nullable() }).safeParse(req.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
    const id = parsed.data.backgroundId ?? backgrounds_1.DEFAULT_BACKGROUND;
    const userRef = economy_1.db.collection("users").doc(uid);
    await economy_1.db.runTransaction(async (tx) => {
        const [user, owned] = await Promise.all([tx.get(userRef), (0, backgrounds_1.isFreeBackground)(id) ? Promise.resolve(null) : tx.get(userRef.collection("backgrounds").doc(id))]);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        if (owned && !owned.exists)
            throw new https_1.HttpsError("permission-denied", "You don't own that background.");
        tx.update(userRef, { background: id, updatedAt: economy_1.FieldValue.serverTimestamp() });
    });
    return { ok: true, backgroundId: id };
});
//# sourceMappingURL=backgrounds.js.map
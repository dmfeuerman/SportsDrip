"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMoveLoadout = exports.purchaseMove = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const moves_1 = require("../lib/moves");
const MoveId = zod_1.z.string().regex(moves_1.MOVE_ID_RE, "Unknown move.");
/**
 * Buys a move. Same guarantees as purchaseItem, in one transaction: the price
 * comes from moves/{moveId}, the ownership doc id is the move id (no double
 * purchase), debit and grant commit together, the balance can't go negative,
 * and the idempotency key absorbs double taps and retries.
 *
 * A new move goes straight into the loadout when there's a free slot, so it's
 * on the dance button the moment it's bought.
 */
exports.purchaseMove = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z.object({ moveId: MoveId, idempotencyKey: zod_1.z.string().min(8).max(64) }).safeParse(req.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
    const { moveId, idempotencyKey } = parsed.data;
    if ((0, moves_1.isFreeMove)(moveId))
        throw new https_1.HttpsError("already-exists", "Everyone already has that move.");
    const userRef = economy_1.db.collection("users").doc(uid);
    const moveRef = economy_1.db.collection("moves").doc(moveId);
    const ownRef = userRef.collection("moves").doc(moveId);
    return economy_1.db.runTransaction(async (tx) => {
        const [move, owned, user] = await Promise.all([tx.get(moveRef), tx.get(ownRef), tx.get(userRef)]);
        if (!move.exists)
            throw new https_1.HttpsError("not-found", "That move isn't in the store.");
        if (owned.exists)
            throw new https_1.HttpsError("already-exists", "You already own this move.");
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        if (move.get("available") === false)
            throw new https_1.HttpsError("failed-precondition", "That move isn't available right now.");
        const releaseAt = move.get("releaseAt");
        if (releaseAt && releaseAt > Date.now())
            throw new https_1.HttpsError("failed-precondition", "That move hasn't dropped yet.");
        const price = move.get("price");
        if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
            throw new https_1.HttpsError("internal", "Move is misconfigured.");
        }
        const loadout = (0, moves_1.loadoutOf)(user.get("moves"));
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -price,
            type: "purchase",
            idempotencyKey: `move_${idempotencyKey}`,
            ref: `move:${moveId}`,
            note: move.get("name") ?? moveId,
        });
        // A replayed key: the first call already granted it.
        if (balance === null)
            return { ok: true, balance: null, moveId, equipped: loadout.includes(moveId) };
        tx.set(ownRef, { moveId, source: "purchase", pricePaid: price, acquiredAt: economy_1.FieldValue.serverTimestamp() });
        const equipped = loadout.length < moves_1.MAX_LOADOUT;
        if (equipped)
            tx.update(userRef, { moves: [...loadout, moveId], updatedAt: economy_1.FieldValue.serverTimestamp() });
        return { ok: true, balance, moveId, equipped };
    });
});
/**
 * Sets the loadout: 1–4 distinct moves, in button order, each one free or
 * owned. Ownership is checked here, so a crafted call can't dance a move
 * nobody paid for.
 */
exports.setMoveLoadout = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z
        .object({ moves: zod_1.z.array(MoveId).min(1, "Pick at least one move.").max(moves_1.MAX_LOADOUT, `Pick up to ${moves_1.MAX_LOADOUT} moves.`) })
        .safeParse(req.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid loadout.");
    const moves = parsed.data.moves;
    if (new Set(moves).size !== moves.length)
        throw new https_1.HttpsError("invalid-argument", "A move can only be in your loadout once.");
    const userRef = economy_1.db.collection("users").doc(uid);
    const paid = moves.filter((m) => !(0, moves_1.isFreeMove)(m));
    await economy_1.db.runTransaction(async (tx) => {
        const [user, ...owned] = await Promise.all([tx.get(userRef), ...paid.map((m) => tx.get(userRef.collection("moves").doc(m)))]);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        if (owned.some((o) => !o.exists))
            throw new https_1.HttpsError("permission-denied", "You don't own one of those moves.");
        tx.update(userRef, { moves, updatedAt: economy_1.FieldValue.serverTimestamp() });
    });
    return { ok: true, moves };
});
//# sourceMappingURL=moves.js.map
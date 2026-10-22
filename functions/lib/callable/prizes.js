"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPrizeBox = exports.claimPrizeBox = exports.openPrizeBox = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const TierInput = zod_1.z.object({ tier: zod_1.z.enum(["bronze", "silver", "gold"]) });
/**
 * Prize box state lives at users/{uid}/prizeBoxes/{tier} and is written only by
 * these two functions. That fixes every branch of B8 at once:
 *
 *  - `readyAt` is computed from the *server* clock, so changing the phone's
 *    time does nothing
 *  - state is in Firestore, not AsyncStorage, so it survives reinstall, logout,
 *    and follows the user to a second device
 *  - the box goes `waiting -> ready -> claimed -> idle` explicitly, instead of
 *    the old code deleting the claim and losing both the `spun` flag and the
 *    cooldown record
 *  - the reward is drawn on the server (S3), not passed in from the wheel
 */
exports.openPrizeBox = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { tier } = TierInput.parse(req.data);
    const def = economy_1.PRIZE_BOXES[tier];
    const ref = economy_1.db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);
    return economy_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        if (snap.exists) {
            const state = snap.get("state");
            const readyAt = snap.get("readyAt") ?? 0;
            if (state === "waiting" && now < readyAt) {
                throw new https_1.HttpsError("failed-precondition", "That box is still on cooldown.");
            }
            if (state === "waiting" || state === "ready") {
                // Timer elapsed. Persist the transition instead of only reporting it,
                // so the stored document and the response agree.
                if (state === "waiting") {
                    tx.update(ref, { state: "ready", updatedAt: economy_1.FieldValue.serverTimestamp() });
                }
                return { ok: true, state: "ready", readyAt };
            }
        }
        const readyAt = now + def.waitHours * 3_600_000;
        tx.set(ref, {
            tier,
            state: "waiting",
            openedAt: now,
            readyAt,
            rewardCredits: null,
            claimedAt: null,
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        return { ok: true, state: "waiting", readyAt };
    });
});
exports.claimPrizeBox = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { tier } = TierInput.parse(req.data);
    const def = economy_1.PRIZE_BOXES[tier];
    const ref = economy_1.db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);
    return economy_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError("failed-precondition", "That box isn't open yet.");
        const state = snap.get("state");
        const readyAt = snap.get("readyAt") ?? 0;
        const openedAt = snap.get("openedAt") ?? 0;
        if (state === "claimed") {
            // Idempotent replay: return what was already awarded rather than paying twice.
            return {
                ok: true,
                duplicate: true,
                rewardCredits: snap.get("rewardCredits"),
                balance: null,
            };
        }
        if (state !== "waiting" && state !== "ready") {
            throw new https_1.HttpsError("failed-precondition", "That box isn't ready.");
        }
        if (Date.now() < readyAt) {
            throw new https_1.HttpsError("failed-precondition", "That box isn't ready yet.");
        }
        const rewardCredits = (0, economy_1.pickWeighted)(def.segments);
        // openedAt is part of the key so the next cycle of the same box gets its
        // own ledger row, but a retry of *this* claim does not.
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: rewardCredits,
            type: "prize_box",
            idempotencyKey: `prize_${tier}_${openedAt}`,
            ref: tier,
            note: `${tier} box`,
        });
        tx.update(ref, {
            state: "claimed",
            rewardCredits,
            claimedAt: Date.now(),
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        return { ok: true, duplicate: false, rewardCredits, balance };
    });
});
/**
 * Moves a claimed box back to idle so it can be opened again. Separate from
 * claim so the UI can show the "+250" result before the card resets.
 */
exports.resetPrizeBox = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { tier } = TierInput.parse(req.data);
    const ref = economy_1.db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);
    // Clear the spent cycle rather than merging one field over stale data, so
    // a box in the database is self-describing.
    await ref.set({
        state: "idle",
        openedAt: null,
        readyAt: null,
        rewardCredits: null,
        claimedAt: null,
        updatedAt: economy_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
});
//# sourceMappingURL=prizes.js.map
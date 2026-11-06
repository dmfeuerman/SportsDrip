"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPrizeBox = exports.claimPrizeBox = exports.openPrizeBox = exports.PITY_AFTER = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
/** Claims in a row without the top prize before it is guaranteed (shown in the app). */
exports.PITY_AFTER = 15;
const streak_1 = require("../lib/streak");
const TierInput = zod_1.z.object({ tier: zod_1.z.enum(["bronze", "silver", "gold"]) });
/**
 * Prize box state lives at users/{uid}/prizeBoxes/{tier} and is written only by
 * these functions.
 *
 *  - `readyAt` is computed from the *server* clock, so changing the phone's
 *    time does nothing
 *  - state is in Firestore, not AsyncStorage, so it survives reinstall, logout,
 *    and follows the user to a second device
 *  - the box goes `waiting -> ready -> claimed -> idle` explicitly
 *  - the reward is drawn on the server (S3) and includes a small daily pick
 *    streak bonus when the user has an active streak (America/New_York)
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
    const userRef = economy_1.db.collection("users").doc(uid);
    const ref = userRef.collection("prizeBoxes").doc(tier);
    return economy_1.db.runTransaction(async (tx) => {
        const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
        if (!snap.exists)
            throw new https_1.HttpsError("failed-precondition", "That box isn't open yet.");
        const state = snap.get("state");
        const readyAt = snap.get("readyAt") ?? 0;
        const openedAt = snap.get("openedAt") ?? 0;
        const now = Date.now();
        if (state === "claimed") {
            return {
                ok: true,
                duplicate: true,
                rewardCredits: snap.get("rewardCredits"),
                baseCredits: snap.get("baseCredits") ?? snap.get("rewardCredits"),
                streakBonus: snap.get("streakBonus") ?? 0,
                streakDays: snap.get("streakDays") ?? 0,
                balance: null,
            };
        }
        if (state !== "waiting" && state !== "ready") {
            throw new https_1.HttpsError("failed-precondition", "That box isn't ready.");
        }
        if (now < readyAt) {
            throw new https_1.HttpsError("failed-precondition", "That box isn't ready yet.");
        }
        // Pity: the top prize is guaranteed by the PITY_AFTER-th claim without one.
        const top = Math.max(...def.segments.map((s) => s.credits));
        const sinceTop = userSnap.get(`boxPity.${tier}`) ?? 0;
        const baseCredits = sinceTop + 1 >= exports.PITY_AFTER ? top : (0, economy_1.pickWeighted)(def.segments);
        const streakState = userSnap.get("streak");
        const streakDays = (0, streak_1.activeStreakCount)(streakState, now);
        const streakBonus = (0, streak_1.streakBonusFor)(tier, streakDays);
        const rewardCredits = baseCredits + streakBonus;
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: rewardCredits,
            type: "prize_box",
            idempotencyKey: `prize_${tier}_${openedAt}`,
            ref: tier,
            note: streakBonus > 0 ? `${tier} box (+${streakBonus} streak)` : `${tier} box`,
        });
        tx.update(userRef, { [`boxPity.${tier}`]: baseCredits === top ? 0 : sinceTop + 1 });
        tx.update(ref, {
            state: "claimed",
            rewardCredits,
            baseCredits,
            streakBonus,
            streakDays,
            claimedAt: now,
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        return {
            ok: true,
            duplicate: false,
            rewardCredits,
            baseCredits,
            streakBonus,
            streakDays,
            balance,
        };
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
    await ref.set({
        state: "idle",
        openedAt: null,
        readyAt: null,
        rewardCredits: null,
        baseCredits: null,
        streakBonus: null,
        streakDays: null,
        claimedAt: null,
        updatedAt: economy_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
});
//# sourceMappingURL=prizes.js.map
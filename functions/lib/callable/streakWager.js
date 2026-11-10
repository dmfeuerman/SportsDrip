"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streakWager = void 0;
const https_1 = require("firebase-functions/v2/https");
const economy_1 = require("../lib/economy");
const streak_1 = require("../lib/streak");
const streakWager_1 = require("../lib/streakWager");
/**
 * streakWager({ action: "place", stake }) stakes credits on adding 7 days to
 * your pick streak. streakWager({ action: "settle" }) grades the open wager
 * against the streak the server already tracks; the client calls it when it
 * sees the wager is decided, and the result never depends on what it sends.
 */
exports.streakWager = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const action = req.data?.action === "settle" ? "settle" : "place";
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        if (!user.exists)
            throw new https_1.HttpsError("not-found", "Profile not found.");
        const now = Date.now();
        const streak = user.get("streak") ?? null;
        const open = user.get("streakWager") ?? null;
        if (action === "settle") {
            if (!open)
                return { ok: true, state: "none", credits: 0 };
            const state = (0, streakWager_1.evaluateWager)(open, streak, now);
            if (state === "active")
                return { ok: true, state, credits: 0 };
            const credits = state === "won" ? open.stake * streakWager_1.WAGER_MULTIPLIER : 0;
            if (credits > 0) {
                await (0, economy_1.applyCredits)(tx, uid, {
                    delta: credits,
                    type: "streak_wager",
                    idempotencyKey: `streak_wager_win_${open.startDay}`,
                    ref: open.startDay,
                    note: `Streak wager won: ${streakWager_1.WAGER_DAYS} days`,
                });
            }
            tx.update(userRef, { streakWager: economy_1.FieldValue.delete(), streakWagerLast: { state, stake: open.stake, credits, at: now } });
            return { ok: true, state, credits };
        }
        const stake = Number(req.data?.stake);
        if (!streakWager_1.WAGER_STAKES.includes(stake))
            throw new https_1.HttpsError("invalid-argument", "Pick one of the listed stakes.");
        if (open)
            throw new https_1.HttpsError("failed-precondition", "You already have a streak wager running.");
        const breakUntil = user.get("limits.breakUntil");
        if (breakUntil && breakUntil > now)
            throw new https_1.HttpsError("failed-precondition", "You're on a break. Wagers open again when it ends.");
        const startCount = (0, streak_1.activeStreakCount)(streak, now);
        const startDay = (0, streak_1.nyDay)(now);
        const wager = { stake, startCount, startDay, target: startCount + streakWager_1.WAGER_DAYS };
        // Reads are done (applyCredits reads the same user doc first); now charge and record.
        await (0, economy_1.applyCredits)(tx, uid, {
            delta: -stake,
            type: "streak_wager",
            idempotencyKey: `streak_wager_${startDay}`,
            ref: startDay,
            note: `Streak wager: ${streakWager_1.WAGER_DAYS} more days`,
        });
        tx.update(userRef, { streakWager: wager });
        return { ok: true, state: "active", wager };
    });
});
//# sourceMappingURL=streakWager.js.map
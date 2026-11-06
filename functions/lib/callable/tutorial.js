"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimTutorialGift = exports.TUTORIAL_GIFT = void 0;
const https_1 = require("firebase-functions/v2/https");
const economy_1 = require("../lib/economy");
/** The first-bet tutorial's prize box. */
exports.TUTORIAL_GIFT = 10;
/**
 * Pays the first-bet tutorial's prize box: 10 credits, once per account, and
 * only to a player who has never placed a bet (single, parlay or daily pick).
 * The ledger id is fixed per user, so replays, retries or a modified client
 * can't claim it twice (applyCredits returns null when it's already paid).
 */
exports.claimTutorialGift = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const [user, bet, parlay] = await Promise.all([
            tx.get(userRef),
            tx.get(economy_1.db.collection("bets").where("uid", "==", uid).limit(1)),
            tx.get(economy_1.db.collection("slipParlays").where("uid", "==", uid).limit(1)),
        ]);
        const placed = (user.get("stats.betsPlaced") ?? 0) > 0 || !bet.empty || !parlay.empty;
        if (placed)
            throw new https_1.HttpsError("failed-precondition", "The first-bet prize box is only for players who haven't placed a bet yet.");
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: exports.TUTORIAL_GIFT,
            type: "tutorial_gift",
            idempotencyKey: "tutorial_gift",
            ref: "tutorial",
            note: "First-bet tutorial prize box",
        });
        if (balance !== null)
            tx.update(userRef, { tutorialGiftAt: Date.now() });
        return { ok: true, credits: balance === null ? 0 : exports.TUTORIAL_GIFT, balance, already: balance === null };
    });
});
//# sourceMappingURL=tutorial.js.map
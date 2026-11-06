"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimWinBackBox = void 0;
const https_1 = require("firebase-functions/v2/https");
const economy_1 = require("../lib/economy");
const winBack_1 = require("../lib/winBack");
/** Returning-player Prize Box (silver odds). One per lapse, keyed by the lapse's lastDay. */
exports.claimWinBackBox = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        const state = user.get("winBack");
        if (!(0, winBack_1.canClaimWinBack)(state))
            throw new https_1.HttpsError("failed-precondition", "No welcome-back box right now.");
        const credits = (0, economy_1.pickWeighted)(economy_1.PRIZE_BOXES.silver.segments);
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: credits,
            type: "win_back",
            idempotencyKey: `winback_${state.lastDay}`,
            ref: "win_back",
            note: "Welcome-back Prize Box",
        });
        const now = Date.now();
        tx.update(userRef, { "winBack.pending": false, "winBack.claimedAt": now });
        return { ok: true, credits: balance === null ? 0 : credits, balance };
    });
});
//# sourceMappingURL=winBack.js.map
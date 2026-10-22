"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payLeagueBuyIn = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
/**
 * Bridge for the league feature during the migration.
 *
 * Leagues have not moved behind the trusted boundary yet (AUDIT §6, Pass 2) —
 * they still write `members.{uid}.leagueTokens` from the client. But the *real*
 * credit balance is now server-owned, so `LeagueContext`'s old trick of calling
 * `addTokens(-buyIn)` to charge for entry no longer has anything to call
 * (AUDIT B9: that helper also had no floor, so buy-ins could take a user
 * negative).
 *
 * `payLeagueBuyIn` is deliberately debit-only. There is no matching "credit me"
 * callable, because a client-directed grant is exactly the hole this whole pass
 * exists to close. League payouts have to be computed server-side from final
 * standings, which is Pass 2 work — until then `endLeague` records the result
 * and pays nothing.
 */
exports.payLeagueBuyIn = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { leagueId, idempotencyKey } = zod_1.z
        .object({ leagueId: zod_1.z.string().min(1), idempotencyKey: zod_1.z.string().min(8).max(64) })
        .parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(leagueRef);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        if (league.get("status") !== "active") {
            throw new https_1.HttpsError("failed-precondition", "That league has ended.");
        }
        // The amount comes from the league document, never from the client.
        const buyIn = league.get("buyIn") ?? 0;
        if (buyIn <= 0)
            return { ok: true, charged: 0, balance: null };
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -buyIn,
            type: "league_buy_in",
            idempotencyKey: `league_buyin_${leagueId}_${idempotencyKey}`,
            ref: leagueId,
            note: league.get("name") ?? leagueId,
        });
        return { ok: true, charged: buyIn, balance };
    });
});
//# sourceMappingURL=leagues.js.map
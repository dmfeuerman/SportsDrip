"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xpOnFriendship = exports.xpOnLeagueBet = exports.xpOnLedger = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const progression_1 = require("../lib/progression");
const xp_1 = require("../lib/xp");
const achievements_1 = require("../lib/achievements");
/**
 * XP is a side effect of things that already committed — a ledger row, a
 * settled league bet, a new friendship — never part of their transaction.
 * Every grant is keyed on the source document, so a redelivered event is a
 * no-op.
 */
/** Wins, purchases, prize boxes, league payouts and ad rewards all leave a ledger row. */
exports.xpOnLedger = (0, firestore_1.onDocumentCreated)({ document: "users/{uid}/ledger/{entryId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const row = event.data?.data();
    if (!row)
        return;
    const { uid, entryId } = event.params;
    let stake;
    if (row.type === "bet_payout" && typeof row.ref === "string") {
        const bet = await economy_1.db.collection("bets").doc(row.ref).get();
        stake = bet.exists ? bet.get("stake") : undefined;
    }
    const amount = (0, progression_1.xpForLedger)(row.type, row.delta, stake);
    if (amount <= 0)
        return;
    const res = await (0, xp_1.grantXp)(uid, amount, `ledger_${entryId}`, String(row.type));
    if (res.levelsGained)
        firebase_functions_1.logger.info("level up", { uid, level: res.level, credits: res.credits, unlocks: res.unlocks.length });
    await (0, achievements_1.checkAchievements)(uid).catch((err) => firebase_functions_1.logger.warn("achievements", { uid, error: String(err) }));
});
/** League bets are paid in league tokens (no ledger row), so wins are caught here. */
exports.xpOnLeagueBet = (0, firestore_1.onDocumentUpdated)({ document: "leagues/{leagueId}/leagueBets/{betId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status || after.status !== "won")
        return;
    const uid = after.uid;
    if (!uid)
        return;
    await (0, xp_1.grantXp)(uid, progression_1.XP.leagueBetWin, `lbet_${event.params.betId}`, "league_bet_won");
    await (0, achievements_1.checkAchievements)(uid).catch(() => []);
});
/** Both players get XP for a new friendship, however it was made. */
exports.xpOnFriendship = (0, firestore_1.onDocumentCreated)({ document: "friendships/{pairId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const users = event.data?.get("users");
    if (!Array.isArray(users))
        return;
    await Promise.all(users.map((u) => (0, xp_1.grantXp)(u, progression_1.XP.newFriend, `friend_${event.params.pairId}`, "new_friend")));
    await Promise.all(users.map((u) => (0, achievements_1.checkAchievements)(u).catch(() => [])));
});
//# sourceMappingURL=xp.js.map
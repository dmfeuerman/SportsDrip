"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.challengesOnParlay = exports.challengesOnBet = exports.xpOnFriendship = exports.xpOnLeagueBet = exports.xpOnLedger = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const levelChallenges_1 = require("../callable/levelChallenges");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const progression_1 = require("../lib/progression");
const achievements_1 = require("../lib/achievements");
/**
 * XP comes only from level challenges (callable/levelChallenges.ts), each
 * claimable once per level. These triggers no longer grant XP; they keep
 * checking achievements after the events that can earn one.
 *
 * (Previously: XP as a side effect of things that already committed — a ledger row, a
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
    // Boxes, purchases, videos and payouts can finish a level challenge.
    await (0, levelChallenges_1.autoClaimSoon)(uid);
    // Only rows that used to earn XP are achievement-relevant (wins, buys, boxes…).
    if ((0, progression_1.xpForLedger)(row.type, row.delta, stake) <= 0)
        return;
    void entryId;
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
    await (0, levelChallenges_1.autoClaimSoon)(uid);
    await (0, achievements_1.checkAchievements)(uid).catch(() => []);
});
/** Both players get XP for a new friendship, however it was made. */
exports.xpOnFriendship = (0, firestore_1.onDocumentCreated)({ document: "friendships/{pairId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const users = event.data?.get("users");
    if (!Array.isArray(users))
        return;
    await Promise.all(users.map((u) => (0, levelChallenges_1.autoClaimSoon)(u)));
    await Promise.all(users.map((u) => (0, achievements_1.checkAchievements)(u).catch(() => [])));
});
/** A bet placed (bets, free bets) or won (wins) can finish a level challenge. */
exports.challengesOnBet = (0, firestore_1.onDocumentWritten)({ document: "bets/{betId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after)
        return;
    const placed = !before;
    const won = before?.status !== "won" && after.status === "won";
    if (placed || won)
        await (0, levelChallenges_1.autoClaimSoon)(after.uid);
});
/** Parlays live in their own collection. */
exports.challengesOnParlay = (0, firestore_1.onDocumentCreated)({ document: "slipParlays/{id}", region: "us-central1", timeoutSeconds: 30 }, async (event) => (0, levelChallenges_1.autoClaimSoon)(event.data?.get("uid")));
//# sourceMappingURL=xp.js.map
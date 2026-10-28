"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundStaleBets = exports.settleBetsSweep = exports.onGameFinal = void 0;
exports.settleBetsForGame = settleBetsForGame;
exports.settleLeagueBetsForGame = settleLeagueBetsForGame;
exports.refundStale = refundStale;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const settlement_1 = require("../lib/settlement");
/**
 * Settles every pending bet on a finished game — main-wallet bets in `bets/*`
 * and league bets in `leagues/{id}/leagueBets/*`.
 *
 * Guarantees:
 *  - one transaction per bet, so a partial failure settles the rest
 *  - `status !== "pending"` is re-checked inside the transaction, closing the
 *    race between the scheduled sweep and the onGameFinal trigger
 *  - the ledger idempotency key is the bet id, so a retried run cannot pay twice
 *  - the result notification is written in the same transaction as the money,
 *    under a deterministic id: no payout without a popup, no popup without a
 *    payout, and never two of either
 *  - draws are refunded as a push (B11)
 */
function summarize(id, bet, homeScore, awayScore) {
    return {
        betId: id,
        gameId: bet.get("gameId"),
        sport: bet.get("sport") ?? null,
        side: bet.get("side"),
        teamName: bet.get("teamName") ?? bet.get("teamAbbr"),
        teamAbbr: bet.get("teamAbbr"),
        teamColor: bet.get("teamColor") ?? "#888888",
        opponentAbbr: bet.get("opponentAbbr") ?? "OPP",
        odds: bet.get("odds"),
        stake: bet.get("stake"),
        payout: bet.get("potentialPayout"),
        finalHomeScore: homeScore,
        finalAwayScore: awayScore,
    };
}
async function finalScores(gameId) {
    const gameSnap = await economy_1.db.collection("games").doc(gameId).get();
    if (!gameSnap.exists || gameSnap.get("status") !== "final")
        return null;
    const home = gameSnap.get("homeScore");
    const away = gameSnap.get("awayScore");
    if (home === null || away === null || home === undefined || away === undefined) {
        firebase_functions_1.logger.warn("final game missing scores", { gameId });
        return null;
    }
    return { home, away };
}
/** Main wallet. Exported for tests. */
async function settleBetsForGame(gameId) {
    const scores = await finalScores(gameId);
    if (!scores)
        return 0;
    const pending = await economy_1.db
        .collection("bets")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    for (const doc of pending.docs) {
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const userRef = (uid) => economy_1.db.collection("users").doc(uid);
                const bet = await tx.get(doc.ref);
                if (!bet.exists || bet.get("status") !== "pending")
                    return false; // already handled
                const uid = bet.get("uid");
                const side = bet.get("side");
                const stake = bet.get("stake");
                const payout = bet.get("potentialPayout");
                const outcome = (0, settlement_1.decide)(side, scores.home, scores.away);
                const credit = (0, settlement_1.settlementCredit)(outcome, stake, payout);
                let balanceAfter;
                if (credit > 0) {
                    balanceAfter = await (0, economy_1.applyCredits)(tx, uid, {
                        delta: credit,
                        type: outcome === "won" ? "bet_payout" : "bet_refund",
                        idempotencyKey: `settle_${doc.id}`,
                        ref: doc.id,
                        note: outcome === "won" ? `Won ${bet.get("teamAbbr")}` : "Draw — stake returned",
                    });
                }
                else {
                    // Read before any write: Firestore transactions require it.
                    const u = await tx.get(userRef(uid));
                    balanceAfter = u.get("balance") ?? null;
                }
                const stats = outcome === "won"
                    ? { "stats.betsWon": economy_1.FieldValue.increment(1), "stats.creditsWon": economy_1.FieldValue.increment(payout - stake) }
                    : outcome === "push"
                        ? { "stats.betsPush": economy_1.FieldValue.increment(1) }
                        : { "stats.betsLost": economy_1.FieldValue.increment(1) };
                tx.update(userRef(uid), stats);
                tx.update(doc.ref, {
                    status: outcome,
                    finalHomeScore: scores.home,
                    finalAwayScore: scores.away,
                    settledAt: economy_1.FieldValue.serverTimestamp(),
                });
                (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                    outcome,
                    bet: summarize(doc.id, bet, scores.home, scores.away),
                    balanceAfter,
                    wallet: "credits",
                    now: Date.now(),
                }));
                return true;
            });
            if (did)
                settled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle bet", { betId: doc.id, err });
        }
    }
    return settled;
}
/**
 * League wallet. Same rules, but the money is the member's league tokens on
 * the league document rather than the real credit balance. Exported for tests.
 */
async function settleLeagueBetsForGame(gameId) {
    const scores = await finalScores(gameId);
    if (!scores)
        return 0;
    const pending = await economy_1.db
        .collectionGroup("leagueBets")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    for (const doc of pending.docs) {
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const bet = await tx.get(doc.ref);
                if (!bet.exists || bet.get("status") !== "pending")
                    return false;
                const leagueId = bet.get("leagueId");
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const league = await tx.get(leagueRef);
                const uid = bet.get("uid");
                const member = league.get(`members.${uid}`);
                // Ended leagues void their open bets at the end; a member who left
                // can't have open bets. Either way there is nothing to pay into.
                if (!league.exists || league.get("status") !== "active" || !member)
                    return false;
                const side = bet.get("side");
                const stake = bet.get("stake");
                const payout = bet.get("potentialPayout");
                const outcome = (0, settlement_1.decide)(side, scores.home, scores.away);
                const credit = (0, settlement_1.settlementCredit)(outcome, stake, payout);
                const balanceAfter = member.leagueTokens + credit;
                const leagueName = league.get("name") ?? "your league";
                const counter = outcome === "won" ? "betsWon" : outcome === "push" ? "betsPush" : "betsLost";
                tx.update(leagueRef, {
                    [`members.${uid}.leagueTokens`]: economy_1.FieldValue.increment(credit),
                    [`members.${uid}.${counter}`]: economy_1.FieldValue.increment(1),
                    lastActivityAt: Date.now(),
                });
                tx.update(doc.ref, {
                    status: outcome,
                    finalHomeScore: scores.home,
                    finalAwayScore: scores.away,
                    settledAt: economy_1.FieldValue.serverTimestamp(),
                });
                const name = bet.get("displayName") ?? "A member";
                const teamAbbr = bet.get("teamAbbr");
                tx.set(leagueRef.collection("activity").doc(`settle_${doc.id}`), {
                    type: outcome === "won" ? "bet_won" : outcome === "push" ? "bet_push" : "bet_lost",
                    uid,
                    name,
                    amount: outcome === "won" ? payout - stake : outcome === "push" ? 0 : -stake,
                    text: outcome === "won"
                        ? `${name} cashed ${teamAbbr} for +${(payout - stake).toLocaleString("en-US")}`
                        : outcome === "push"
                            ? `${name}'s ${teamAbbr} bet pushed`
                            : `${name} lost ${stake.toLocaleString("en-US")} on ${teamAbbr}`,
                    at: Date.now(),
                });
                (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                    outcome,
                    bet: summarize(doc.id, bet, scores.home, scores.away),
                    balanceAfter,
                    wallet: "league",
                    leagueId,
                    leagueName,
                    now: Date.now(),
                }));
                return true;
            });
            if (did)
                settled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle league bet", { betId: doc.id, err });
        }
    }
    return settled;
}
/**
 * Fires the moment syncGames flips a game to final. This is the fast path —
 * users see results within a couple of minutes of the whistle.
 */
exports.onGameFinal = (0, firestore_1.onDocumentUpdated)({ document: "games/{gameId}", region: "us-central1" }, async (event) => {
    const before = event.data?.before.get("status");
    const after = event.data?.after.get("status");
    if (before === "final" || after !== "final")
        return;
    const gameId = event.params.gameId;
    const settled = await settleBetsForGame(gameId);
    const leagueSettled = await settleLeagueBetsForGame(gameId);
    firebase_functions_1.logger.info("onGameFinal settled", { gameId, settled, leagueSettled });
});
/**
 * Safety net. Catches anything the trigger missed — a cold deploy, a dropped
 * event, a bet placed after the game already went final.
 */
exports.settleBetsSweep = (0, scheduler_1.onSchedule)({ schedule: "*/15 * * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const [pending, leaguePending] = await Promise.all([
        economy_1.db.collection("bets").where("status", "==", "pending").limit(1000).get(),
        economy_1.db.collectionGroup("leagueBets").where("status", "==", "pending").limit(1000).get(),
    ]);
    const gameIds = [...new Set(pending.docs.map((d) => d.get("gameId")))];
    const leagueGameIds = [...new Set(leaguePending.docs.map((d) => d.get("gameId")))];
    let total = 0;
    for (const gameId of gameIds)
        total += await settleBetsForGame(gameId);
    for (const gameId of leagueGameIds)
        total += await settleLeagueBetsForGame(gameId);
    if (total > 0)
        firebase_functions_1.logger.info("settleBetsSweep", { settled: total });
});
async function isOrphaned(gameId, cutoff) {
    const game = await economy_1.db.collection("games").doc(gameId).get();
    const startsAt = game.get("startsAt") ?? 0;
    return !game.exists || (startsAt > 0 && startsAt < cutoff && game.get("status") !== "final");
}
/** Exported for tests. */
async function refundStale(cutoff) {
    let refunded = 0;
    const pending = await economy_1.db.collection("bets").where("status", "==", "pending").limit(500).get();
    for (const doc of pending.docs) {
        if (!(await isOrphaned(doc.get("gameId"), cutoff)))
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const uid = bet.get("uid");
            const balanceAfter = await (0, economy_1.applyCredits)(tx, uid, {
                delta: bet.get("stake"),
                type: "bet_refund",
                idempotencyKey: `settle_${doc.id}`,
                ref: doc.id,
                note: "Game cancelled or postponed",
            });
            tx.update(doc.ref, { status: "cancelled", settledAt: economy_1.FieldValue.serverTimestamp() });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter,
                wallet: "credits",
                now: Date.now(),
            }));
            refunded++;
        });
        firebase_functions_1.logger.info("refunded stale bet", { betId: doc.id });
    }
    const leaguePending = await economy_1.db
        .collectionGroup("leagueBets")
        .where("status", "==", "pending")
        .limit(500)
        .get();
    for (const doc of leaguePending.docs) {
        if (!(await isOrphaned(doc.get("gameId"), cutoff)))
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const leagueId = bet.get("leagueId");
            const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
            const league = await tx.get(leagueRef);
            const uid = bet.get("uid");
            const member = league.get(`members.${uid}`);
            const stake = bet.get("stake");
            if (league.exists && league.get("status") === "active" && member) {
                tx.update(leagueRef, { [`members.${uid}.leagueTokens`]: economy_1.FieldValue.increment(stake) });
            }
            tx.update(doc.ref, { status: "cancelled", settledAt: economy_1.FieldValue.serverTimestamp() });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter: member ? member.leagueTokens + stake : null,
                wallet: "league",
                leagueId,
                leagueName: league.get("name") ?? null,
                now: Date.now(),
            }));
            refunded++;
        });
    }
    return refunded;
}
/**
 * Refunds bets on games that vanished from the provider (postponed, cancelled,
 * or pruned) and have been pending well past their start time.
 */
exports.refundStaleBets = (0, scheduler_1.onSchedule)({ schedule: "30 6 * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const n = await refundStale(Date.now() - 72 * 3_600_000);
    if (n > 0)
        firebase_functions_1.logger.info("refundStaleBets", { refunded: n });
});
//# sourceMappingURL=settleBets.js.map
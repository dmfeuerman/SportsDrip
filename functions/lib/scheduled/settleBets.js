"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundStaleBets = exports.settleBetsSweep = exports.onGameFinal = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
/**
 * Settles every pending bet on a finished game.
 *
 * This is the fix for B1 — the single most important bug in the app. The old
 * `resolveBets` existed but had no call sites, so credits were debited on
 * placement and never returned. Settlement also has to be server-side per §24:
 * the phone must never decide whether it won.
 *
 * Guarantees:
 *  - one transaction per bet, so a partial failure settles the rest
 *  - the ledger idempotency key is the bet id, so a retried run cannot pay twice
 *  - `status !== "pending"` is re-checked inside the transaction, closing the
 *    race between the scheduled run and the onGameFinal trigger below
 *  - draws are refunded as a push instead of being scored as an away win (B11)
 */
function decide(side, homeScore, awayScore) {
    if (homeScore === awayScore)
        return "push";
    const homeWon = homeScore > awayScore;
    return (side === "home") === homeWon ? "won" : "lost";
}
async function settleBetsForGame(gameId) {
    const gameSnap = await economy_1.db.collection("games").doc(gameId).get();
    if (!gameSnap.exists || gameSnap.get("status") !== "final")
        return 0;
    const homeScore = gameSnap.get("homeScore");
    const awayScore = gameSnap.get("awayScore");
    if (homeScore === null || awayScore === null) {
        firebase_functions_1.logger.warn("final game missing scores", { gameId });
        return 0;
    }
    const pending = await economy_1.db
        .collection("bets")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    for (const doc of pending.docs) {
        try {
            await economy_1.db.runTransaction(async (tx) => {
                const bet = await tx.get(doc.ref);
                if (!bet.exists || bet.get("status") !== "pending")
                    return; // already handled
                const uid = bet.get("uid");
                const side = bet.get("side");
                const stake = bet.get("stake");
                const payout = bet.get("potentialPayout");
                const outcome = decide(side, homeScore, awayScore);
                if (outcome === "won") {
                    await (0, economy_1.applyCredits)(tx, uid, {
                        delta: payout,
                        type: "bet_payout",
                        idempotencyKey: `settle_${doc.id}`,
                        ref: doc.id,
                        note: `Won ${bet.get("teamAbbr")}`,
                    });
                    tx.update(economy_1.db.collection("users").doc(uid), {
                        "stats.betsWon": economy_1.FieldValue.increment(1),
                        "stats.creditsWon": economy_1.FieldValue.increment(payout - stake),
                    });
                }
                else if (outcome === "push") {
                    await (0, economy_1.applyCredits)(tx, uid, {
                        delta: stake,
                        type: "bet_refund",
                        idempotencyKey: `settle_${doc.id}`,
                        ref: doc.id,
                        note: "Draw — stake returned",
                    });
                    tx.update(economy_1.db.collection("users").doc(uid), {
                        "stats.betsPush": economy_1.FieldValue.increment(1),
                    });
                }
                else {
                    // Stake was already taken at placement; nothing to move.
                    tx.update(economy_1.db.collection("users").doc(uid), {
                        "stats.betsLost": economy_1.FieldValue.increment(1),
                    });
                }
                tx.update(doc.ref, {
                    status: outcome,
                    finalHomeScore: homeScore,
                    finalAwayScore: awayScore,
                    settledAt: economy_1.FieldValue.serverTimestamp(),
                });
            });
            settled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle bet", { betId: doc.id, err });
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
    const settled = await settleBetsForGame(event.params.gameId);
    firebase_functions_1.logger.info("onGameFinal settled", { gameId: event.params.gameId, settled });
});
/**
 * Safety net. Catches anything the trigger missed — a cold deploy, a dropped
 * event, a bet placed after the game already went final. §4 asks that the
 * system stay correct when the user's device is offline or closed; this is what
 * makes that true.
 */
exports.settleBetsSweep = (0, scheduler_1.onSchedule)({ schedule: "*/15 * * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const pending = await economy_1.db
        .collection("bets")
        .where("status", "==", "pending")
        .limit(1000)
        .get();
    const gameIds = [...new Set(pending.docs.map((d) => d.get("gameId")))];
    let total = 0;
    for (const gameId of gameIds) {
        total += await settleBetsForGame(gameId);
    }
    if (total > 0)
        firebase_functions_1.logger.info("settleBetsSweep", { gameIds: gameIds.length, settled: total });
});
/**
 * Refunds bets on games that vanished from the provider (postponed, cancelled,
 * or pruned) and have been pending well past their start time.
 */
exports.refundStaleBets = (0, scheduler_1.onSchedule)({ schedule: "30 6 * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const cutoff = Date.now() - 72 * 3_600_000;
    const pending = await economy_1.db
        .collection("bets")
        .where("status", "==", "pending")
        .limit(500)
        .get();
    for (const doc of pending.docs) {
        const gameId = doc.get("gameId");
        const game = await economy_1.db.collection("games").doc(gameId).get();
        const startsAt = game.get("startsAt") ?? 0;
        const orphaned = !game.exists || (startsAt > 0 && startsAt < cutoff && game.get("status") !== "final");
        if (!orphaned)
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            await (0, economy_1.applyCredits)(tx, bet.get("uid"), {
                delta: bet.get("stake"),
                type: "bet_refund",
                idempotencyKey: `settle_${doc.id}`,
                ref: doc.id,
                note: "Game cancelled or postponed",
            });
            tx.update(doc.ref, {
                status: "cancelled",
                settledAt: economy_1.FieldValue.serverTimestamp(),
            });
        });
        firebase_functions_1.logger.info("refunded stale bet", { betId: doc.id, gameId });
    }
});
//# sourceMappingURL=settleBets.js.map
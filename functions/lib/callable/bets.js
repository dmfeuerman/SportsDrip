"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelBet = exports.placeBet = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const MIN_STAKE = 10;
const MAX_STAKE = 100_000;
const PlaceBetInput = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]),
    stake: zod_1.z.number().int().min(MIN_STAKE).max(MAX_STAKE),
    /** Client-generated UUID. Same key = same bet, however many times it's sent. */
    idempotencyKey: zod_1.z.string().min(8).max(64),
    /** Decimal odds the user was shown. Optional so older clients keep working. */
    expectedOdds: zod_1.z.number().positive().max(100).optional(),
    /** Optional head-to-head challenge against a friend. */
    opponentUid: zod_1.z.string().min(1).optional(),
});
/**
 * Places a bet. Everything that used to be decided on the device is decided
 * here (S2):
 *
 *  - the stake is debited inside a transaction that cannot go negative (B9)
 *  - the odds are read from the server's cached game document, not sent by the
 *    client, so a patched bundle can't claim 50x
 *  - the game must exist and still be `upcoming`, which also kills betting
 *    against the mock-data fallback (A3)
 *  - `idempotencyKey` makes a double-tap or a network retry a no-op (B10)
 */
exports.placeBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = PlaceBetInput.parse(req.data);
    const betId = `${uid}_${input.idempotencyKey}`;
    const betRef = economy_1.db.collection("bets").doc(betId);
    const gameRef = economy_1.db.collection("games").doc(input.gameId);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, gameSnap] = await Promise.all([tx.get(betRef), tx.get(gameRef)]);
        if (existing.exists) {
            return { ok: true, betId, duplicate: true, balance: null };
        }
        if (!gameSnap.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        const status = gameSnap.get("status");
        if (status !== "upcoming") {
            throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
        }
        const startsAt = gameSnap.get("startsAt") ?? 0;
        if (startsAt && startsAt < Date.now()) {
            throw new https_1.HttpsError("failed-precondition", "This game has already started.");
        }
        const team = gameSnap.get(input.side === "home" ? "homeTeam" : "awayTeam");
        const opponent = gameSnap.get(input.side === "home" ? "awayTeam" : "homeTeam");
        // Prices track a real moneyline now, so they move between syncs. Drift in
        // the user's favour applies silently; drift against them fails loudly
        // rather than quietly shrinking the payout they were shown.
        if (input.expectedOdds && team.odds < input.expectedOdds * 0.95) {
            throw new https_1.HttpsError("aborted", `The price moved to ${team.odds.toFixed(2)}x before this went through. Tap again to take it.`);
        }
        if (input.opponentUid) {
            const friendship = await tx.get(economy_1.db
                .collection("friendships")
                .doc(uid < input.opponentUid ? `${uid}_${input.opponentUid}` : `${input.opponentUid}_${uid}`));
            if (!friendship.exists) {
                throw new https_1.HttpsError("permission-denied", "You can only challenge friends.");
            }
        }
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -input.stake,
            type: "bet_stake",
            idempotencyKey: `bet_stake_${input.idempotencyKey}`,
            ref: betId,
            note: `${team.abbreviation} vs ${opponent.abbreviation}`,
        });
        tx.set(betRef, {
            id: betId,
            uid,
            gameId: input.gameId,
            sport: gameSnap.get("sport"),
            side: input.side,
            teamName: team.name,
            teamAbbr: team.abbreviation,
            teamColor: team.color,
            opponentAbbr: opponent.abbreviation,
            stake: input.stake,
            odds: team.odds,
            potentialPayout: Math.round(input.stake * team.odds),
            status: "pending",
            opponentUid: input.opponentUid ?? null,
            placedAt: economy_1.FieldValue.serverTimestamp(),
            settledAt: null,
        });
        tx.update(economy_1.db.collection("users").doc(uid), {
            "stats.betsPlaced": economy_1.FieldValue.increment(1),
            "stats.creditsStaked": economy_1.FieldValue.increment(input.stake),
        });
        return { ok: true, betId, duplicate: false, balance };
    });
});
/**
 * Cancels a still-unsettled bet on a game that hasn't started, refunding the
 * stake. There was no cancel path at all before (§4).
 */
exports.cancelBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const betId = zod_1.z.string().min(1).parse(req.data?.betId);
    const betRef = economy_1.db.collection("bets").doc(betId);
    return economy_1.db.runTransaction(async (tx) => {
        const bet = await tx.get(betRef);
        if (!bet.exists)
            throw new https_1.HttpsError("not-found", "Bet not found.");
        if (bet.get("uid") !== uid)
            throw new https_1.HttpsError("permission-denied", "Not your bet.");
        if (bet.get("status") !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "That bet is already settled.");
        }
        const game = await tx.get(economy_1.db.collection("games").doc(bet.get("gameId")));
        if (game.exists && game.get("status") !== "upcoming") {
            throw new https_1.HttpsError("failed-precondition", "The game has started — this bet is locked in.");
        }
        const stake = bet.get("stake");
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: stake,
            type: "bet_refund",
            idempotencyKey: `bet_cancel_${betId}`,
            ref: betId,
            note: "Cancelled before kickoff",
        });
        tx.update(betRef, { status: "cancelled", settledAt: economy_1.FieldValue.serverTimestamp() });
        tx.update(economy_1.db.collection("users").doc(uid), {
            "stats.betsPlaced": economy_1.FieldValue.increment(-1),
            "stats.creditsStaked": economy_1.FieldValue.increment(-stake),
        });
        return { ok: true, balance };
    });
});
//# sourceMappingURL=bets.js.map
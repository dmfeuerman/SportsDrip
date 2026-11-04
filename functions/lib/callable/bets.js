"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelBet = exports.placeBet = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const pricing_1 = require("../lib/pricing");
const streak_1 = require("../lib/streak");
const MIN_STAKE = 10;
const MAX_STAKE = 100_000;
const PlaceBetInput = zod_1.z
    .object({
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]).optional(),
    market: zod_1.z.enum(["ml", "spread", "total"]).optional(),
    selection: zod_1.z.enum(["home", "away", "over", "under"]).optional(),
    stake: zod_1.z.number().int().min(MIN_STAKE).max(MAX_STAKE),
    /** Client-generated UUID. Same key = same bet, however many times it's sent. */
    idempotencyKey: zod_1.z.string().min(8).max(64),
    /** Decimal odds the user was shown. Optional so older clients keep working. */
    expectedOdds: zod_1.z.number().positive().max(100).optional(),
    /** Spread or total line the user was shown. Rejects if it moved > 0.5. */
    expectedLine: zod_1.z.number().finite().optional(),
    /** Optional head-to-head challenge against a friend. */
    opponentUid: zod_1.z.string().min(1).optional(),
})
    .refine((v) => !!(v.selection || v.side), {
    message: "Pick a side or selection.",
});
/**
 * Places a bet. Everything that used to be decided on the device is decided
 * here (S2):
 *
 *  - the stake is debited inside a transaction that cannot go negative (B9)
 *  - the odds and line are read from the server's cached game document, not
 *    sent by the client, so a patched bundle can't claim 50x
 *  - supports moneyline ("ml"), point spread ("spread", 1.91x), and game total
 *    ("total", 1.91x), with a 0.5-point line freeze guard
 *  - the game must exist, not be disrupted, and still be `upcoming`
 *  - `idempotencyKey` makes a double-tap or a network retry a no-op (B10)
 *  - updates the user's America/New_York daily pick streak
 */
exports.placeBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = PlaceBetInput.parse(req.data);
    const betId = `${uid}_${input.idempotencyKey}`;
    const betRef = economy_1.db.collection("bets").doc(betId);
    const gameRef = economy_1.db.collection("games").doc(input.gameId);
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, gameSnap, userSnap] = await Promise.all([
            tx.get(betRef),
            tx.get(gameRef),
            tx.get(userRef),
        ]);
        if (existing.exists) {
            return { ok: true, betId, duplicate: true, balance: null };
        }
        if (!gameSnap.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        const status = gameSnap.get("status");
        if (status !== "upcoming") {
            throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
        }
        const now = Date.now();
        const startsAt = gameSnap.get("startsAt") ?? 0;
        if (startsAt && startsAt < now) {
            throw new https_1.HttpsError("failed-precondition", "This game has already started.");
        }
        const priced = (0, pricing_1.requirePricedMarket)(gameSnap, input);
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
            note: `${priced.label} vs ${priced.opponentAbbr}`,
        });
        const prevStreak = userSnap.get("streak");
        const streak = (0, streak_1.advanceStreak)(prevStreak, now);
        tx.set(betRef, {
            id: betId,
            uid,
            gameId: input.gameId,
            sport: gameSnap.get("sport"),
            market: priced.market,
            selection: priced.selection,
            side: priced.side,
            line: priced.line,
            label: priced.label,
            teamName: priced.teamName,
            teamAbbr: priced.teamAbbr,
            teamColor: priced.teamColor,
            opponentAbbr: priced.opponentAbbr,
            stake: input.stake,
            odds: priced.odds,
            potentialPayout: Math.round(input.stake * priced.odds),
            status: "pending",
            startsAt: startsAt || null,
            opponentUid: input.opponentUid ?? null,
            placedAt: economy_1.FieldValue.serverTimestamp(),
            settledAt: null,
        });
        tx.update(userRef, {
            "stats.betsPlaced": economy_1.FieldValue.increment(1),
            "stats.creditsStaked": economy_1.FieldValue.increment(input.stake),
            streak,
        });
        return { ok: true, betId, duplicate: false, balance, streak: streak.count };
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
        // Cancellable only before kickoff. The game's status lags the real start (the
        // sync runs every couple of minutes), so the scheduled start time decides too;
        // and a game we can't find is treated as started, never as cancellable.
        const game = await tx.get(economy_1.db.collection("games").doc(bet.get("gameId")));
        const startsAt = game.exists ? (game.get("startsAt") ?? 0) : 0;
        if (!game.exists || game.get("status") !== "upcoming" || !startsAt || startsAt <= Date.now()) {
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
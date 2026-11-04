import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { requirePricedMarket } from "../lib/pricing";
import { checkPlayLimits } from "../lib/playLimits";
import { advanceStreak, type StreakState } from "../lib/streak";

const MIN_STAKE = 10;
const MAX_STAKE = 100_000;

const PlaceBetInput = z
  .object({
    gameId: z.string().min(1),
    side: z.enum(["home", "away"]).optional(),
    market: z.enum(["ml", "spread", "total"]).optional(),
    selection: z.enum(["home", "away", "over", "under"]).optional(),
    stake: z.number().int().min(MIN_STAKE).max(MAX_STAKE),
    /** Client-generated UUID. Same key = same bet, however many times it's sent. */
    idempotencyKey: z.string().min(8).max(64),
    /** Decimal odds the user was shown. Optional so older clients keep working. */
    expectedOdds: z.number().positive().max(100).optional(),
    /** Spread or total line the user was shown. Rejects if it moved > 0.5. */
    expectedLine: z.number().finite().optional(),
    /** Optional head-to-head challenge against a friend. */
    opponentUid: z.string().min(1).optional(),
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
export const placeBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = PlaceBetInput.parse(req.data);

  const betId = `${uid}_${input.idempotencyKey}`;
  const betRef = db.collection("bets").doc(betId);
  const gameRef = db.collection("games").doc(input.gameId);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [existing, gameSnap, userSnap] = await Promise.all([
      tx.get(betRef),
      tx.get(gameRef),
      tx.get(userRef),
    ]);

    if (existing.exists) {
      return { ok: true, betId, duplicate: true, balance: null };
    }

    if (!gameSnap.exists) throw new HttpsError("not-found", "That game is no longer available.");

    const status = gameSnap.get("status") as string;
    if (status !== "upcoming") {
      throw new HttpsError("failed-precondition", "Betting is closed for this game.");
    }

    const now = Date.now();
    const limitUpdate = checkPlayLimits(userSnap, now);
    const startsAt = (gameSnap.get("startsAt") as number | undefined) ?? 0;
    if (startsAt && startsAt < now) {
      throw new HttpsError("failed-precondition", "This game has already started.");
    }

    const priced = requirePricedMarket(gameSnap, input);

    if (input.opponentUid) {
      const friendship = await tx.get(
        db
          .collection("friendships")
          .doc(uid < input.opponentUid ? `${uid}_${input.opponentUid}` : `${input.opponentUid}_${uid}`)
      );
      if (!friendship.exists) {
        throw new HttpsError("permission-denied", "You can only challenge friends.");
      }
    }

    const balance = await applyCredits(tx, uid, {
      delta: -input.stake,
      type: "bet_stake",
      idempotencyKey: `bet_stake_${input.idempotencyKey}`,
      ref: betId,
      note: `${priced.label} vs ${priced.opponentAbbr}`,
    });

    const prevStreak = userSnap.get("streak") as Partial<StreakState> | undefined;
    const streak = advanceStreak(prevStreak, now);

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
      placedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });

    tx.update(userRef, {
      "stats.betsPlaced": FieldValue.increment(1),
      "stats.creditsStaked": FieldValue.increment(input.stake),
      streak,
      ...limitUpdate,
    });

    return { ok: true, betId, duplicate: false, balance, streak: streak.count };
  });
});

/**
 * Cancels a still-unsettled bet on a game that hasn't started, refunding the
 * stake. There was no cancel path at all before (§4).
 */
export const cancelBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const betId = z.string().min(1).parse(req.data?.betId);

  const betRef = db.collection("bets").doc(betId);

  return db.runTransaction(async (tx) => {
    const bet = await tx.get(betRef);
    if (!bet.exists) throw new HttpsError("not-found", "Bet not found.");
    if (bet.get("uid") !== uid) throw new HttpsError("permission-denied", "Not your bet.");
    if (bet.get("status") !== "pending") {
      throw new HttpsError("failed-precondition", "That bet is already settled.");
    }

    // Cancellable only before kickoff. The game's status lags the real start (the
    // sync runs every couple of minutes), so the scheduled start time decides too;
    // and a game we can't find is treated as started, never as cancellable.
    const game = await tx.get(db.collection("games").doc(bet.get("gameId") as string));
    const startsAt = game.exists ? ((game.get("startsAt") as number | undefined) ?? 0) : 0;
    if (!game.exists || game.get("status") !== "upcoming" || !startsAt || startsAt <= Date.now()) {
      throw new HttpsError("failed-precondition", "The game has started — this bet is locked in.");
    }

    const stake = bet.get("stake") as number;
    const balance = await applyCredits(tx, uid, {
      delta: stake,
      type: "bet_refund",
      idempotencyKey: `bet_cancel_${betId}`,
      ref: betId,
      note: "Cancelled before kickoff",
    });

    tx.update(betRef, { status: "cancelled", settledAt: FieldValue.serverTimestamp() });
    tx.update(db.collection("users").doc(uid), {
      "stats.betsPlaced": FieldValue.increment(-1),
      "stats.creditsStaked": FieldValue.increment(-stake),
    });

    return { ok: true, balance };
  });
});

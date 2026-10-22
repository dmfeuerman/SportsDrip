import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";

const MIN_STAKE = 10;
const MAX_STAKE = 100_000;

const PlaceBetInput = z.object({
  gameId: z.string().min(1),
  side: z.enum(["home", "away"]),
  stake: z.number().int().min(MIN_STAKE).max(MAX_STAKE),
  /** Client-generated UUID. Same key = same bet, however many times it's sent. */
  idempotencyKey: z.string().min(8).max(64),
  /** Decimal odds the user was shown. Optional so older clients keep working. */
  expectedOdds: z.number().positive().max(100).optional(),
  /** Optional head-to-head challenge against a friend. */
  opponentUid: z.string().min(1).optional(),
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
export const placeBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = PlaceBetInput.parse(req.data);

  const betId = `${uid}_${input.idempotencyKey}`;
  const betRef = db.collection("bets").doc(betId);
  const gameRef = db.collection("games").doc(input.gameId);

  return db.runTransaction(async (tx) => {
    const [existing, gameSnap] = await Promise.all([tx.get(betRef), tx.get(gameRef)]);

    if (existing.exists) {
      return { ok: true, betId, duplicate: true, balance: null };
    }

    if (!gameSnap.exists) throw new HttpsError("not-found", "That game is no longer available.");

    const status = gameSnap.get("status") as string;
    if (status !== "upcoming") {
      throw new HttpsError("failed-precondition", "Betting is closed for this game.");
    }

    const startsAt = (gameSnap.get("startsAt") as number | undefined) ?? 0;
    if (startsAt && startsAt < Date.now()) {
      throw new HttpsError("failed-precondition", "This game has already started.");
    }

    const team = gameSnap.get(input.side === "home" ? "homeTeam" : "awayTeam") as {
      name: string;
      abbreviation: string;
      color: string;
      odds: number;
    };
    const opponent = gameSnap.get(input.side === "home" ? "awayTeam" : "homeTeam") as {
      abbreviation: string;
    };

    // Prices track a real moneyline now, so they move between syncs. Drift in
    // the user's favour applies silently; drift against them fails loudly
    // rather than quietly shrinking the payout they were shown.
    if (input.expectedOdds && team.odds < input.expectedOdds * 0.95) {
      throw new HttpsError(
        "aborted",
        `The price moved to ${team.odds.toFixed(2)}x before this went through. Tap again to take it.`
      );
    }

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
      placedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });

    tx.update(db.collection("users").doc(uid), {
      "stats.betsPlaced": FieldValue.increment(1),
      "stats.creditsStaked": FieldValue.increment(input.stake),
    });

    return { ok: true, betId, duplicate: false, balance };
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

    const game = await tx.get(db.collection("games").doc(bet.get("gameId") as string));
    if (game.exists && game.get("status") !== "upcoming") {
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

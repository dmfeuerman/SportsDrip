import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { applyCredits, db, FieldValue } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { betResultNotification, type BetOutcome, type BetSummary } from "../lib/notifyModel";
import { decide, settlementCredit } from "../lib/settlement";

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

function summarize(
  id: string,
  bet: FirebaseFirestore.DocumentSnapshot,
  homeScore: number | null,
  awayScore: number | null
): BetSummary {
  return {
    betId: id,
    gameId: bet.get("gameId") as string,
    sport: (bet.get("sport") as string | undefined) ?? null,
    side: bet.get("side") as "home" | "away",
    teamName: (bet.get("teamName") as string | undefined) ?? (bet.get("teamAbbr") as string),
    teamAbbr: bet.get("teamAbbr") as string,
    teamColor: (bet.get("teamColor") as string | undefined) ?? "#888888",
    opponentAbbr: (bet.get("opponentAbbr") as string | undefined) ?? "OPP",
    odds: bet.get("odds") as number,
    stake: bet.get("stake") as number,
    payout: bet.get("potentialPayout") as number,
    finalHomeScore: homeScore,
    finalAwayScore: awayScore,
  };
}

async function finalScores(gameId: string): Promise<{ home: number; away: number } | null> {
  const gameSnap = await db.collection("games").doc(gameId).get();
  if (!gameSnap.exists || gameSnap.get("status") !== "final") return null;
  const home = gameSnap.get("homeScore") as number | null;
  const away = gameSnap.get("awayScore") as number | null;
  if (home === null || away === null || home === undefined || away === undefined) {
    logger.warn("final game missing scores", { gameId });
    return null;
  }
  return { home, away };
}

/** Main wallet. Exported for tests. */
export async function settleBetsForGame(gameId: string): Promise<number> {
  const scores = await finalScores(gameId);
  if (!scores) return 0;

  const pending = await db
    .collection("bets")
    .where("gameId", "==", gameId)
    .where("status", "==", "pending")
    .limit(500)
    .get();

  let settled = 0;
  for (const doc of pending.docs) {
    try {
      const did = await db.runTransaction(async (tx) => {
        const userRef = (uid: string) => db.collection("users").doc(uid);
        const bet = await tx.get(doc.ref);
        if (!bet.exists || bet.get("status") !== "pending") return false; // already handled

        const uid = bet.get("uid") as string;
        const side = bet.get("side") as "home" | "away";
        const stake = bet.get("stake") as number;
        const payout = bet.get("potentialPayout") as number;
        const outcome = decide(side, scores.home, scores.away);
        const credit = settlementCredit(outcome, stake, payout);

        let balanceAfter: number | null;
        if (credit > 0) {
          balanceAfter = await applyCredits(tx, uid, {
            delta: credit,
            type: outcome === "won" ? "bet_payout" : "bet_refund",
            idempotencyKey: `settle_${doc.id}`,
            ref: doc.id,
            note: outcome === "won" ? `Won ${bet.get("teamAbbr")}` : "Draw — stake returned",
          });
        } else {
          // Read before any write: Firestore transactions require it.
          const u = await tx.get(userRef(uid));
          balanceAfter = (u.get("balance") as number | undefined) ?? null;
        }

        const stats =
          outcome === "won"
            ? { "stats.betsWon": FieldValue.increment(1), "stats.creditsWon": FieldValue.increment(payout - stake) }
            : outcome === "push"
              ? { "stats.betsPush": FieldValue.increment(1) }
              : { "stats.betsLost": FieldValue.increment(1) };
        tx.update(userRef(uid), stats);

        tx.update(doc.ref, {
          status: outcome,
          finalHomeScore: scores.home,
          finalAwayScore: scores.away,
          settledAt: FieldValue.serverTimestamp(),
        });

        writeNotification(
          tx,
          uid,
          betResultNotification({
            outcome,
            bet: summarize(doc.id, bet, scores.home, scores.away),
            balanceAfter,
            wallet: "credits",
            now: Date.now(),
          })
        );
        return true;
      });
      if (did) settled++;
    } catch (err) {
      logger.error("failed to settle bet", { betId: doc.id, err });
    }
  }
  return settled;
}

/**
 * League wallet. Same rules, but the money is the member's league tokens on
 * the league document rather than the real credit balance. Exported for tests.
 */
export async function settleLeagueBetsForGame(gameId: string): Promise<number> {
  const scores = await finalScores(gameId);
  if (!scores) return 0;

  const pending = await db
    .collectionGroup("leagueBets")
    .where("gameId", "==", gameId)
    .where("status", "==", "pending")
    .limit(500)
    .get();

  let settled = 0;
  for (const doc of pending.docs) {
    try {
      const did = await db.runTransaction(async (tx) => {
        const bet = await tx.get(doc.ref);
        if (!bet.exists || bet.get("status") !== "pending") return false;

        const leagueId = bet.get("leagueId") as string;
        const leagueRef = db.collection("leagues").doc(leagueId);
        const league = await tx.get(leagueRef);
        const uid = bet.get("uid") as string;
        const member = league.get(`members.${uid}`) as { leagueTokens: number } | undefined;

        // Ended leagues void their open bets at the end; a member who left
        // can't have open bets. Either way there is nothing to pay into.
        if (!league.exists || league.get("status") !== "active" || !member) return false;

        const side = bet.get("side") as "home" | "away";
        const stake = bet.get("stake") as number;
        const payout = bet.get("potentialPayout") as number;
        const outcome = decide(side, scores.home, scores.away);
        const credit = settlementCredit(outcome, stake, payout);
        const balanceAfter = member.leagueTokens + credit;
        const leagueName = (league.get("name") as string) ?? "your league";

        const counter =
          outcome === "won" ? "betsWon" : outcome === "push" ? "betsPush" : "betsLost";
        tx.update(leagueRef, {
          [`members.${uid}.leagueTokens`]: FieldValue.increment(credit),
          [`members.${uid}.${counter}`]: FieldValue.increment(1),
          lastActivityAt: Date.now(),
        });
        tx.update(doc.ref, {
          status: outcome,
          finalHomeScore: scores.home,
          finalAwayScore: scores.away,
          settledAt: FieldValue.serverTimestamp(),
        });

        const name = (bet.get("displayName") as string) ?? "A member";
        const teamAbbr = bet.get("teamAbbr") as string;
        tx.set(leagueRef.collection("activity").doc(`settle_${doc.id}`), {
          type: outcome === "won" ? "bet_won" : outcome === "push" ? "bet_push" : "bet_lost",
          uid,
          name,
          amount: outcome === "won" ? payout - stake : outcome === "push" ? 0 : -stake,
          text:
            outcome === "won"
              ? `${name} cashed ${teamAbbr} for +${(payout - stake).toLocaleString("en-US")}`
              : outcome === "push"
                ? `${name}'s ${teamAbbr} bet pushed`
                : `${name} lost ${stake.toLocaleString("en-US")} on ${teamAbbr}`,
          at: Date.now(),
        });

        writeNotification(
          tx,
          uid,
          betResultNotification({
            outcome,
            bet: summarize(doc.id, bet, scores.home, scores.away),
            balanceAfter,
            wallet: "league",
            leagueId,
            leagueName,
            now: Date.now(),
          })
        );
        return true;
      });
      if (did) settled++;
    } catch (err) {
      logger.error("failed to settle league bet", { betId: doc.id, err });
    }
  }
  return settled;
}

/**
 * Fires the moment syncGames flips a game to final. This is the fast path —
 * users see results within a couple of minutes of the whistle.
 */
export const onGameFinal = onDocumentUpdated(
  { document: "games/{gameId}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before.get("status");
    const after = event.data?.after.get("status");
    if (before === "final" || after !== "final") return;

    const gameId = event.params.gameId;
    const settled = await settleBetsForGame(gameId);
    const leagueSettled = await settleLeagueBetsForGame(gameId);
    logger.info("onGameFinal settled", { gameId, settled, leagueSettled });
  }
);

/**
 * Safety net. Catches anything the trigger missed — a cold deploy, a dropped
 * event, a bet placed after the game already went final.
 */
export const settleBetsSweep = onSchedule(
  { schedule: "*/15 * * * *", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const [pending, leaguePending] = await Promise.all([
      db.collection("bets").where("status", "==", "pending").limit(1000).get(),
      db.collectionGroup("leagueBets").where("status", "==", "pending").limit(1000).get(),
    ]);

    const gameIds = [...new Set(pending.docs.map((d) => d.get("gameId") as string))];
    const leagueGameIds = [...new Set(leaguePending.docs.map((d) => d.get("gameId") as string))];
    let total = 0;
    for (const gameId of gameIds) total += await settleBetsForGame(gameId);
    for (const gameId of leagueGameIds) total += await settleLeagueBetsForGame(gameId);

    if (total > 0) logger.info("settleBetsSweep", { settled: total });
  }
);

async function isOrphaned(gameId: string, cutoff: number): Promise<boolean> {
  const game = await db.collection("games").doc(gameId).get();
  const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
  return !game.exists || (startsAt > 0 && startsAt < cutoff && game.get("status") !== "final");
}

/** Exported for tests. */
export async function refundStale(cutoff: number): Promise<number> {
  let refunded = 0;
  const pending = await db.collection("bets").where("status", "==", "pending").limit(500).get();

  for (const doc of pending.docs) {
    if (!(await isOrphaned(doc.get("gameId") as string, cutoff))) continue;
    await db.runTransaction(async (tx) => {
      const bet = await tx.get(doc.ref);
      if (!bet.exists || bet.get("status") !== "pending") return;
      const uid = bet.get("uid") as string;
      const balanceAfter = await applyCredits(tx, uid, {
        delta: bet.get("stake") as number,
        type: "bet_refund",
        idempotencyKey: `settle_${doc.id}`,
        ref: doc.id,
        note: "Game cancelled or postponed",
      });
      tx.update(doc.ref, { status: "cancelled", settledAt: FieldValue.serverTimestamp() });
      writeNotification(
        tx,
        uid,
        betResultNotification({
          outcome: "refunded" as BetOutcome,
          bet: summarize(doc.id, bet, null, null),
          balanceAfter,
          wallet: "credits",
          now: Date.now(),
        })
      );
      refunded++;
    });
    logger.info("refunded stale bet", { betId: doc.id });
  }

  const leaguePending = await db
    .collectionGroup("leagueBets")
    .where("status", "==", "pending")
    .limit(500)
    .get();

  for (const doc of leaguePending.docs) {
    if (!(await isOrphaned(doc.get("gameId") as string, cutoff))) continue;
    await db.runTransaction(async (tx) => {
      const bet = await tx.get(doc.ref);
      if (!bet.exists || bet.get("status") !== "pending") return;
      const leagueId = bet.get("leagueId") as string;
      const leagueRef = db.collection("leagues").doc(leagueId);
      const league = await tx.get(leagueRef);
      const uid = bet.get("uid") as string;
      const member = league.get(`members.${uid}`) as { leagueTokens: number } | undefined;
      const stake = bet.get("stake") as number;
      if (league.exists && league.get("status") === "active" && member) {
        tx.update(leagueRef, { [`members.${uid}.leagueTokens`]: FieldValue.increment(stake) });
      }
      tx.update(doc.ref, { status: "cancelled", settledAt: FieldValue.serverTimestamp() });
      writeNotification(
        tx,
        uid,
        betResultNotification({
          outcome: "refunded",
          bet: summarize(doc.id, bet, null, null),
          balanceAfter: member ? member.leagueTokens + stake : null,
          wallet: "league",
          leagueId,
          leagueName: (league.get("name") as string | undefined) ?? null,
          now: Date.now(),
        })
      );
      refunded++;
    });
  }
  return refunded;
}

/**
 * Refunds bets on games that vanished from the provider (postponed, cancelled,
 * or pruned) and have been pending well past their start time.
 */
export const refundStaleBets = onSchedule(
  { schedule: "30 6 * * *", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const n = await refundStale(Date.now() - 72 * 3_600_000);
    if (n > 0) logger.info("refundStaleBets", { refunded: n });
  }
);

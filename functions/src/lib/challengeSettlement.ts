import { logger } from "firebase-functions";
import { challengePayouts, type ChallengeOutcome } from "./challengeMath";
import { applyCreditsMany, db, type Tx } from "./economy";
import { writeNotification } from "./notify";
import { challengeResultNotification, simpleNotification, type BetSummary } from "./notifyModel";
import { decide } from "./settlement";

/**
 * Everything that closes a friend challenge: expiry at kickoff, settlement
 * when the game is final, and the void for a game that never happened.
 *
 * Shape of challenges/{id}: see callable/challenges.ts.
 *
 * Every function here runs inside a caller's transaction that has only *read*
 * so far, re-checks the status it was handed, moves the escrow with
 * applyCreditsMany (ledger keys derived from the challenge id, so a replay
 * pays nothing twice) and writes the notifications in the same commit.
 */

type Snap = FirebaseFirestore.DocumentSnapshot;
type Side = "home" | "away";
interface Team {
  name: string;
  abbreviation: string;
  color: string;
}

export const CHALLENGES = () => db.collection("challenges");

export function nameFor(ch: Snap, uid: string): string {
  return ((uid === ch.get("creatorUid") ? ch.get("creatorName") : ch.get("opponentName")) as string) || "Your friend";
}

export function friendOf(ch: Snap, uid: string): string {
  return (uid === ch.get("creatorUid") ? ch.get("opponentUid") : ch.get("creatorUid")) as string;
}

export function sideFor(ch: Snap, uid: string): Side {
  const creatorSide = ch.get("creatorSide") as Side;
  if (uid === ch.get("creatorUid")) return creatorSide;
  return creatorSide === "home" ? "away" : "home";
}

export function stakeFor(ch: Snap, uid: string): number {
  return (uid === ch.get("creatorUid") ? ch.get("creatorStake") : ch.get("opponentStake")) as number;
}

export function gameLabel(ch: Snap): string {
  const home = ch.get("home") as Team;
  const away = ch.get("away") as Team;
  return `${away.abbreviation} @ ${home.abbreviation}`;
}

/** The challenge from one player's side, in the shape the result popup already renders. */
export function summaryFor(ch: Snap, uid: string, homeScore: number | null, awayScore: number | null): BetSummary {
  const side = sideFor(ch, uid);
  const home = ch.get("home") as Team;
  const away = ch.get("away") as Team;
  const team = side === "home" ? home : away;
  const other = side === "home" ? away : home;
  const stake = stakeFor(ch, uid);
  const pot = ch.get("pot") as number;
  return {
    betId: ch.id,
    gameId: ch.get("gameId") as string,
    sport: (ch.get("sport") as string | undefined) ?? null,
    side,
    teamName: team.name,
    teamAbbr: team.abbreviation,
    teamColor: team.color,
    opponentAbbr: other.abbreviation,
    odds: stake > 0 ? Math.round((pot / stake) * 100) / 100 : 0,
    stake,
    payout: pot,
    finalHomeScore: homeScore,
    finalAwayScore: awayScore,
  };
}

/**
 * Closes a challenge nobody accepted (expired, declined or withdrawn): the
 * challenger's escrow goes back. Only the challenger ever paid in.
 */
export async function releasePending(
  tx: Tx,
  ch: Snap,
  status: "expired" | "declined" | "cancelled",
  now: number
): Promise<number | null> {
  const id = ch.id;
  const creator = ch.get("creatorUid") as string;
  const opponent = ch.get("opponentUid") as string;
  const stake = ch.get("creatorStake") as number;
  const label = gameLabel(ch);

  const balances = await applyCreditsMany(tx, [
    {
      uid: creator,
      delta: stake,
      type: "challenge_refund",
      idempotencyKey: `chref_${id}_${creator}`,
      ref: id,
      note: status === "expired" ? `Challenge expired · ${label}` : status === "declined" ? `Challenge declined · ${label}` : `Challenge withdrawn · ${label}`,
    },
  ]);

  tx.update(ch.ref, { status, closedAtMs: now });

  const opponentName = nameFor(ch, opponent);
  const creatorName = nameFor(ch, creator);
  if (status === "expired") {
    writeNotification(
      tx,
      creator,
      simpleNotification({
        id: `chexp_${id}`,
        type: "challenge_expired",
        title: "Challenge expired",
        body: `${opponentName} didn't accept before ${label} started. Your ${stake.toLocaleString("en-US")} is back.`,
        delta: stake,
        balanceAfter: balances[creator] ?? null,
        now,
        data: { challengeId: id },
      })
    );
  } else if (status === "declined") {
    writeNotification(
      tx,
      creator,
      simpleNotification({
        id: `chdec_${id}`,
        type: "challenge_declined",
        title: `${opponentName} passed`,
        body: `${opponentName} declined your ${label} challenge. Your ${stake.toLocaleString("en-US")} is back.`,
        delta: stake,
        balanceAfter: balances[creator] ?? null,
        now,
        data: { challengeId: id },
      })
    );
  } else {
    writeNotification(
      tx,
      opponent,
      simpleNotification({
        id: `chcan_${id}`,
        type: "challenge_cancelled",
        title: `${creatorName} withdrew a challenge`,
        body: `The ${label} challenge is off.`,
        now,
        data: { challengeId: id },
      })
    );
  }
  return balances[creator] ?? null;
}

/** Pays out an accepted challenge on a final score. */
export async function settleAccepted(tx: Tx, ch: Snap, scores: { home: number; away: number }, now: number): Promise<void> {
  const id = ch.id;
  const creator = ch.get("creatorUid") as string;
  const opponent = ch.get("opponentUid") as string;
  const terms = {
    creatorStake: ch.get("creatorStake") as number,
    opponentStake: ch.get("opponentStake") as number,
    pot: ch.get("pot") as number,
  };

  const creatorResult = decide(ch.get("creatorSide") as Side, scores.home, scores.away);
  const outcome: ChallengeOutcome = creatorResult === "won" ? "creator" : creatorResult === "lost" ? "opponent" : "push";
  const pay = challengePayouts(outcome, terms);
  const label = gameLabel(ch);
  const type = outcome === "push" ? "challenge_refund" : "challenge_payout";
  const note = outcome === "push" ? `Draw · ${label}` : `Won the pot · ${label}`;

  const balances = await applyCreditsMany(tx, [
    { uid: creator, delta: pay.creator, type, idempotencyKey: `chpay_${id}_${creator}`, ref: id, note },
    { uid: opponent, delta: pay.opponent, type, idempotencyKey: `chpay_${id}_${opponent}`, ref: id, note },
  ]);

  tx.update(ch.ref, {
    status: "settled",
    outcome,
    winnerUid: outcome === "creator" ? creator : outcome === "opponent" ? opponent : null,
    finalHomeScore: scores.home,
    finalAwayScore: scores.away,
    settledAtMs: now,
  });

  for (const uid of [creator, opponent]) {
    const result = outcome === "push" ? "push" : (outcome === "creator") === (uid === creator) ? "won" : "lost";
    writeNotification(
      tx,
      uid,
      challengeResultNotification({
        result,
        challengeId: id,
        friendName: nameFor(ch, friendOf(ch, uid)),
        friendUid: friendOf(ch, uid),
        bet: summaryFor(ch, uid, scores.home, scores.away),
        balanceAfter: balances[uid] ?? null,
        now,
      })
    );
  }
}

/** The game never happened: both stakes go back. */
export async function voidAccepted(tx: Tx, ch: Snap, now: number): Promise<void> {
  const id = ch.id;
  const creator = ch.get("creatorUid") as string;
  const opponent = ch.get("opponentUid") as string;
  const note = `Game called off · ${gameLabel(ch)}`;
  const balances = await applyCreditsMany(tx, [
    { uid: creator, delta: ch.get("creatorStake") as number, type: "challenge_refund", idempotencyKey: `chpay_${id}_${creator}`, ref: id, note },
    { uid: opponent, delta: ch.get("opponentStake") as number, type: "challenge_refund", idempotencyKey: `chpay_${id}_${opponent}`, ref: id, note },
  ]);
  tx.update(ch.ref, { status: "void", outcome: null, winnerUid: null, settledAtMs: now });
  for (const uid of [creator, opponent]) {
    writeNotification(
      tx,
      uid,
      challengeResultNotification({
        result: "refunded",
        challengeId: id,
        friendName: nameFor(ch, friendOf(ch, uid)),
        bet: summaryFor(ch, uid, null, null),
        balanceAfter: balances[uid] ?? null,
        now,
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Game-level jobs
// ---------------------------------------------------------------------------

async function finalScores(gameId: string): Promise<{ home: number; away: number } | null> {
  const g = await db.collection("games").doc(gameId).get();
  if (!g.exists || g.get("status") !== "final") return null;
  const home = g.get("homeScore") as number | null | undefined;
  const away = g.get("awayScore") as number | null | undefined;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return { home, away };
}

/**
 * Game is final: pay every accepted challenge, and expire any still waiting
 * on an answer. Exported for tests.
 */
export async function settleChallengesForGame(gameId: string): Promise<number> {
  const scores = await finalScores(gameId);
  if (!scores) return 0;
  const open = await CHALLENGES().where("gameId", "==", gameId).where("status", "in", ["pending", "accepted"]).limit(500).get();

  let done = 0;
  for (const doc of open.docs) {
    try {
      const did = await db.runTransaction(async (tx) => {
        const ch = await tx.get(doc.ref);
        const status = ch.get("status");
        if (status === "pending") {
          await releasePending(tx, ch, "expired", Date.now());
          return true;
        }
        if (status === "accepted") {
          await settleAccepted(tx, ch, scores, Date.now());
          return true;
        }
        return false;
      });
      if (did) done++;
    } catch (err) {
      logger.error("failed to settle challenge", { challengeId: doc.id, err });
    }
  }
  return done;
}

/** Game has kicked off: an unanswered challenge can't be accepted any more. */
export async function expirePendingChallenges(gameId: string | null, now = Date.now()): Promise<number> {
  let q = CHALLENGES().where("status", "==", "pending");
  if (gameId) q = q.where("gameId", "==", gameId);
  const pending = await q.limit(500).get();

  let done = 0;
  for (const doc of pending.docs) {
    const startsAt = (doc.get("startsAt") as number | undefined) ?? 0;
    if (!gameId && startsAt > now) continue;
    try {
      const did = await db.runTransaction(async (tx) => {
        const ch = await tx.get(doc.ref);
        if (ch.get("status") !== "pending") return false;
        await releasePending(tx, ch, "expired", Date.now());
        return true;
      });
      if (did) done++;
    } catch (err) {
      logger.error("failed to expire challenge", { challengeId: doc.id, err });
    }
  }
  return done;
}

/** Safety net, run with the bet sweep: expire past-kickoff offers and settle anything final. */
export async function sweepChallenges(now = Date.now()): Promise<number> {
  let total = await expirePendingChallenges(null, now);
  const accepted = await CHALLENGES().where("status", "==", "accepted").limit(1000).get();
  const gameIds = [...new Set(accepted.docs.map((d) => d.get("gameId") as string))];
  for (const gameId of gameIds) total += await settleChallengesForGame(gameId);
  return total;
}

/** Accepted challenges on games that vanished or never finished: give both stakes back. */
export async function refundStaleChallenges(cutoff: number): Promise<number> {
  const accepted = await CHALLENGES().where("status", "==", "accepted").limit(500).get();
  const orphan = new Map<string, boolean>();
  let done = 0;
  for (const doc of accepted.docs) {
    const gameId = doc.get("gameId") as string;
    if (!orphan.has(gameId)) {
      const g = await db.collection("games").doc(gameId).get();
      const startsAt = (g.get("startsAt") as number | undefined) ?? 0;
      orphan.set(gameId, !g.exists || (startsAt > 0 && startsAt < cutoff && g.get("status") !== "final"));
    }
    if (!orphan.get(gameId)) continue;
    try {
      const did = await db.runTransaction(async (tx) => {
        const ch = await tx.get(doc.ref);
        if (ch.get("status") !== "accepted") return false;
        await voidAccepted(tx, ch, Date.now());
        return true;
      });
      if (did) done++;
    } catch (err) {
      logger.error("failed to void challenge", { challengeId: doc.id, err });
    }
  }
  return done;
}

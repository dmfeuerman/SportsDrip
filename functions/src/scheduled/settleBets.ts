import { onSchedule } from "firebase-functions/v2/scheduler";
import { applyResultToRatings, rateRecentFinals } from "../lib/ratings";
import { settleBracketsForGame } from "../callable/brackets";
import { recordCoopWins } from "../lib/coop";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { applyCredits, db, FieldValue, pairId } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { betResultNotification, simpleNotification, type BetOutcome, type BetSummary } from "../lib/notifyModel";
import { decide, settlementCredit, type Market, type Selection } from "../lib/settlement";
import {
  expirePendingChallenges,
  refundStaleChallenges,
  settleChallengesForGame,
  sweepChallenges,
  voidAccepted,
} from "../lib/challengeSettlement";
import { voidReason, type GameLike } from "../lib/gameState";
import { settlePicksForGame } from "../callable/picks";
import { gradeParlays, voidDisruptedParlayLegs } from "../callable/parlays";
import { settleDailyPicksForGame } from "../callable/dailyPick";
import { settleSlipParlaysForGame, voidSlipParlayLegs } from "../callable/slipParlays";
import { balanceSheet, type LeagueLoanLike } from "../lib/loanMath";

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
    side: (bet.get("side") as "home" | "away" | null | undefined) ?? null,
    market: (bet.get("market") as Market | undefined) ?? "ml",
    selection: (bet.get("selection") as Selection | undefined) ?? (bet.get("side") as "home" | "away") ?? "home",
    line: (bet.get("line") as number | null | undefined) ?? null,
    label: (bet.get("label") as string | undefined) ?? (bet.get("teamAbbr") as string),
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
      if (await settleMainBet(doc.ref, scores)) settled++;
    } catch (err) {
      logger.error("failed to settle bet", { betId: doc.id, err });
    }
  }
  return settled;
}

/**
 * Settles one pending main-wallet bet against final scores. `force` decides
 * the outcome regardless of the scores (dev tools only).
 */
export async function settleMainBet(
  ref: FirebaseFirestore.DocumentReference,
  scores: { home: number; away: number },
  force?: "won" | "lost" | "push"
): Promise<boolean> {
  const doc = { id: ref.id, ref };
  return db.runTransaction(async (tx) => {
        const userRef = (uid: string) => db.collection("users").doc(uid);
        const bet = await tx.get(doc.ref);
        if (!bet.exists || bet.get("status") !== "pending") return false;

        const uid = bet.get("uid") as string;
        const market = (bet.get("market") as Market | undefined) ?? "ml";
        const selection =
          (bet.get("selection") as Selection | undefined) ??
          (bet.get("side") as "home" | "away");
        const side = (bet.get("side") as "home" | "away" | null | undefined) ?? null;
        const line = (bet.get("line") as number | null | undefined) ?? null;
        const stake = bet.get("stake") as number;
        const payout = bet.get("potentialPayout") as number;
        const outcome = force ?? decide({ market, selection, side, line }, scores.home, scores.away);
        const credit = settlementCredit(outcome, stake, payout);

        let balanceAfter: number | null;
        if (credit > 0) {
          balanceAfter = await applyCredits(tx, uid, {
            delta: credit,
            type: outcome === "won" ? "bet_payout" : "bet_refund",
            idempotencyKey: `settle_${doc.id}`,
            ref: doc.id,
            note: outcome === "won" ? `Won ${bet.get("label") ?? bet.get("teamAbbr")}` : "Push — stake returned",
          });
        } else {
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
}

interface SettledLeagueBetRow {
  betId: string;
  leagueId: string;
  uid: string;
  name: string;
  market: Market;
  selection: Selection;
  side: "home" | "away" | null;
  line: number | null;
  outcome: "won" | "lost" | "push";
}

function areOppositePicks(a: SettledLeagueBetRow, b: SettledLeagueBetRow): boolean {
  if (a.uid === b.uid) return false;
  if (a.market !== b.market) return false;
  if (a.market === "ml" || a.market === "spread") {
    return (a.selection === "home" && b.selection === "away") || (a.selection === "away" && b.selection === "home");
  }
  return (a.selection === "over" && b.selection === "under") || (a.selection === "under" && b.selection === "over");
}

async function recordRivalries(gameId: string, rows: SettledLeagueBetRow[], now: number): Promise<void> {
  const byLeague = new Map<string, SettledLeagueBetRow[]>();
  for (const r of rows) {
    const list = byLeague.get(r.leagueId) ?? [];
    list.push(r);
    byLeague.set(r.leagueId, list);
  }

  for (const [leagueId, list] of byLeague) {
    const seenPairs = new Set<string>();
    const leagueRef = db.collection("leagues").doc(leagueId);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!;
        const y = list[j]!;
        if (!areOppositePicks(x, y)) continue;
        const pid = pairId(x.uid, y.uid);
        if (seenPairs.has(pid)) continue;
        seenPairs.add(pid);

        const aIsX = x.uid < y.uid;
        const a = aIsX ? x : y;
        const b = aIsX ? y : x;
        const rivRef = leagueRef.collection("rivalries").doc(pid);

        await db.runTransaction(async (tx) => {
          const snap = await tx.get(rivRef);
          const settledGames = (snap.exists ? (snap.get("settledGames") as string[] | undefined) : undefined) ?? [];
          if (settledGames.includes(gameId)) return;

          let aWins = snap.exists ? ((snap.get("aWins") as number | undefined) ?? 0) : 0;
          let bWins = snap.exists ? ((snap.get("bWins") as number | undefined) ?? 0) : 0;
          let pushes = snap.exists ? ((snap.get("pushes") as number | undefined) ?? 0) : 0;

          let winnerName: string | null = null;
          let loserName: string | null = null;
          if (a.outcome === "won" && b.outcome === "lost") {
            aWins++;
            winnerName = a.name;
            loserName = b.name;
          } else if (b.outcome === "won" && a.outcome === "lost") {
            bWins++;
            winnerName = b.name;
            loserName = a.name;
          } else {
            pushes++;
          }

          tx.set(
            rivRef,
            {
              id: pid,
              leagueId,
              aUid: a.uid,
              bUid: b.uid,
              aName: a.name,
              bName: b.name,
              users: [a.uid, b.uid],
              aWins,
              bWins,
              pushes,
              lastGameId: gameId,
              settledGames: [...settledGames.slice(-49), gameId],
              updatedAt: now,
            },
            { merge: true }
          );

          if (winnerName && loserName) {
            const winCount = winnerName === a.name ? aWins : bWins;
            const lossCount = winnerName === a.name ? bWins : aWins;
            tx.set(leagueRef.collection("activity").doc(`rivalry_${gameId}_${pid}`), {
              type: "rivalry",
              uid: winnerName === a.name ? a.uid : b.uid,
              name: winnerName,
              amount: 0,
              reactions: {},
              reactors: {},
              text: `${winnerName} took down ${loserName} head-to-head (${winCount}–${lossCount} all-time)`,
              at: now,
            });
          }
        });
      }
    }
  }
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
  const settledRows: SettledLeagueBetRow[] = [];

  for (const doc of pending.docs) {
    try {
      const row = await db.runTransaction(async (tx): Promise<SettledLeagueBetRow | null> => {
        const bet = await tx.get(doc.ref);
        if (!bet.exists || bet.get("status") !== "pending") return null;

        const leagueId = bet.get("leagueId") as string;
        const leagueRef = db.collection("leagues").doc(leagueId);
        const [league, loansSnap] = await Promise.all([
          tx.get(leagueRef),
          tx.get(leagueRef.collection("loans").where("borrowerId", "==", bet.get("uid") as string).where("status", "==", "active")),
        ]);
        const uid = bet.get("uid") as string;
        const member = league.get(`members.${uid}`) as { leagueTokens: number } | undefined;

        if (!league.exists || league.get("status") !== "active" || !member) return null;

        const market = (bet.get("market") as Market | undefined) ?? "ml";
        const selection =
          (bet.get("selection") as Selection | undefined) ??
          (bet.get("side") as "home" | "away");
        const side = (bet.get("side") as "home" | "away" | null | undefined) ?? null;
        const line = (bet.get("line") as number | null | undefined) ?? null;
        const stake = bet.get("stake") as number;
        const payout = bet.get("potentialPayout") as number;
        const isLock = Boolean(bet.get("lock"));
        const outcome = decide({ market, selection, side, line }, scores.home, scores.away);
        const credit = settlementCredit(outcome, stake, payout);
        const balanceAfter = member.leagueTokens + credit;
        const leagueName = (league.get("name") as string) ?? "your league";
        const now = Date.now();

        const counter =
          outcome === "won" ? "betsWon" : outcome === "push" ? "betsPush" : "betsLost";
        const leagueUpdate: Record<string, unknown> = {
          [`members.${uid}.leagueTokens`]: FieldValue.increment(credit),
          [`members.${uid}.${counter}`]: FieldValue.increment(1),
          lastActivityAt: now,
        };
        // Feeds the loss-chasing cooldown on bank and peer loans.
        if (outcome === "lost") leagueUpdate[`members.${uid}.lastLossAt`] = now;
        if (isLock) {
          const lockCounter =
            outcome === "won" ? "locksWon" : outcome === "push" ? "locksPush" : "locksLost";
          leagueUpdate[`members.${uid}.${lockCounter}`] = FieldValue.increment(1);
          if (outcome === "won") {
            tx.set(
              db.collection("users").doc(uid).collection("trophies").doc(`lock_${leagueId}_${doc.id}`),
              {
                id: `lock_${leagueId}_${doc.id}`,
                kind: "lock_of_week",
                title: "Lock of the Week Hit",
                leagueId,
                leagueName,
                betId: doc.id,
                label: (bet.get("label") as string | undefined) ?? (bet.get("teamAbbr") as string),
                awardedAt: now,
              },
              { merge: true }
            );
          }
        }
        tx.update(leagueRef, leagueUpdate);

        tx.update(doc.ref, {
          status: outcome,
          finalHomeScore: scores.home,
          finalAwayScore: scores.away,
          settledAt: FieldValue.serverTimestamp(),
        });

        const name = (bet.get("displayName") as string) ?? "A member";
        const pickLabel = (bet.get("label") as string | undefined) ?? (bet.get("teamAbbr") as string);
        tx.set(leagueRef.collection("activity").doc(`settle_${doc.id}`), {
          type: outcome === "won" ? "bet_won" : outcome === "push" ? "bet_push" : "bet_lost",
          uid,
          name,
          amount: outcome === "won" ? payout - stake : outcome === "push" ? 0 : -stake,
          reactions: {},
          reactors: {},
          text:
            outcome === "won"
              ? `${name} cashed ${pickLabel} for +${(payout - stake).toLocaleString("en-US")}${isLock ? " 🔒" : ""}`
              : outcome === "push"
                ? `${name}'s ${pickLabel} bet pushed`
                : `${name} lost ${stake.toLocaleString("en-US")} on ${pickLabel}`,
          at: now,
        });

        // Margin-call drama: if a loss leaves the borrower's tokens below what they owe.
        if (outcome === "lost" && !loansSnap.empty) {
          const activeLoans: LeagueLoanLike[] = loansSnap.docs.map((d) => ({
            principal: d.get("principal"),
            principalOutstanding: d.get("principalOutstanding"),
            interestAccrued: d.get("interestAccrued") ?? 0,
            interestPaid: d.get("interestPaid") ?? 0,
            accruedThrough: d.get("accruedThrough"),
            ratePct: d.get("ratePct"),
            intervalHours: d.get("intervalHours"),
            kind: d.get("kind"),
            status: d.get("status"),
            borrowerId: d.get("borrowerId"),
            lenderId: d.get("lenderId") ?? null,
          }));
          const sheet = balanceSheet(uid, balanceAfter, activeLoans, now);
          if (balanceAfter < sheet.debt) {
            tx.set(leagueRef.collection("activity").doc(`margin_${doc.id}`), {
              type: "margin_call",
              uid,
              name,
              amount: sheet.debt - balanceAfter,
              reactions: {},
              reactors: {},
              text: `Margin call: ${name} is down to ${balanceAfter.toLocaleString("en-US")} tokens while owing ${sheet.debt.toLocaleString("en-US")}`,
              at: now,
            });
            writeNotification(
              tx,
              uid,
              simpleNotification({
                id: `margin_${leagueId}_${doc.id}`,
                type: "margin_call",
                title: `Margin call in ${leagueName}`,
                body: `You have ${balanceAfter.toLocaleString("en-US")} tokens left and owe ${sheet.debt.toLocaleString("en-US")}.`,
                wallet: "league",
                leagueId,
                leagueName,
                now,
              })
            );
          }
        }

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
            now,
          })
        );
        return {
          betId: doc.id,
          leagueId,
          uid,
          name,
          market,
          selection,
          side,
          line,
          outcome,
        };
      });
      if (row) {
        settled++;
        settledRows.push(row);
      }
    } catch (err) {
      logger.error("failed to settle league bet", { betId: doc.id, err });
    }
  }

  if (settledRows.length >= 2) {
    await recordRivalries(gameId, settledRows, Date.now());
  }
  const wins = settledRows.filter((r) => r.outcome === "won");
  if (wins.length) await recordCoopWins(wins, Date.now()).catch(() => 0);
  return settled;
}

/**
 * Voids and refunds open main-wallet bets, league bets, and challenges on
 * disrupted games (cancelled immediately, or postponed and unplayed 24h after
 * original start). Exported for tests.
 */
export async function voidDisrupted(now = Date.now()): Promise<number> {
  const [mainPending, leaguePending, chPending] = await Promise.all([
    db.collection("bets").where("status", "==", "pending").limit(500).get(),
    db.collectionGroup("leagueBets").where("status", "==", "pending").limit(500).get(),
    db.collection("challenges").where("status", "in", ["pending", "accepted"]).limit(500).get(),
  ]);

  const gameIds = new Set<string>();
  for (const d of mainPending.docs) gameIds.add(d.get("gameId") as string);
  for (const d of leaguePending.docs) gameIds.add(d.get("gameId") as string);
  for (const d of chPending.docs) gameIds.add(d.get("gameId") as string);

  const reasons = new Map<string, string>();
  for (const gid of gameIds) {
    const g = await db.collection("games").doc(gid).get();
    if (!g.exists) continue;
    const reason = voidReason(g.data() as GameLike, now);
    if (reason) reasons.set(gid, reason);
  }
  if (reasons.size === 0) return 0;

  let refunded = 0;

  for (const doc of mainPending.docs) {
    const reason = reasons.get(doc.get("gameId") as string);
    if (!reason) continue;
    await db.runTransaction(async (tx) => {
      const bet = await tx.get(doc.ref);
      if (!bet.exists || bet.get("status") !== "pending") return;
      const uid = bet.get("uid") as string;
      const stake = bet.get("stake") as number;
      const balanceAfter = await applyCredits(tx, uid, {
        delta: stake,
        type: "bet_refund",
        idempotencyKey: `settle_${doc.id}`,
        ref: doc.id,
        note: `Game ${reason}`,
      });
      tx.update(doc.ref, {
        status: "cancelled",
        voidReason: reason,
        settledAt: FieldValue.serverTimestamp(),
      });
      writeNotification(
        tx,
        uid,
        betResultNotification({
          outcome: "refunded" as BetOutcome,
          bet: summarize(doc.id, bet, null, null),
          balanceAfter,
          wallet: "credits",
          now,
        })
      );
      refunded++;
    });
  }

  for (const doc of leaguePending.docs) {
    const reason = reasons.get(doc.get("gameId") as string);
    if (!reason) continue;
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
      tx.update(doc.ref, {
        status: "cancelled",
        voidReason: reason,
        settledAt: FieldValue.serverTimestamp(),
      });
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
          now,
        })
      );
      refunded++;
    });
  }

  for (const doc of chPending.docs) {
    const reason = reasons.get(doc.get("gameId") as string);
    if (!reason) continue;
    await db.runTransaction(async (tx) => {
      const ch = await tx.get(doc.ref);
      if (!ch.exists) return;
      const st = ch.get("status") as string;
      if (st === "accepted") {
        await voidAccepted(tx, ch, now);
        refunded++;
      }
    });
  }

  refunded += await voidDisruptedParlayLegs(now);
  refunded += await voidSlipParlayLegs(now).catch(() => 0);
  return refunded;
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
    const gameId = event.params.gameId;

    if (before === "upcoming" && after && after !== "upcoming") {
      const expired = await expirePendingChallenges(gameId);
      if (expired > 0) logger.info("challenges expired at kickoff", { gameId, expired });
    }

    if (before === "final" || after !== "final") return;

    // Results feed the model line's team ratings (once per game).
    await applyResultToRatings(gameId).catch((err) => logger.warn("ratings update failed", { gameId, error: String(err) }));

    const settled = await settleBetsForGame(gameId);
    const leagueSettled = await settleLeagueBetsForGame(gameId);
    const challenges = await settleChallengesForGame(gameId);
    const picks = await settlePicksForGame(gameId);
    const parlays = await gradeParlays(gameId);
    const daily = await settleDailyPicksForGame(gameId).catch(() => 0);
    const slips = await settleSlipParlaysForGame(gameId).catch((err) => (logger.warn("slip parlays failed", { gameId, error: String(err) }), 0));
    await settleBracketsForGame(gameId).catch((err) => logger.warn("brackets failed", { gameId, error: String(err) }));
    logger.info("onGameFinal settled", { gameId, settled, leagueSettled, challenges, picks, parlays, daily, slips });
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
    total += await sweepChallenges();
    total += await voidDisrupted(Date.now());
    // Bet-slip parlays: any leg on a game that's final.
    const slips = await db.collection("slipParlays").where("status", "==", "pending").limit(500).get();
    for (const gameId of new Set(slips.docs.flatMap((d) => (d.get("gameIds") as string[]) ?? []))) total += await settleSlipParlaysForGame(gameId);
    const rated = await rateRecentFinals().catch(() => 0);
    if (rated) logger.info("ratings caught up", { rated });

    // Pick'em / survivor picks and group parlay legs on finished games.
    const [picks, parlays] = await Promise.all([
      db.collectionGroup("picks").where("status", "==", "pending").limit(1000).get(),
      db.collectionGroup("parlays").where("status", "==", "locked").limit(500).get(),
    ]);
    for (const gameId of new Set(picks.docs.map((d) => d.get("gameId") as string))) {
      total += await settlePicksForGame(gameId);
    }
    const legGames = new Set(
      parlays.docs.flatMap((d) =>
        ((d.get("legs") as Array<{ gameId: string; status: string }>) ?? [])
          .filter((l) => l.status === "pending")
          .map((l) => l.gameId)
      )
    );
    for (const gameId of legGames) total += await gradeParlays(gameId);

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
      tx.update(doc.ref, { status: "cancelled", voidReason: "stale", settledAt: FieldValue.serverTimestamp() });
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
      tx.update(doc.ref, { status: "cancelled", voidReason: "stale", settledAt: FieldValue.serverTimestamp() });
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
    const now = Date.now();
    const cutoff = now - 72 * 3_600_000;
    const n =
      (await voidDisrupted(now)) +
      (await refundStale(cutoff)) +
      (await refundStaleChallenges(cutoff));
    if (n > 0) logger.info("refundStaleBets", { refunded: n });
  }
);

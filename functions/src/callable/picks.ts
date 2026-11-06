import { onCall, HttpsError } from "firebase-functions/v2/https";
import { leagueStarted } from "../lib/leagueConfig";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { decide } from "../lib/settlement";
import { advanceStreak, type StreakState } from "../lib/streak";
import { recentEmptyDays } from "../lib/streakDays";
import { weekKey } from "../lib/weekly";

/**
 * Pick'em and Survivor league modes (`leagues/{id}.mode === "pickem" | "survivor"`).
 *
 *  - Pick'em: members choose the winner of any upcoming game in the league's
 *    allowed sports; each correct pick scores 1 point (`pickPoints`), no bankroll
 *    required.
 *  - Survivor: each member picks one team per week, cannot reuse a team in the
 *    same season (`usedTeams`), and a loss (or missed week) eliminates them
 *    (`eliminated: true`).
 */

const MakePickInput = z.object({
  leagueId: z.string().min(1),
  gameId: z.string().min(1),
  side: z.enum(["home", "away"]),
});

export const makePick = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = MakePickInput.parse(req.data);

  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const gameRef = db.collection("games").doc(input.gameId);
  const userRef = db.collection("users").doc(uid);

  const emptyDays = await recentEmptyDays();
  return db.runTransaction(async (tx) => {
    const [league, game, userSnap] = await Promise.all([
      tx.get(leagueRef),
      tx.get(gameRef),
      tx.get(userRef),
    ]);

    const now = Date.now();
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    if (league.get("status") !== "active") throw new HttpsError("failed-precondition", "That league has ended.");
    const endsAt = (league.get("endsAt") as number | undefined) ?? 0;
    if (endsAt && now >= endsAt) throw new HttpsError("failed-precondition", "That league's season is over.");
    if (!leagueStarted(league, now)) throw new HttpsError("failed-precondition", "This league hasn't started yet. Picks open when it does.");

    const me = league.get(`members.${uid}`) as
      | {
          uid: string;
          displayName: string;
          eliminated?: boolean;
          usedTeams?: string[];
        }
      | undefined;
    if (!me) throw new HttpsError("permission-denied", "You're not in this league.");

    const mode = (league.get("mode") as string | undefined) ?? "bankroll";
    if (mode !== "pickem" && mode !== "survivor") {
      throw new HttpsError("failed-precondition", "This league uses bankroll betting, not picks.");
    }

    if (!game.exists) throw new HttpsError("not-found", "That game is no longer available.");
    if (game.get("status") !== "upcoming" || game.get("disrupted")) {
      throw new HttpsError("failed-precondition", "Betting is closed for this game.");
    }
    const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
    if (startsAt && startsAt <= now) {
      throw new HttpsError("failed-precondition", "Betting is closed for this game.");
    }
    const allowed = (league.get("allowedSports") as string[] | undefined) ?? [];
    if (!allowed.includes(game.get("sport") as string)) {
      throw new HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
    }

    const home = game.get("homeTeam") as { name: string; abbreviation: string; color: string };
    const away = game.get("awayTeam") as { name: string; abbreviation: string; color: string };
    const picked = input.side === "home" ? home : away;
    const opp = input.side === "home" ? away : home;
    const wk = weekKey(startsAt || now);

    const pickId = mode === "survivor" ? `${uid}_${wk}` : `${uid}_${input.gameId}`;
    const pickRef = leagueRef.collection("picks").doc(pickId);
    const existingPick = await tx.get(pickRef);

    if (mode === "survivor") {
      if (me.eliminated) {
        throw new HttpsError("failed-precondition", "You've been knocked out of survivor.");
      }
      if (existingPick.exists && existingPick.get("status") !== "pending") {
        throw new HttpsError("failed-precondition", "Your survivor pick for this week is already settled.");
      }
      const prevTeam = existingPick.exists ? (existingPick.get("teamAbbr") as string | undefined) : undefined;
      if (existingPick.exists) {
        const prevStartsAt = (existingPick.get("startsAt") as number | undefined) ?? 0;
        if (prevStartsAt > 0 && prevStartsAt <= now) {
          throw new HttpsError("failed-precondition", "Your survivor pick for this week is already locked.");
        }
      }
      const usedTeams = (me.usedTeams ?? []).filter((t) => t !== prevTeam);
      if (usedTeams.includes(picked.abbreviation)) {
        throw new HttpsError(
          "failed-precondition",
          `You already used ${picked.abbreviation} earlier this season.`
        );
      }
      const nextUsed = [...usedTeams, picked.abbreviation];
      tx.update(leagueRef, {
        [`members.${uid}.usedTeams`]: nextUsed,
        lastActivityAt: now,
      });
    } else {
      if (existingPick.exists && existingPick.get("status") !== "pending") {
        throw new HttpsError("failed-precondition", "That pick is already settled.");
      }
      tx.update(leagueRef, { lastActivityAt: now });
    }

    tx.set(pickRef, {
      id: pickId,
      leagueId: input.leagueId,
      uid,
      displayName: me.displayName,
      mode,
      week: wk,
      gameId: input.gameId,
      sport: game.get("sport"),
      side: input.side,
      teamName: picked.name,
      teamAbbr: picked.abbreviation,
      teamColor: picked.color,
      opponentAbbr: opp.abbreviation,
      startsAt: startsAt || null,
      status: "pending",
      placedAt: now,
      settledAt: null,
    });

    if (userSnap.exists) {
      const prevStreak = userSnap.get("streak") as Partial<StreakState> | undefined;
      tx.update(userRef, { streak: advanceStreak(prevStreak, now, { emptyDays }) });
    }

    return { ok: true, pickId, week: wk, teamAbbr: picked.abbreviation };
  });
});

/** Grades pending pick'em and survivor picks when a game goes final. */
export async function settlePicksForGame(gameId: string): Promise<number> {
  const gameSnap = await db.collection("games").doc(gameId).get();
  if (!gameSnap.exists || gameSnap.get("status") !== "final") return 0;
  const homeScore = gameSnap.get("homeScore") as number | null;
  const awayScore = gameSnap.get("awayScore") as number | null;
  if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) {
    return 0;
  }

  const pending = await db
    .collectionGroup("picks")
    .where("gameId", "==", gameId)
    .where("status", "==", "pending")
    .limit(500)
    .get();

  let settled = 0;
  for (const doc of pending.docs) {
    try {
      const did = await db.runTransaction(async (tx) => {
        const pick = await tx.get(doc.ref);
        if (!pick.exists || pick.get("status") !== "pending") return false;

        const leagueId = pick.get("leagueId") as string;
        const leagueRef = db.collection("leagues").doc(leagueId);
        const league = await tx.get(leagueRef);
        const uid = pick.get("uid") as string;
        const member = league.get(`members.${uid}`) as Record<string, unknown> | undefined;
        if (!league.exists || league.get("status") !== "active" || !member) return false;

        const side = pick.get("side") as "home" | "away";
        const mode = (pick.get("mode") as string | undefined) ?? (league.get("mode") as string | undefined) ?? "pickem";
        const outcome = decide(side, homeScore, awayScore);
        const now = Date.now();

        tx.update(doc.ref, {
          status: outcome,
          finalHomeScore: homeScore,
          finalAwayScore: awayScore,
          settledAt: now,
        });

        const update: Record<string, unknown> = { lastActivityAt: now };
        if (mode === "pickem") {
          if (outcome === "won") {
            update[`members.${uid}.pickPoints`] = FieldValue.increment(1);
            update[`members.${uid}.betsWon`] = FieldValue.increment(1);
          } else if (outcome === "lost") {
            update[`members.${uid}.betsLost`] = FieldValue.increment(1);
          } else {
            update[`members.${uid}.betsPush`] = FieldValue.increment(1);
          }
        } else if (mode === "survivor") {
          if (outcome === "won") {
            update[`members.${uid}.betsWon`] = FieldValue.increment(1);
          } else {
            // A loss or tie in survivor knocks the player out.
            update[`members.${uid}.eliminated`] = true;
            update[`members.${uid}.eliminatedAt`] = now;
            update[`members.${uid}.eliminatedWeek`] = pick.get("week") ?? null;
            update[`members.${uid}.betsLost`] = FieldValue.increment(1);
            const name = (pick.get("displayName") as string) ?? "Player";
            const abbr = pick.get("teamAbbr") as string;
            tx.set(leagueRef.collection("activity").doc(`surv_out_${doc.id}`), {
              type: "survivor_out",
              uid,
              name,
              amount: 0,
              text: `${name} was knocked out of Survivor on ${abbr}`,
              at: now,
            });
          }
        }
        tx.update(leagueRef, update);
        return true;
      });
      if (did) settled++;
    } catch (err) {
      logger.error("failed to settle pick", { pickId: doc.id, err });
    }
  }
  return settled;
}

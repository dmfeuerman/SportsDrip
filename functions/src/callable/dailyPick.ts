import { onCall, HttpsError } from "firebase-functions/v2/https";
// import { onSchedule } from "firebase-functions/v2/scheduler";
import { onSchedule } from "../lib/onlineSchedule";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { advanceStreak, nyDay, STREAK_MILESTONES, type StreakState } from "../lib/streak";
import { recentEmptyDays } from "../lib/streakDays";
import { grantXp } from "../lib/xp";
import { checkAchievements } from "../lib/achievements";
import { requirePricedMarket } from "../lib/pricing";
import { checkPlayLimits } from "../lib/playLimits";

/**
 * Daily Pick: one featured game a day, the same for everyone, free (no stake,
 * no credits at risk). Making it keeps the daily streak alive and pays XP.
 *
 *   dailyPick/{YYYY-MM-DD}                    the featured game (server-written)
 *   users/{uid}/dailyPicks/{YYYY-MM-DD}       the player's pick and its result
 */

export const DAILY_PICK_XP = 15;
const SPORT_PRIORITY = ["NFL", "NBA", "NCAAF", "MLB", "NHL", "NCAAB", "Soccer"];

/** Chooses today's featured game: the highest-profile sport, prime-time first. */
export async function chooseDailyPick(now = Date.now()): Promise<string | null> {
  const day = nyDay(now);
  const ref = db.collection("dailyPick").doc(day);
  const existing = await ref.get();
  if (existing.exists && existing.get("empty") !== true) return ref.id;
  const games = await db
    .collection("games")
    .where("status", "==", "upcoming")
    .where("startsAt", ">=", now + 30 * 60_000)
    .where("startsAt", "<=", now + 20 * 3600_000)
    .limit(200)
    .get();
  const todays = games.docs.filter((g) => nyDay(g.get("startsAt") as number) === day);
  if (!todays.length) {
    // No featured game: mark the day empty so it doesn't break streaks. Only from
    // noon ET, by when the day's slate is synced; a later game overwrites this.
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
    if (!existing.exists && hour >= 12) await ref.set({ day, empty: true, createdAt: FieldValue.serverTimestamp() });
    return null;
  }
  const rank = (s: string) => {
    const i = SPORT_PRIORITY.indexOf(s);
    return i < 0 ? 99 : i;
  };
  // Best sport, then the slot closest to 8pm ET.
  const pick = todays.sort((a, b) => {
    const r = rank(a.get("sport")) - rank(b.get("sport"));
    if (r) return r;
    const prime = (t: number) => Math.abs(Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(t))) - 20);
    return prime(a.get("startsAt")) - prime(b.get("startsAt"));
  })[0]!;
  await ref.set({
    day,
    gameId: pick.id,
    sport: pick.get("sport") ?? null,
    startsAt: pick.get("startsAt"),
    homeTeam: pick.get("homeTeam") ?? null,
    awayTeam: pick.get("awayTeam") ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return day;
}

export const scheduleDailyPick = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1", timeZone: "America/New_York", timeoutSeconds: 120 },
  async () => {
    const day = await chooseDailyPick(Date.now());
    if (day) logger.info("daily pick ready", { day });
  }
);

const Input = z.object({ side: z.enum(["home", "away"]) });

export const makeDailyPick = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { side } = Input.parse(req.data);
  const now = Date.now();
  const day = nyDay(now);
  const featuredRef = db.collection("dailyPick").doc(day);
  const userRef = db.collection("users").doc(uid);
  const pickRef = userRef.collection("dailyPicks").doc(day);

  const emptyDays = await recentEmptyDays();
  const out = await db.runTransaction(async (tx) => {
    const [featured, user, existing] = await Promise.all([tx.get(featuredRef), tx.get(userRef), tx.get(pickRef)]);
    if (!featured.exists || featured.get("empty") === true) throw new HttpsError("failed-precondition", "No Daily Pick today yet.");
    const game = await tx.get(db.collection("games").doc(featured.get("gameId") as string));
    if (!game.exists || game.get("status") !== "upcoming" || (game.get("startsAt") as number) <= now) {
      throw new HttpsError("failed-precondition", "Today's Daily Pick has locked.");
    }
    const prev = user.get("streak") as Partial<StreakState> | undefined;
    // Changing sides isn't a second qualifying action (it would complete a streak repair for free).
    const streak = existing.exists && prev ? (prev as StreakState) : advanceStreak(prev, now, { emptyDays });
    // Changing your side before kickoff is fine; the streak only advances once a day anyway.
    tx.set(pickRef, {
      day,
      gameId: game.id,
      side,
      teamAbbr: (game.get(side === "home" ? "homeTeam.abbreviation" : "awayTeam.abbreviation") as string) ?? null,
      result: null,
      at: now,
      uid,
    });
    tx.update(userRef, { streak });
    const milestone = !existing.exists && (prev?.count ?? 0) !== streak.count && (STREAK_MILESTONES as readonly number[]).includes(streak.count) ? streak.count : null;
    return { first: !existing.exists, streak, milestone };
  });

  if (out.first) await grantXp(uid, DAILY_PICK_XP, `daily_${day}`, "daily_pick").catch(() => {});
  await checkAchievements(uid).catch(() => []);
  return { ok: true, day, streak: out.streak.count, freezes: out.streak.freezes ?? 0, milestone: out.milestone };
});

/** Grades every Daily Pick on a game once it is final. Called from onGameFinal. */
export async function settleDailyPicksForGame(gameId: string): Promise<number> {
  const game = await db.collection("games").doc(gameId).get();
  if (!game.exists || game.get("status") !== "final") return 0;
  const home = game.get("homeScore") as number | null;
  const away = game.get("awayScore") as number | null;
  if (home === null || away === null) return 0;
  const winner = home === away ? null : home > away ? "home" : "away";
  const picks = await db.collectionGroup("dailyPicks").where("gameId", "==", gameId).where("result", "==", null).limit(5000).get();
  let n = 0;
  for (let i = 0; i < picks.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of picks.docs.slice(i, i + 400)) {
      const result = winner === null ? "push" : d.get("side") === winner ? "won" : "lost";
      batch.update(d.ref, { result, settledAt: Date.now() });
      const uid = d.get("uid") as string;
      if (uid && result !== "push") batch.update(db.collection("users").doc(uid), { [`dailyRecord.${result === "won" ? "w" : "l"}`]: FieldValue.increment(1) });
      n++;
    }
    await batch.commit();
  }
  return n;
}

/* ── Daily free bet ──────────────────────────────────────────────────────────
 * Every America/New_York day each player gets one free 1,000-credit bet: a
 * moneyline pick on any upcoming game (today's Daily Pick game is the
 * suggestion). Nothing is debited. A win pays the winnings (100 × odds − 100),
 * the free stake itself is never returned, like a sportsbook free bet.
 *
 * It's a normal bets/{id} document with stake 0, so settlement, voids,
 * notifications and stats need nothing special:
 *   stake 0, potentialPayout = winnings, freeBet true, freeStake 1000, freeDay.
 *   users/{uid}/freeBets/{YYYY-MM-DD}   the day's token (exists = used)
 * Cancelling it before kickoff (cancelBet) deletes the token, so it can be
 * placed again.
 */
export const FREE_BET_STAKE = 1000;

const FreeBetInput = z.object({
  gameId: z.string().min(1),
  side: z.enum(["home", "away"]).optional(),
  /** Moneyline (default), spread or total, like a normal bet. */
  market: z.enum(["ml", "spread", "total"]).optional(),
  selection: z.enum(["home", "away", "over", "under"]).optional(),
  idempotencyKey: z.string().min(8).max(64),
}).refine((v) => !!(v.side || v.selection), { message: "Pick a side." });

export const placeFreeBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = FreeBetInput.parse(req.data);
  const now = Date.now();
  const day = nyDay(now);
  const betId = `${uid}_${input.idempotencyKey}`;
  const betRef = db.collection("bets").doc(betId);
  const userRef = db.collection("users").doc(uid);
  const tokenRef = userRef.collection("freeBets").doc(day);
  const gameRef = db.collection("games").doc(input.gameId);
  const featuredRef = db.collection("dailyPick").doc(day);
  const pickRef = userRef.collection("dailyPicks").doc(day);

  const emptyDays = await recentEmptyDays();
  const out = await db.runTransaction(async (tx) => {
    const [existing, token, game, user, featured, pick] = await Promise.all([
      tx.get(betRef),
      tx.get(tokenRef),
      tx.get(gameRef),
      tx.get(userRef),
      tx.get(featuredRef),
      tx.get(pickRef),
    ]);
    if (existing.exists) return { duplicate: true, first: false, winnings: existing.get("potentialPayout") as number, streak: null as StreakState | null, milestone: null };
    if (token.exists) throw new HttpsError("failed-precondition", "You've already used today's free bet. A new one is ready tomorrow.");
    if (!user.exists) throw new HttpsError("not-found", "Profile not found.");
    if (!game.exists) throw new HttpsError("not-found", "That game is no longer available.");
    const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
    if (game.get("status") !== "upcoming" || (startsAt && startsAt <= now)) {
      throw new HttpsError("failed-precondition", "That game has already started. Pick another one.");
    }
    const limitUpdate = checkPlayLimits(user, now);
    const priced = requirePricedMarket(game, { market: input.market ?? "ml", side: input.side, selection: input.selection });
    const winnings = Math.max(1, Math.round(FREE_BET_STAKE * priced.odds) - FREE_BET_STAKE);

    tx.set(betRef, {
      id: betId,
      uid,
      gameId: input.gameId,
      sport: game.get("sport"),
      market: priced.market,
      selection: priced.selection,
      side: priced.side,
      line: priced.line,
      label: priced.label,
      teamName: priced.teamName,
      teamAbbr: priced.teamAbbr,
      teamColor: priced.teamColor,
      opponentAbbr: priced.opponentAbbr,
      stake: 0,
      freeBet: true,
      freeStake: FREE_BET_STAKE,
      freeDay: day,
      odds: priced.odds,
      potentialPayout: winnings,
      status: "pending",
      startsAt: startsAt || null,
      opponentUid: null,
      placedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
    tx.set(tokenRef, { day, betId, gameId: input.gameId, at: now });

    // It counts as the day's pick: streak, and the Daily Pick record when it's on the featured game.
    const prev = user.get("streak") as Partial<StreakState> | undefined;
    const streak = advanceStreak(prev, now, { emptyDays });
    if (!pick.exists && featured.exists && featured.get("gameId") === input.gameId && priced.market === "ml" && priced.side) {
      tx.set(pickRef, { day, gameId: input.gameId, side: priced.side, teamAbbr: priced.teamAbbr, result: null, at: now, uid });
    }
    tx.update(userRef, { "stats.betsPlaced": FieldValue.increment(1), streak, ...limitUpdate });
    const milestone = (prev?.count ?? 0) !== streak.count && (STREAK_MILESTONES as readonly number[]).includes(streak.count) ? streak.count : null;
    return { duplicate: false, first: true, winnings, streak, milestone };
  });

  if (out.first) await grantXp(uid, DAILY_PICK_XP, `daily_${day}`, "daily_pick").catch(() => {});
  if (out.first) await checkAchievements(uid).catch(() => []);
  return { ok: true, betId, day, winnings: out.winnings, duplicate: out.duplicate, streak: out.streak?.count ?? null, milestone: out.milestone };
});

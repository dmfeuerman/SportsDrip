import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { advanceStreak, nyDay, STREAK_MILESTONES, type StreakState } from "../lib/streak";
import { grantXp } from "../lib/xp";
import { checkAchievements } from "../lib/achievements";

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
  if ((await ref.get()).exists) return ref.id;
  const games = await db
    .collection("games")
    .where("status", "==", "upcoming")
    .where("startsAt", ">=", now + 30 * 60_000)
    .where("startsAt", "<=", now + 20 * 3600_000)
    .limit(200)
    .get();
  const todays = games.docs.filter((g) => nyDay(g.get("startsAt") as number) === day);
  if (!todays.length) return null;
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

  const out = await db.runTransaction(async (tx) => {
    const [featured, user, existing] = await Promise.all([tx.get(featuredRef), tx.get(userRef), tx.get(pickRef)]);
    if (!featured.exists) throw new HttpsError("failed-precondition", "No Daily Pick today yet.");
    const game = await tx.get(db.collection("games").doc(featured.get("gameId") as string));
    if (!game.exists || game.get("status") !== "upcoming" || (game.get("startsAt") as number) <= now) {
      throw new HttpsError("failed-precondition", "Today's Daily Pick has locked.");
    }
    const prev = user.get("streak") as Partial<StreakState> | undefined;
    const streak = advanceStreak(prev, now);
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

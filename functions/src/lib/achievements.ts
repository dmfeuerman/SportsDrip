import { db, FieldValue } from "./economy";
import { writeNotification } from "./notify";
import { simpleNotification } from "./notifyModel";
import { levelFromXp } from "./progression";

/**
 * Lifetime achievements. They fill the Locker trophy shelf
 * (users/{uid}/trophies/ach_<id>, kind "achievement") and show on player
 * profiles, where peers see them. Milestones reward participation, skill and
 * social play, never stake size or volume of credits wagered.
 */
export interface AchievementDef {
  id: string;
  title: string;
  icon: string;
  /** True once the player qualifies. */
  test: (s: AchievementStats) => boolean;
}

export interface AchievementStats {
  betsPlaced: number;
  betsWon: number;
  streakLongest: number;
  level: number;
  dailyWins: number;
  friends: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_win", title: "First Win", icon: "check-decagram", test: (s) => s.betsWon >= 1 },
  { id: "wins_10", title: "10 Wins", icon: "medal-outline", test: (s) => s.betsWon >= 10 },
  { id: "wins_50", title: "50 Wins", icon: "medal", test: (s) => s.betsWon >= 50 },
  { id: "picks_100", title: "100 Picks", icon: "ticket-confirmation-outline", test: (s) => s.betsPlaced >= 100 },
  { id: "streak_7", title: "7-Day Streak", icon: "fire", test: (s) => s.streakLongest >= 7 },
  { id: "streak_30", title: "30-Day Streak", icon: "fire-circle", test: (s) => s.streakLongest >= 30 },
  { id: "streak_100", title: "100-Day Streak", icon: "crown-outline", test: (s) => s.streakLongest >= 100 },
  { id: "daily_10", title: "Daily Pick Sharp", icon: "calendar-check", test: (s) => s.dailyWins >= 10 },
  { id: "level_5", title: "Level 5", icon: "star-outline", test: (s) => s.level >= 5 },
  { id: "level_10", title: "Level 10", icon: "star", test: (s) => s.level >= 10 },
  { id: "level_25", title: "Level 25", icon: "star-shooting", test: (s) => s.level >= 25 },
  { id: "friends_3", title: "Squad Up", icon: "account-group", test: (s) => s.friends >= 3 },
  { id: "friends_10", title: "Crew Chief", icon: "account-group-outline", test: (s) => s.friends >= 10 },
];

/**
 * Awards any achievements the player now qualifies for. Idempotent: an
 * existing trophy doc is never rewritten, so each one notifies once.
 */
export async function checkAchievements(uid: string): Promise<string[]> {
  const userRef = db.collection("users").doc(uid);
  const [user, friendCount] = await Promise.all([
    userRef.get(),
    db.collection("friendships").where("users", "array-contains", uid).count().get().then((r) => r.data().count).catch(() => 0),
  ]);
  if (!user.exists) return [];
  const stats: AchievementStats = {
    betsPlaced: (user.get("stats.betsPlaced") as number) ?? 0,
    betsWon: (user.get("stats.betsWon") as number) ?? 0,
    streakLongest: Math.max((user.get("streak.longest") as number) ?? 0, (user.get("streak.count") as number) ?? 0),
    level: levelFromXp((user.get("xp") as number) ?? 0),
    dailyWins: (user.get("dailyRecord.w") as number) ?? 0,
    friends: friendCount,
  };
  const qualified = ACHIEVEMENTS.filter((a) => a.test(stats));
  if (!qualified.length) return [];
  return db.runTransaction(async (tx) => {
    const refs = qualified.map((a) => userRef.collection("trophies").doc(`ach_${a.id}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const fresh = qualified.filter((_, i) => !snaps[i]!.exists);
    const now = Date.now();
    fresh.forEach((a) => {
      tx.set(userRef.collection("trophies").doc(`ach_${a.id}`), {
        id: `ach_${a.id}`,
        kind: "achievement",
        achievementId: a.id,
        title: a.title,
        label: a.icon,
        awardedAt: now,
        createdAt: FieldValue.serverTimestamp(),
      });
      writeNotification(
        tx,
        uid,
        simpleNotification({ id: `ach_${a.id}`, type: "achievement", title: `Achievement: ${a.title}`, body: "It's on your trophy shelf.", now })
      );
    });
    return fresh.map((a) => a.id);
  });
}

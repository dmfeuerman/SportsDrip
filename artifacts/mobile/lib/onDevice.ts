/**
 * Reads the phone can do for itself.
 *
 * Each function here replaces a read-only Cloud Function call with direct
 * Firestore reads the security rules already allow, plus the same arithmetic
 * the server did. Nothing here can change a balance, a bet or anyone else's
 * data: every write still goes through a callable. If a direct read fails
 * (rules, a missing index, offline), lib/api.ts falls back to the callable.
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import type { PublicUser, WeeklyQuest } from "@/lib/api";
import { getDb, getFirebaseAuth } from "@/lib/firebase";
import { weekKey } from "@/lib/markets";
import { nyDayOf } from "@/lib/streakGrid";

function ctx() {
  const db = getDb();
  const uid = getFirebaseAuth()?.currentUser?.uid;
  if (!db || !uid) throw new Error("not-ready");
  return { db, uid };
}

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) : 0;
};

/** Mirrors functions/src/lib/friendStreak.ts activeFriendStreak. */
export function activeFriendStreak(s: { count?: number; lastDay?: string } | null | undefined, now: number): number {
  if (!s?.lastDay || !s.count) return 0;
  const diff = dayNumber(nyDayOf(now)) - dayNumber(s.lastDay);
  return diff === 0 || diff === 1 ? Math.floor(s.count) : 0;
}

const MAX_FRIENDS = 500;

/** Same result as the listFriends callable. */
export async function listFriends(): Promise<{ friends: PublicUser[] }> {
  const { db, uid } = ctx();
  const pairs = await getDocs(query(collection(db, "friendships"), where("users", "array-contains", uid), limit(MAX_FRIENDS)));
  const now = Date.now();
  const streaks = new Map<string, { count: number; longest: number }>();
  for (const p of pairs.docs) {
    const other = ((p.get("users") as string[] | undefined) ?? []).find((u) => u !== uid);
    if (!other) continue;
    const s = p.get("streak") as { count?: number; longest?: number; lastDay?: string } | undefined;
    streaks.set(other, { count: activeFriendStreak(s, now), longest: Math.floor(s?.longest ?? 0) });
  }
  const users = await Promise.all([...streaks.keys()].map((id) => getDoc(doc(db, "users", id))));
  return {
    friends: users
      .filter((u) => u.exists())
      .map(
        (u) =>
          ({
            uid: u.id,
            username: u.get("username"),
            displayName: u.get("displayName"),
            avatar: u.get("avatar"),
            equipped: u.get("equipped"),
            balance: u.get("balance"),
            stats: u.get("stats"),
            favoriteTeams: u.get("favoriteTeams") ?? [],
            friendStreak: streaks.get(u.id) ?? { count: 0, longest: 0 },
          }) as PublicUser
      ),
  };
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Same result as the checkUsername callable. createProfile still enforces uniqueness in a transaction. */
export async function checkUsername(username: string): Promise<{ available: boolean; reason: "invalid" | "taken" | null }> {
  const { db } = ctx();
  const raw = username.trim().toLowerCase();
  if (!USERNAME_RE.test(raw)) return { available: false, reason: "invalid" };
  const snap = await getDoc(doc(db, "usernames", raw));
  return { available: !snap.exists(), reason: snap.exists() ? "taken" : null };
}

type QuestMetric = "checkin" | "picks" | "pickDays" | "reactions" | "wins" | "underdogWins";
interface QuestDef {
  id: string;
  kind: WeeklyQuest["kind"];
  title: string;
  target: number;
  xp: number;
  metric: QuestMetric;
}

/**
 * This week's quests with progress, computed from the player's own bets.
 * Returns null when the server hasn't drawn this week's quests yet: the
 * caller then makes the one getWeeklyQuests call that draws and freezes them.
 * claimQuest re-checks progress on the server, so nothing here grants XP.
 */
export async function weeklyQuests(now = Date.now()): Promise<{ week: string; quests: WeeklyQuest[] } | null> {
  const { db, uid } = ctx();
  const week = weekKey(now);
  const questSnap = await getDoc(doc(db, "users", uid, "quests", week));
  const picked = questSnap.get("picked") as QuestDef[] | undefined;
  if (!Array.isArray(picked) || picked.length === 0) return null;

  const since = Date.parse(`${week}T05:00:00Z`);
  const [bets, daily, social] = await Promise.all([
    getDocs(query(collection(db, "bets"), where("uid", "==", uid), where("placedAt", ">=", Timestamp.fromMillis(since)), orderBy("placedAt", "desc"), limit(200))),
    getDocs(query(collection(db, "users", uid, "dailyPicks"), where("at", ">=", since), limit(10))),
    getDoc(doc(db, "users", uid, "questProgress", week)),
  ]);
  const days = new Set<string>();
  for (const b of bets.docs) {
    const at = b.get("placedAt") as Timestamp | undefined;
    if (at) days.add(nyDayOf(at.toMillis()));
  }
  for (const d of daily.docs) {
    const at = d.get("at") as number | undefined;
    if (typeof at === "number") days.add(nyDayOf(at));
  }
  const won = bets.docs.filter((b) => b.get("status") === "won");
  const metrics: Record<QuestMetric, number> = {
    checkin: 1,
    picks: bets.size + daily.size,
    pickDays: days.size,
    reactions: (social.get("reactions") as number | undefined) ?? 0,
    wins: won.length,
    underdogWins: won.filter((b) => ((b.get("odds") as number | undefined) ?? 0) >= 2).length,
  };
  const claimed = (questSnap.get("claimed") as Record<string, boolean> | undefined) ?? {};
  return {
    week,
    quests: picked.map((q) => ({
      id: q.id,
      kind: q.kind,
      title: q.title,
      target: q.target,
      xp: q.xp,
      progress: Math.min(q.target, metrics[q.metric] ?? 0),
      claimed: !!claimed[q.id],
    })),
  };
}

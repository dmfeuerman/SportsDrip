/**
 * Reads and non-economy self-writes the phone can do for itself.
 *
 * Each function here replaces a Cloud Function call with direct Firestore
 * reads/writes enforced by firestore.rules. Nothing here can change a balance,
 * a bet, an inventory item, or anyone else's data.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { FavoriteTeam, PublicUser, WeeklyQuest } from "@/lib/api";
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

// ── Direct Firestore self-writes (enforced by firestore.rules) ─────────────

export async function setAlertPrefs(input: {
  sweat?: boolean;
  quietHours?: boolean;
  tz?: string;
}): Promise<{ ok: true }> {
  const { db, uid } = ctx();
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.sweat !== undefined) update.sweatAlerts = input.sweat;
  if (input.quietHours !== undefined) update.quietHours = input.quietHours;
  if (input.tz !== undefined) update.tz = input.tz.slice(0, 64);
  await updateDoc(doc(db, "users", uid), update);
  return { ok: true };
}

export async function setPlayLimits(input: {
  dailyPicks?: number | null;
  breakDays?: 1 | 7 | 30;
}): Promise<{ ok: true }> {
  const { db, uid } = ctx();
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  const existing = (snap.get("limits") as { dailyPicks?: number | null; breakUntil?: number | null } | undefined) ?? {};
  const limits: Record<string, unknown> = { ...existing };
  if (input.dailyPicks !== undefined) limits.dailyPicks = input.dailyPicks;
  if (input.breakDays) limits.breakUntil = Date.now() + input.breakDays * 86_400_000;
  await updateDoc(userRef, { limits, updatedAt: serverTimestamp() });
  return { ok: true };
}

export async function updateFavoriteTeams(input: {
  teams: FavoriteTeam[];
  reminders?: boolean;
}): Promise<{ ok: true; teams: FavoriteTeam[] }> {
  const { db, uid } = ctx();
  const seen = new Set<string>();
  const teams = input.teams
    .filter((t) => {
      const k = `${t.sport}:${t.abbr.trim().toUpperCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5)
    .map((t) => ({ ...t, abbr: t.abbr.trim().toUpperCase(), name: t.name.trim() }));
  const update: Record<string, unknown> = {
    favoriteTeams: teams,
    favoriteTeamKeys: teams.map((t) => `${t.sport}:${t.abbr}`),
    updatedAt: serverTimestamp(),
  };
  if (input.reminders !== undefined) update.teamReminders = input.reminders;
  await updateDoc(doc(db, "users", uid), update);
  return { ok: true, teams };
}

export async function setFeaturedTrophy(input: {
  trophyId: string | null;
}): Promise<{ ok: true; trophyId: string | null }> {
  const { db, uid } = ctx();
  await updateDoc(doc(db, "users", uid), {
    featuredTrophy: input.trophyId ?? null,
    updatedAt: serverTimestamp(),
  });
  return { ok: true, trophyId: input.trophyId ?? null };
}

export async function setMuteTaunts(input: { mute: boolean }): Promise<{ ok: true }> {
  const { db, uid } = ctx();
  await updateDoc(doc(db, "users", uid), {
    muteTaunts: Boolean(input.mute),
    updatedAt: serverTimestamp(),
  });
  return { ok: true };
}

export async function acceptTerms(input: { version: number }): Promise<{ ok: true; version: number }> {
  const { db, uid } = ctx();
  await updateDoc(doc(db, "users", uid), {
    termsVersion: input.version,
    termsAcceptedAt: serverTimestamp(),
  });
  return { ok: true, version: input.version };
}

export async function setBackground(input: {
  backgroundId: string | null;
}): Promise<{ ok: true; backgroundId: string }> {
  const { db, uid } = ctx();
  const id = input.backgroundId ?? "liquid_glass";
  await updateDoc(doc(db, "users", uid), {
    background: id,
    updatedAt: serverTimestamp(),
  });
  return { ok: true, backgroundId: id };
}

export async function setMoveLoadout(input: { moves: string[] }): Promise<{ ok: true; moves: string[] }> {
  const { db, uid } = ctx();
  const moves = [...new Set(input.moves)].slice(0, 4);
  if (moves.length === 0) throw new Error("Pick at least one move.");
  await updateDoc(doc(db, "users", uid), {
    moves,
    updatedAt: serverTimestamp(),
  });
  return { ok: true, moves };
}

export async function unblockUser(input: { otherUid: string }): Promise<{ ok: true }> {
  const { db, uid } = ctx();
  await deleteDoc(doc(db, "users", uid, "blocks", input.otherUid));
  return { ok: true };
}

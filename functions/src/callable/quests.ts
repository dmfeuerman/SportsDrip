import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, requireAuth, Timestamp } from "../lib/economy";
import { weekKey } from "../lib/weekly";
import { grantXp } from "../lib/xp";
import { nyDay } from "../lib/streak";
import { DEFAULT_QUEST_POOL, normalizePool, selectWeeklyQuests, type QuestDef, type QuestMetric } from "../lib/questPool";

/**
 * Weekly quests: the endowed check-in plus one effort, social and skill quest,
 * drawn per user per week from meta/questPool (lib/questPool.ts). The draw is
 * frozen into users/{uid}/quests/{week}.picked on first read so editing the
 * pool mid-week never changes a player's quests. XP only, never credits.
 */

export type { QuestDef };
/** The default pool (kept as QUESTS for existing callers/tests). */
export const QUESTS: QuestDef[] = DEFAULT_QUEST_POOL;

const POOL_TTL_MS = 10 * 60_000;
let poolCache: { at: number; pool: QuestDef[] } | null = null;

async function loadPool(now: number): Promise<QuestDef[]> {
  if (poolCache && now - poolCache.at < POOL_TTL_MS) return poolCache.pool;
  let pool = DEFAULT_QUEST_POOL;
  try {
    const snap = await db.collection("meta").doc("questPool").get();
    if (snap.exists) pool = normalizePool(snap.get("quests"));
  } catch {
    // keep default
  }
  poolCache = { at: now, pool };
  return pool;
}

/** Monday 00:00 America/New_York of `week` (YYYY-MM-DD), approximated as 05:00 UTC. */
function weekStartMs(week: string): number {
  return Date.parse(`${week}T05:00:00Z`);
}

async function weekState(uid: string, week: string, now: number) {
  const since = weekStartMs(week);
  const userRef = db.collection("users").doc(uid);
  const questRef = userRef.collection("quests").doc(week);
  const [bets, daily, claims, social] = await Promise.all([
    db.collection("bets").where("uid", "==", uid).where("placedAt", ">=", Timestamp.fromMillis(since)).limit(200).get(),
    userRef.collection("dailyPicks").where("at", ">=", since).limit(10).get(),
    questRef.get(),
    userRef.collection("questProgress").doc(week).get(),
  ]);

  const days = new Set<string>();
  for (const b of bets.docs) {
    const at = b.get("placedAt") as FirebaseFirestore.Timestamp | undefined;
    if (at) days.add(nyDay(at.toMillis()));
  }
  for (const d of daily.docs) {
    const at = d.get("at") as number | undefined;
    if (typeof at === "number") days.add(nyDay(at));
  }
  const won = bets.docs.filter((b) => b.get("status") === "won");
  const metrics: Record<QuestMetric, number> = {
    checkin: 1,
    picks: bets.size + daily.size,
    pickDays: days.size,
    reactions: (social.get("reactions") as number | undefined) ?? 0,
    wins: won.length,
    underdogWins: won.filter((b) => ((b.get("odds") as number) ?? 0) >= 2).length,
  };

  let picked = claims.get("picked") as QuestDef[] | undefined;
  if (!Array.isArray(picked) || picked.length === 0) {
    picked = selectWeeklyQuests(await loadPool(now), week, uid);
    await questRef.set({ picked }, { merge: true });
  }
  const claimed = (claims.get("claimed") as Record<string, boolean> | undefined) ?? {};
  return { metrics, picked, claimed, questRef };
}

export const getWeeklyQuests = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const now = Date.now();
  const week = weekKey(now);
  const { metrics, picked, claimed } = await weekState(uid, week, now);
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
});

export const claimQuest = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { questId } = z.object({ questId: z.string().min(1) }).parse(req.data);
  const now = Date.now();
  const week = weekKey(now);
  const { metrics, picked, questRef } = await weekState(uid, week, now);
  const q = picked.find((x) => x.id === questId);
  if (!q) throw new HttpsError("not-found", "Unknown quest.");
  if ((metrics[q.metric] ?? 0) < q.target) throw new HttpsError("failed-precondition", "Not done yet.");
  await questRef.set({ claimed: { [q.id]: true } }, { merge: true });
  const res = await grantXp(uid, q.xp, `quest_${week}_${q.id}`, "quest");
  return { ok: true, xp: res.applied ? q.xp : 0, level: res.level };
});

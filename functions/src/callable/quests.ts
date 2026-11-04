import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, requireAuth, Timestamp } from "../lib/economy";
import { weekKey } from "../lib/weekly";
import { grantXp } from "../lib/xp";

/**
 * Weekly quests: three per H2H week (effort, social, skill) plus a free
 * "check in" that starts the week with progress already made. They pay XP
 * (which feeds level unlocks), never credits, and all point at the core loop.
 */

export interface QuestDef {
  id: string;
  kind: "effort" | "social" | "skill" | "endowed";
  title: string;
  target: number;
  xp: number;
}

export const QUESTS: QuestDef[] = [
  { id: "checkin", kind: "endowed", title: "Check in this week", target: 1, xp: 10 },
  { id: "picks3", kind: "effort", title: "Make 3 picks", target: 3, xp: 40 },
  { id: "daily3", kind: "social", title: "Play the Daily Pick 3 days", target: 3, xp: 50 },
  { id: "underdog", kind: "skill", title: "Hit an underdog (2.00x or longer)", target: 1, xp: 75 },
];

/** Monday 00:00 America/New_York of `week` (YYYY-MM-DD), approximated as 05:00 UTC. */
function weekStartMs(week: string): number {
  return Date.parse(`${week}T05:00:00Z`);
}

async function progressFor(uid: string, week: string): Promise<Record<string, number>> {
  const since = weekStartMs(week);
  const userRef = db.collection("users").doc(uid);
  const [bets, daily, claims] = await Promise.all([
    db.collection("bets").where("uid", "==", uid).where("placedAt", ">=", Timestamp.fromMillis(since)).limit(200).get(),
    userRef.collection("dailyPicks").where("at", ">=", since).limit(10).get(),
    userRef.collection("quests").doc(week).get(),
  ]);
  const underdog = bets.docs.some((b) => b.get("status") === "won" && ((b.get("odds") as number) ?? 0) >= 2);
  return {
    checkin: 1,
    picks3: bets.size + daily.size,
    daily3: daily.size,
    underdog: underdog ? 1 : 0,
    ...Object.fromEntries(Object.keys((claims.get("claimed") as Record<string, boolean> | undefined) ?? {}).map((k) => [`claimed_${k}`, 1])),
  };
}

export const getWeeklyQuests = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const week = weekKey(Date.now());
  const p = await progressFor(uid, week);
  return {
    week,
    quests: QUESTS.map((q) => ({
      ...q,
      progress: Math.min(q.target, p[q.id] ?? 0),
      claimed: !!p[`claimed_${q.id}`],
    })),
  };
});

export const claimQuest = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { questId } = z.object({ questId: z.string().min(1) }).parse(req.data);
  const q = QUESTS.find((x) => x.id === questId);
  if (!q) throw new HttpsError("not-found", "Unknown quest.");
  const week = weekKey(Date.now());
  const p = await progressFor(uid, week);
  if ((p[q.id] ?? 0) < q.target) throw new HttpsError("failed-precondition", "Not done yet.");
  await db.collection("users").doc(uid).collection("quests").doc(week).set({ claimed: { [q.id]: true } }, { merge: true });
  const res = await grantXp(uid, q.xp, `quest_${week}_${q.id}`, "quest");
  return { ok: true, xp: res.applied ? q.xp : 0, level: res.level };
});

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { ACHIEVEMENTS } from "../lib/achievements";

/**
 * Nightly rarity for the trophy case: how many players hold each achievement,
 * out of everyone. One count() per achievement plus one for users, written to
 * meta/achievementStats (readable by any signed-in client).
 */
export async function computeAchievementStats(now = Date.now()): Promise<{ players: number; counts: Record<string, number> }> {
  const players = (await db.collection("users").count().get()).data().count;
  const counts: Record<string, number> = {};
  for (const a of ACHIEVEMENTS) {
    counts[a.id] = (await db.collectionGroup("trophies").where("achievementId", "==", a.id).count().get()).data().count;
  }
  await db.collection("meta").doc("achievementStats").set({ players, counts, updatedAt: now });
  return { players, counts };
}

export const achievementStats = onSchedule(
  { schedule: "15 4 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 120 },
  async () => {
    const r = await computeAchievementStats();
    logger.info("achievementStats", { players: r.players });
  }
);

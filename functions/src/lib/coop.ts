import { logger } from "firebase-functions";
import { db, FieldValue } from "./economy";
import { assignArm, EXPERIMENTS, type ExperimentsDoc } from "./experiments";
import { weekKey } from "./weekly";

/**
 * League co-op goals (experimental, behind coop_goals_v1, leagueId unit).
 * leagues/{id}/coop/{week}: { target, progress, contributions, counted, rewardItemId, completedAt }.
 * target = clamp(5 × members, 20, 80) correct picks; the reward id comes from
 * meta/coopRewards.current (live-ops). Runs after settlement commits; each won
 * bet is counted once (counted.{betId}), so replays are no-ops.
 */
export const coopTarget = (members: number) => Math.min(80, Math.max(20, 5 * members));

export async function coopEnabled(leagueId: string): Promise<boolean> {
  const exp = await db.collection("meta").doc("experiments").get().catch(() => null);
  return assignArm(exp?.exists ? (exp.data() as ExperimentsDoc) : null, EXPERIMENTS.coopGoals, { uid: leagueId, leagueId }) === "treatment";
}

export async function recordCoopWins(wins: Array<{ leagueId: string; uid: string; betId: string }>, now = Date.now()): Promise<number> {
  const byLeague = new Map<string, Array<{ uid: string; betId: string }>>();
  for (const w of wins) byLeague.set(w.leagueId, [...(byLeague.get(w.leagueId) ?? []), w]);
  let completed = 0;
  const rewards = await db.collection("meta").doc("coopRewards").get().catch(() => null);
  const rewardItemId = (rewards?.get("current") as string | undefined) ?? null;
  for (const [leagueId, rows] of byLeague) {
    if (!(await coopEnabled(leagueId))) continue;
    try {
      const done = await db.runTransaction(async (tx) => {
        const leagueRef = db.collection("leagues").doc(leagueId);
        const week = weekKey(now);
        const coopRef = leagueRef.collection("coop").doc(week);
        const [league, coop] = await Promise.all([tx.get(leagueRef), tx.get(coopRef)]);
        if (!league.exists || league.get("status") !== "active") return null;
        const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
        const counted = { ...((coop.get("counted") as Record<string, boolean> | undefined) ?? {}) };
        const contributions = { ...((coop.get("contributions") as Record<string, number> | undefined) ?? {}) };
        const fresh = rows.filter((r) => !counted[r.betId]);
        if (!fresh.length) return null;
        for (const r of fresh) {
          counted[r.betId] = true;
          contributions[r.uid] = (contributions[r.uid] ?? 0) + 1;
        }
        const target = (coop.get("target") as number | undefined) ?? coopTarget(memberIds.length);
        const progress = ((coop.get("progress") as number | undefined) ?? 0) + fresh.length;
        const reward = (coop.get("rewardItemId") as string | null | undefined) ?? rewardItemId;
        const justCompleted = !coop.get("completedAt") && progress >= target;
        // Reads for the grant (before any write).
        const item = justCompleted && reward ? await tx.get(db.collection("catalog").doc(reward)) : null;
        const owned = justCompleted && reward ? await Promise.all(memberIds.map((u) => tx.get(db.collection("users").doc(u).collection("inventory").doc(reward)))) : [];

        tx.set(coopRef, { week, target, progress, contributions, counted, rewardItemId: reward ?? null, updatedAt: now, ...(justCompleted ? { completedAt: now } : {}) }, { merge: true });
        if (justCompleted) {
          if (reward && item?.exists) {
            memberIds.forEach((u, i) => {
              if (owned[i]?.exists) return;
              tx.set(db.collection("users").doc(u).collection("inventory").doc(reward), {
                itemId: reward,
                slot: item.get("slot") ?? null,
                source: "coop",
                leagueId,
                week,
                acquiredAt: FieldValue.serverTimestamp(),
              });
            });
          }
          tx.set(leagueRef.collection("messages").doc(`coop_${week}`), {
            uid: "system",
            name: "On The House",
            kind: "system",
            text: `🤝 League goal hit: ${target} correct picks this week!${reward && item?.exists ? ` Everyone unlocked ${(item.get("name") as string) ?? "a new item"}.` : ""}`,
            at: now,
            reactions: {},
            reactors: {},
          });
        }
        return justCompleted;
      });
      if (done) completed++;
    } catch (err) {
      logger.warn("coop update failed", { leagueId, error: String(err) });
    }
  }
  return completed;
}

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { weekKey } from "../lib/weekly";
import {
  coopRewardFor,
  dropDue,
  eventsToActivate,
  normalizeConfig,
  planDrop,
  type LiveOpsConfig,
  type PastDrop,
  type PoolItem,
} from "../lib/liveOps";

/**
 * Monday live-ops run (America/New_York): Drip Shop drop, sports-calendar event
 * drops, and the co-op league reward. Idempotent per week (liveOpsDrops/{week}).
 * Content lives in meta/liveOps; this only applies it on schedule.
 */
export async function runLiveOps(now = Date.now()): Promise<{ drop: string[] | null; events: string[]; coopReward: string | null }> {
  const cfgSnap = await db.collection("meta").doc("liveOps").get();
  const cfg: LiveOpsConfig = normalizeConfig(cfgSnap.exists ? (cfgSnap.data() as Partial<LiveOpsConfig>) : null);
  const out = { drop: null as string[] | null, events: [] as string[], coopReward: null as string | null };
  if (!cfg.enabled) return out;
  const week = weekKey(now);

  // Sports-calendar events first, so their items are kept out of the weekly drop.
  const activatedSnap = await db.collection("liveOpsEvents").get();
  const activated = new Set(activatedSnap.docs.map((d) => d.id));
  const eventItems = new Set<string>();
  for (const e of cfg.events) if (e.endsAt > now) e.itemIds.forEach((id) => eventItems.add(id));
  for (const e of eventsToActivate(cfg, activated, now)) {
    await db.runTransaction(async (tx) => {
    for (const id of e.itemIds) {
      tx.set(
        db.collection("catalog").doc(id),
        { available: true, rotation: true, availableFrom: e.startsAt, availableUntil: e.endsAt, featured: true, dropId: `event:${e.id}` },
        { merge: true }
      );
    }
    tx.set(db.collection("liveOpsEvents").doc(e.id), { name: e.name, itemIds: e.itemIds, startsAt: e.startsAt, endsAt: e.endsAt, activatedAt: now });
    });
    out.events.push(e.id);
  }

  // Weekly (or bi-weekly) Drip Shop drop.
  const dropRef = db.collection("liveOpsDrops").doc(week);
  const historySnap = await db.collection("liveOpsDrops").get();
  const history: PastDrop[] = historySnap.docs.map((d) => ({ week: d.id, itemIds: (d.get("itemIds") as string[]) ?? [], endsAt: (d.get("endsAt") as number) ?? 0 }));
  if (!history.some((h) => h.week === week) && dropDue(history, now)) {
    const refs = cfg.pool.map((id) => db.collection("catalog").doc(id));
    const docs = refs.length ? await db.getAll(...refs) : [];
    const pool: PoolItem[] = docs.filter((d) => d.exists).map((d) => ({ id: d.id, price: (d.get("price") as number) ?? 0 }));
    const plan = planDrop(cfg, pool, history, week, now, eventItems);
    if (!plan) {
      logger.warn("liveOps: pool too small for a drop", { week, pool: pool.length });
    } else {
      await db.runTransaction(async (tx) => {
      const live = new Set(history.filter((h) => h.endsAt > now).flatMap((h) => h.itemIds));
      for (const id of live) if (!plan.itemIds.includes(id)) tx.set(db.collection("catalog").doc(id), { featured: false }, { merge: true });
      for (const id of plan.itemIds) {
        tx.set(
          db.collection("catalog").doc(id),
          { available: true, rotation: true, availableFrom: plan.startsAt, availableUntil: plan.endsAt, featured: true, dropId: week },
          { merge: true }
        );
      }
      tx.create(dropRef, { ...plan, createdAt: now });
      });
      out.drop = plan.itemIds;
    }
  }

  // Co-op league reward (meta/coopRewards.current, read by lib/coop.ts).
  const reward = coopRewardFor(cfg, week);
  if (reward) {
    await db.collection("meta").doc("coopRewards").set({ current: reward, week }, { merge: true });
    out.coopReward = reward;
  }

  logger.info("liveOps run", { week, ...out });
  return out;
}

export const weeklyLiveOps = onSchedule(
  { schedule: "5 0 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 300 },
  async () => {
    await runLiveOps();
  }
);

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../lib/economy";
import { assignArm, EXPERIMENTS, type ExperimentsDoc } from "../lib/experiments";
import { buildCohorts, closeCohort, DEFAULT_MIN_WEEKLY_ACTIVES, tierOf, type Tier } from "../lib/ladder";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { nyDay } from "../lib/streak";
import { weekKey } from "../lib/weekly";

/**
 * Weekly ladder. Monday 09:30 ET opens cohorts (ladderCohorts/{week}_{tier}_{n});
 * Sunday 23:30 ET closes them. Off until weekly actives reach
 * meta/ladder.minWeeklyActives (default 200) and only for the ladder_v1 treatment arm.
 * Score = correct picks that week: Daily Picks won + global bets won + league bets won.
 */
const DAY = 86_400_000;

async function weeklyActives(now: number): Promise<string[]> {
  const since = nyDay(now - 7 * DAY);
  const snap = await db.collection("users").where("streak.lastDay", ">=", since).limit(20_000).get();
  return snap.docs.map((d) => d.id);
}

export async function openLadderWeek(now = Date.now()): Promise<number> {
  const [cfg, exp] = await Promise.all([db.collection("meta").doc("ladder").get(), db.collection("meta").doc("experiments").get()]);
  const min = (cfg.get("minWeeklyActives") as number | undefined) ?? DEFAULT_MIN_WEEKLY_ACTIVES;
  const actives = await weeklyActives(now);
  if (actives.length < min) {
    logger.info("ladder gated", { actives: actives.length, min });
    return 0;
  }
  const expDoc = exp.exists ? (exp.data() as ExperimentsDoc) : null;
  const enrolled = actives.filter((uid) => assignArm(expDoc, EXPERIMENTS.ladder, { uid }) === "treatment");
  const week = weekKey(now);
  const users = await db.getAll(...enrolled.map((u) => db.collection("users").doc(u)));
  const byTier = new Map<Tier, string[]>();
  for (const u of users) {
    if (!u.exists) continue;
    const t = tierOf(u.get("ladder.tier"));
    byTier.set(t, [...(byTier.get(t) ?? []), u.id]);
  }
  const friends = new Map<string, string[]>();
  await Promise.all(
    enrolled.map(async (uid) => {
      const f = await db.collection("friendships").where("users", "array-contains", uid).limit(100).get().catch(() => null);
      friends.set(uid, f?.docs.flatMap((d) => ((d.get("users") as string[]) ?? []).filter((x) => x !== uid)) ?? []);
    })
  );
  let cohorts = 0;
  for (const [tier, uids] of byTier) {
    const groups = buildCohorts(uids.sort(), (u) => friends.get(u) ?? []);
    for (const [n, members] of groups.entries()) {
      const cohortId = `${week}_${tier}_${n}`;
      const batch = db.batch();
      batch.set(db.collection("ladderCohorts").doc(cohortId), { week, tier, members, createdAt: now, closedAt: null });
      for (const uid of members) batch.update(db.collection("users").doc(uid), { ladder: { tier, cohortId, week } });
      await batch.commit();
      cohorts++;
    }
  }
  return cohorts;
}

async function weeklyScore(uid: string, week: string): Promise<number> {
  const from = Date.parse(`${week}T05:00:00Z`);
  const to = from + 7 * DAY;
  const [daily, global, league] = await Promise.all([
    db.collection("users").doc(uid).collection("dailyPicks").where("at", ">=", from).limit(10).get(),
    db.collection("bets").where("uid", "==", uid).where("status", "==", "won").limit(300).get(),
    db.collectionGroup("leagueBets").where("uid", "==", uid).where("placedAt", ">=", from).limit(300).get(),
  ]);
  const settledIn = (v: unknown) => {
    const ms = typeof v === "number" ? v : (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    return ms >= from && ms < to;
  };
  return (
    daily.docs.filter((d) => d.get("result") === "won").length +
    global.docs.filter((d) => settledIn(d.get("settledAt"))).length +
    league.docs.filter((d) => d.get("status") === "won" && ((d.get("placedAt") as number) ?? 0) < to).length
  );
}

export async function closeLadderWeek(now = Date.now()): Promise<number> {
  const week = weekKey(now);
  const open = await db.collection("ladderCohorts").where("week", "==", week).where("closedAt", "==", null).limit(2000).get();
  let moved = 0;
  for (const c of open.docs) {
    const tier = tierOf(c.get("tier"));
    const members = (c.get("members") as string[]) ?? [];
    const scores = await Promise.all(members.map(async (uid) => ({ uid, score: await weeklyScore(uid, week) })));
    const moves = closeCohort(tier, scores);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(c.ref);
      if (fresh.get("closedAt")) return;
      tx.update(c.ref, { closedAt: now, results: moves });
      for (const m of moves) {
        const userRef = db.collection("users").doc(m.uid);
        tx.update(userRef, { ladder: { tier: m.to, cohortId: null, week, lastResult: m.result, lastRank: m.rank } });
        if (m.result === "promoted") {
          tx.set(userRef.collection("trophies").doc(`ladder_${week}`), {
            id: `ladder_${week}`,
            kind: "ladder",
            title: `Promoted to ${m.to[0]!.toUpperCase()}${m.to.slice(1)}`,
            label: "⬆️",
            awardedAt: now,
            createdAt: FieldValue.serverTimestamp(),
          });
          writeNotification(
            tx,
            m.uid,
            simpleNotification({ id: `ladder_${week}`, type: "achievement", title: `Promoted to ${m.to}!`, body: `#${m.rank} among players like you this week.`, now })
          );
        }
        if (m.result !== "stayed") moved++;
      }
    });
  }
  return moved;
}

export const ladderOpen = onSchedule(
  { schedule: "30 9 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    logger.info("ladder open", { cohorts: await openLadderWeek() });
  }
);

export const ladderClose = onSchedule(
  { schedule: "30 23 * * 0", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    logger.info("ladder close", { moved: await closeLadderWeek() });
  }
);

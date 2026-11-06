"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ladderClose = exports.ladderOpen = void 0;
exports.openLadderWeek = openLadderWeek;
exports.closeLadderWeek = closeLadderWeek;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const experiments_1 = require("../lib/experiments");
const ladder_1 = require("../lib/ladder");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const streak_1 = require("../lib/streak");
const weekly_1 = require("../lib/weekly");
/**
 * Weekly ladder. Monday 09:30 ET opens cohorts (ladderCohorts/{week}_{tier}_{n});
 * Sunday 23:30 ET closes them. Off until weekly actives reach
 * meta/ladder.minWeeklyActives (default 200) and only for the ladder_v1 treatment arm.
 * Score = correct picks that week: Daily Picks won + global bets won + league bets won.
 */
const DAY = 86_400_000;
async function weeklyActives(now) {
    const since = (0, streak_1.nyDay)(now - 7 * DAY);
    const snap = await economy_1.db.collection("users").where("streak.lastDay", ">=", since).limit(20_000).get();
    return snap.docs.map((d) => d.id);
}
async function openLadderWeek(now = Date.now()) {
    const [cfg, exp] = await Promise.all([economy_1.db.collection("meta").doc("ladder").get(), economy_1.db.collection("meta").doc("experiments").get()]);
    const min = cfg.get("minWeeklyActives") ?? ladder_1.DEFAULT_MIN_WEEKLY_ACTIVES;
    const actives = await weeklyActives(now);
    if (actives.length < min) {
        firebase_functions_1.logger.info("ladder gated", { actives: actives.length, min });
        return 0;
    }
    const expDoc = exp.exists ? exp.data() : null;
    const enrolled = actives.filter((uid) => (0, experiments_1.assignArm)(expDoc, experiments_1.EXPERIMENTS.ladder, { uid }) === "treatment");
    const week = (0, weekly_1.weekKey)(now);
    const users = await economy_1.db.getAll(...enrolled.map((u) => economy_1.db.collection("users").doc(u)));
    const byTier = new Map();
    for (const u of users) {
        if (!u.exists)
            continue;
        const t = (0, ladder_1.tierOf)(u.get("ladder.tier"));
        byTier.set(t, [...(byTier.get(t) ?? []), u.id]);
    }
    const friends = new Map();
    await Promise.all(enrolled.map(async (uid) => {
        const f = await economy_1.db.collection("friendships").where("users", "array-contains", uid).limit(100).get().catch(() => null);
        friends.set(uid, f?.docs.flatMap((d) => (d.get("users") ?? []).filter((x) => x !== uid)) ?? []);
    }));
    let cohorts = 0;
    for (const [tier, uids] of byTier) {
        const groups = (0, ladder_1.buildCohorts)(uids.sort(), (u) => friends.get(u) ?? []);
        for (const [n, members] of groups.entries()) {
            const cohortId = `${week}_${tier}_${n}`;
            const batch = economy_1.db.batch();
            batch.set(economy_1.db.collection("ladderCohorts").doc(cohortId), { week, tier, members, createdAt: now, closedAt: null });
            for (const uid of members)
                batch.update(economy_1.db.collection("users").doc(uid), { ladder: { tier, cohortId, week } });
            await batch.commit();
            cohorts++;
        }
    }
    return cohorts;
}
async function weeklyScore(uid, week) {
    const from = Date.parse(`${week}T05:00:00Z`);
    const to = from + 7 * DAY;
    const [daily, global, league] = await Promise.all([
        economy_1.db.collection("users").doc(uid).collection("dailyPicks").where("at", ">=", from).limit(10).get(),
        economy_1.db.collection("bets").where("uid", "==", uid).where("status", "==", "won").limit(300).get(),
        economy_1.db.collectionGroup("leagueBets").where("uid", "==", uid).where("placedAt", ">=", from).limit(300).get(),
    ]);
    const settledIn = (v) => {
        const ms = typeof v === "number" ? v : v?.toMillis?.() ?? 0;
        return ms >= from && ms < to;
    };
    return (daily.docs.filter((d) => d.get("result") === "won").length +
        global.docs.filter((d) => settledIn(d.get("settledAt"))).length +
        league.docs.filter((d) => d.get("status") === "won" && (d.get("placedAt") ?? 0) < to).length);
}
async function closeLadderWeek(now = Date.now()) {
    const week = (0, weekly_1.weekKey)(now);
    const open = await economy_1.db.collection("ladderCohorts").where("week", "==", week).where("closedAt", "==", null).limit(2000).get();
    let moved = 0;
    for (const c of open.docs) {
        const tier = (0, ladder_1.tierOf)(c.get("tier"));
        const members = c.get("members") ?? [];
        const scores = await Promise.all(members.map(async (uid) => ({ uid, score: await weeklyScore(uid, week) })));
        const moves = (0, ladder_1.closeCohort)(tier, scores);
        await economy_1.db.runTransaction(async (tx) => {
            const fresh = await tx.get(c.ref);
            if (fresh.get("closedAt"))
                return;
            tx.update(c.ref, { closedAt: now, results: moves });
            for (const m of moves) {
                const userRef = economy_1.db.collection("users").doc(m.uid);
                tx.update(userRef, { ladder: { tier: m.to, cohortId: null, week, lastResult: m.result, lastRank: m.rank } });
                if (m.result === "promoted") {
                    tx.set(userRef.collection("trophies").doc(`ladder_${week}`), {
                        id: `ladder_${week}`,
                        kind: "ladder",
                        title: `Promoted to ${m.to[0].toUpperCase()}${m.to.slice(1)}`,
                        label: "⬆️",
                        awardedAt: now,
                        createdAt: economy_1.FieldValue.serverTimestamp(),
                    });
                    (0, notify_1.writeNotification)(tx, m.uid, (0, notifyModel_1.simpleNotification)({ id: `ladder_${week}`, type: "achievement", title: `Promoted to ${m.to}!`, body: `#${m.rank} among players like you this week.`, now }));
                }
                if (m.result !== "stayed")
                    moved++;
            }
        });
    }
    return moved;
}
exports.ladderOpen = (0, scheduler_1.onSchedule)({ schedule: "30 9 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
    firebase_functions_1.logger.info("ladder open", { cohorts: await openLadderWeek() });
});
exports.ladderClose = (0, scheduler_1.onSchedule)({ schedule: "30 23 * * 0", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
    firebase_functions_1.logger.info("ladder close", { moved: await closeLadderWeek() });
});
//# sourceMappingURL=ladder.js.map
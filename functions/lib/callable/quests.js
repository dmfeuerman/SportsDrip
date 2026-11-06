"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimQuest = exports.getWeeklyQuests = exports.QUESTS = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const weekly_1 = require("../lib/weekly");
const xp_1 = require("../lib/xp");
const streak_1 = require("../lib/streak");
const questPool_1 = require("../lib/questPool");
/** The default pool (kept as QUESTS for existing callers/tests). */
exports.QUESTS = questPool_1.DEFAULT_QUEST_POOL;
const POOL_TTL_MS = 10 * 60_000;
let poolCache = null;
async function loadPool(now) {
    if (poolCache && now - poolCache.at < POOL_TTL_MS)
        return poolCache.pool;
    let pool = questPool_1.DEFAULT_QUEST_POOL;
    try {
        const snap = await economy_1.db.collection("meta").doc("questPool").get();
        if (snap.exists)
            pool = (0, questPool_1.normalizePool)(snap.get("quests"));
    }
    catch {
        // keep default
    }
    poolCache = { at: now, pool };
    return pool;
}
/** Monday 00:00 America/New_York of `week` (YYYY-MM-DD), approximated as 05:00 UTC. */
function weekStartMs(week) {
    return Date.parse(`${week}T05:00:00Z`);
}
async function weekState(uid, week, now) {
    const since = weekStartMs(week);
    const userRef = economy_1.db.collection("users").doc(uid);
    const questRef = userRef.collection("quests").doc(week);
    const [bets, daily, claims, social] = await Promise.all([
        economy_1.db.collection("bets").where("uid", "==", uid).where("placedAt", ">=", economy_1.Timestamp.fromMillis(since)).limit(200).get(),
        userRef.collection("dailyPicks").where("at", ">=", since).limit(10).get(),
        questRef.get(),
        userRef.collection("questProgress").doc(week).get(),
    ]);
    const days = new Set();
    for (const b of bets.docs) {
        const at = b.get("placedAt");
        if (at)
            days.add((0, streak_1.nyDay)(at.toMillis()));
    }
    for (const d of daily.docs) {
        const at = d.get("at");
        if (typeof at === "number")
            days.add((0, streak_1.nyDay)(at));
    }
    const won = bets.docs.filter((b) => b.get("status") === "won");
    const metrics = {
        checkin: 1,
        picks: bets.size + daily.size,
        pickDays: days.size,
        reactions: social.get("reactions") ?? 0,
        wins: won.length,
        underdogWins: won.filter((b) => (b.get("odds") ?? 0) >= 2).length,
    };
    let picked = claims.get("picked");
    if (!Array.isArray(picked) || picked.length === 0) {
        picked = (0, questPool_1.selectWeeklyQuests)(await loadPool(now), week, uid);
        await questRef.set({ picked }, { merge: true });
    }
    const claimed = claims.get("claimed") ?? {};
    return { metrics, picked, claimed, questRef };
}
exports.getWeeklyQuests = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const now = Date.now();
    const week = (0, weekly_1.weekKey)(now);
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
exports.claimQuest = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { questId } = zod_1.z.object({ questId: zod_1.z.string().min(1) }).parse(req.data);
    const now = Date.now();
    const week = (0, weekly_1.weekKey)(now);
    const { metrics, picked, questRef } = await weekState(uid, week, now);
    const q = picked.find((x) => x.id === questId);
    if (!q)
        throw new https_1.HttpsError("not-found", "Unknown quest.");
    if ((metrics[q.metric] ?? 0) < q.target)
        throw new https_1.HttpsError("failed-precondition", "Not done yet.");
    await questRef.set({ claimed: { [q.id]: true } }, { merge: true });
    const res = await (0, xp_1.grantXp)(uid, q.xp, `quest_${week}_${q.id}`, "quest");
    return { ok: true, xp: res.applied ? q.xp : 0, level: res.level };
});
//# sourceMappingURL=quests.js.map
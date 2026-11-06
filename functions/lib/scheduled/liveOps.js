"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyLiveOps = void 0;
exports.runLiveOps = runLiveOps;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const weekly_1 = require("../lib/weekly");
const liveOps_1 = require("../lib/liveOps");
/**
 * Monday live-ops run (America/New_York): Drip Shop drop, sports-calendar event
 * drops, and the co-op league reward. Idempotent per week (liveOpsDrops/{week}).
 * Content lives in meta/liveOps; this only applies it on schedule.
 */
async function runLiveOps(now = Date.now()) {
    const cfgSnap = await economy_1.db.collection("meta").doc("liveOps").get();
    const cfg = (0, liveOps_1.normalizeConfig)(cfgSnap.exists ? cfgSnap.data() : null);
    const out = { drop: null, events: [], coopReward: null };
    if (!cfg.enabled)
        return out;
    const week = (0, weekly_1.weekKey)(now);
    // Sports-calendar events first, so their items are kept out of the weekly drop.
    const activatedSnap = await economy_1.db.collection("liveOpsEvents").get();
    const activated = new Set(activatedSnap.docs.map((d) => d.id));
    const eventItems = new Set();
    for (const e of cfg.events)
        if (e.endsAt > now)
            e.itemIds.forEach((id) => eventItems.add(id));
    for (const e of (0, liveOps_1.eventsToActivate)(cfg, activated, now)) {
        await economy_1.db.runTransaction(async (tx) => {
            for (const id of e.itemIds) {
                tx.set(economy_1.db.collection("catalog").doc(id), { available: true, rotation: true, availableFrom: e.startsAt, availableUntil: e.endsAt, featured: true, dropId: `event:${e.id}` }, { merge: true });
            }
            tx.set(economy_1.db.collection("liveOpsEvents").doc(e.id), { name: e.name, itemIds: e.itemIds, startsAt: e.startsAt, endsAt: e.endsAt, activatedAt: now });
        });
        out.events.push(e.id);
    }
    // Weekly (or bi-weekly) Drip Shop drop.
    const dropRef = economy_1.db.collection("liveOpsDrops").doc(week);
    const historySnap = await economy_1.db.collection("liveOpsDrops").get();
    const history = historySnap.docs.map((d) => ({ week: d.id, itemIds: d.get("itemIds") ?? [], endsAt: d.get("endsAt") ?? 0 }));
    if (!history.some((h) => h.week === week) && (0, liveOps_1.dropDue)(history, now)) {
        const refs = cfg.pool.map((id) => economy_1.db.collection("catalog").doc(id));
        const docs = refs.length ? await economy_1.db.getAll(...refs) : [];
        const pool = docs.filter((d) => d.exists).map((d) => ({ id: d.id, price: d.get("price") ?? 0 }));
        const plan = (0, liveOps_1.planDrop)(cfg, pool, history, week, now, eventItems);
        if (!plan) {
            firebase_functions_1.logger.warn("liveOps: pool too small for a drop", { week, pool: pool.length });
        }
        else {
            await economy_1.db.runTransaction(async (tx) => {
                const live = new Set(history.filter((h) => h.endsAt > now).flatMap((h) => h.itemIds));
                for (const id of live)
                    if (!plan.itemIds.includes(id))
                        tx.set(economy_1.db.collection("catalog").doc(id), { featured: false }, { merge: true });
                for (const id of plan.itemIds) {
                    tx.set(economy_1.db.collection("catalog").doc(id), { available: true, rotation: true, availableFrom: plan.startsAt, availableUntil: plan.endsAt, featured: true, dropId: week }, { merge: true });
                }
                tx.create(dropRef, { ...plan, createdAt: now });
            });
            out.drop = plan.itemIds;
        }
    }
    // Co-op league reward (meta/coopRewards.current, read by lib/coop.ts).
    const reward = (0, liveOps_1.coopRewardFor)(cfg, week);
    if (reward) {
        await economy_1.db.collection("meta").doc("coopRewards").set({ current: reward, week }, { merge: true });
        out.coopReward = reward;
    }
    firebase_functions_1.logger.info("liveOps run", { week, ...out });
    return out;
}
exports.weeklyLiveOps = (0, scheduler_1.onSchedule)({ schedule: "5 0 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 300 }, async () => {
    await runLiveOps();
});
//# sourceMappingURL=liveOps.js.map
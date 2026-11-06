"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DROP = exports.MIN_DROP = void 0;
exports.normalizeConfig = normalizeConfig;
exports.prizeBoxYieldCeiling = prizeBoxYieldCeiling;
exports.planDrop = planDrop;
exports.dropDue = dropDue;
exports.eventsToActivate = eventsToActivate;
exports.coopRewardFor = coopRewardFor;
const economy_1 = require("./economy");
const experiments_1 = require("./experiments");
const WEEK = 7 * 86_400_000;
exports.MIN_DROP = 3;
exports.MAX_DROP = 6;
function normalizeConfig(raw) {
    const r = raw ?? {};
    return {
        enabled: r.enabled === true,
        cadenceWeeks: r.cadenceWeeks === 2 ? 2 : 1,
        dropSize: Math.min(exports.MAX_DROP, Math.max(exports.MIN_DROP, Math.floor(r.dropSize ?? 4))),
        returnEvery: Math.max(0, Math.floor(r.returnEvery ?? 3)),
        returnCooldownWeeks: Math.max(1, Math.floor(r.returnCooldownWeeks ?? 6)),
        pool: Array.isArray(r.pool) ? r.pool.filter((x) => typeof x === "string") : [],
        coopRewardPool: Array.isArray(r.coopRewardPool) ? r.coopRewardPool.filter((x) => typeof x === "string") : [],
        events: Array.isArray(r.events) ? r.events.filter((e) => e && e.id && e.endsAt > e.startsAt) : [],
    };
}
/**
 * Highest credits one Prize Box claim can expected-yield (gold EV + max streak
 * bonus). Rotation items must be priced above it: rotation raises demand, never
 * credit supply.
 */
function prizeBoxYieldCeiling() {
    const ev = (tier) => {
        const segs = economy_1.PRIZE_BOXES[tier].segments;
        const w = segs.reduce((n, s) => n + s.weight, 0);
        return segs.reduce((n, s) => n + s.credits * s.weight, 0) / w;
    };
    return Math.ceil(Math.max(ev("bronze"), ev("silver"), ev("gold")) + 7 * 15);
}
const rank = (seed, id) => (0, experiments_1.fnv1a)(`${seed}:${id}`);
/**
 * Picks this week's drop: never-dropped items first, then the longest-retired;
 * every `returnEvery`th drop swaps one slot for a retired item past cooldown.
 * Deterministic per week, so a retried run plans the same drop.
 */
function planDrop(cfg, pool, history, week, now, blocked = new Set()) {
    const floor = prizeBoxYieldCeiling();
    const eligible = pool.filter((p) => cfg.pool.includes(p.id) && p.price > floor && !blocked.has(p.id));
    const lastSeen = new Map();
    for (const d of history)
        for (const id of d.itemIds)
            lastSeen.set(id, Math.max(lastSeen.get(id) ?? 0, d.endsAt));
    const live = new Set(history.filter((d) => d.endsAt > now).flatMap((d) => d.itemIds));
    const fresh = eligible.filter((p) => !lastSeen.has(p.id)).sort((a, b) => rank(week, a.id) - rank(week, b.id));
    const retired = eligible
        .filter((p) => lastSeen.has(p.id) && !live.has(p.id) && now - lastSeen.get(p.id) >= cfg.returnCooldownWeeks * WEEK)
        .sort((a, b) => lastSeen.get(a.id) - lastSeen.get(b.id) || rank(week, a.id) - rank(week, b.id));
    const dropNumber = history.length + 1;
    const wantReturn = cfg.returnEvery > 0 && dropNumber % cfg.returnEvery === 0 ? 1 : 0;
    const returning = retired.slice(0, wantReturn).map((p) => p.id);
    // Pool exhausted of new items: fill from retired rather than skip the drop.
    const rest = [...fresh, ...retired.slice(returning.length)].slice(0, cfg.dropSize - returning.length).map((p) => p.id);
    const itemIds = [...rest, ...returning];
    if (itemIds.length < exports.MIN_DROP)
        return null;
    return {
        week,
        itemIds,
        returning: returning.concat(rest.filter((id) => lastSeen.has(id))),
        startsAt: now,
        endsAt: now + cfg.cadenceWeeks * WEEK,
    };
}
/** Whether a new drop is due: none live, or the live one ends within a day. */
function dropDue(history, now) {
    const latest = history.reduce((n, d) => Math.max(n, d.endsAt), 0);
    return latest - now <= 86_400_000;
}
/** Events to activate this run: starting within the next week, not ended, not yet activated. */
function eventsToActivate(cfg, activated, now) {
    return cfg.events.filter((e) => !activated.has(e.id) && e.endsAt > now && e.startsAt < now + WEEK && e.itemIds.length > 0);
}
/** Co-op league reward for a week: round-robin over the pool by week index. */
function coopRewardFor(cfg, week) {
    if (!cfg.coopRewardPool.length)
        return null;
    const idx = Math.floor(Date.parse(`${week}T00:00:00Z`) / WEEK);
    return cfg.coopRewardPool[((idx % cfg.coopRewardPool.length) + cfg.coopRewardPool.length) % cfg.coopRewardPool.length];
}
//# sourceMappingURL=liveOps.js.map
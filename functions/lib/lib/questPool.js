"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_QUEST_POOL = exports.SELECTED_KINDS = exports.QUEST_METRICS = void 0;
exports.normalizePool = normalizePool;
exports.selectWeeklyQuests = selectWeeklyQuests;
const experiments_1 = require("./experiments");
exports.QUEST_METRICS = ["checkin", "picks", "pickDays", "reactions", "wins", "underdogWins"];
exports.SELECTED_KINDS = ["effort", "social", "skill"];
exports.DEFAULT_QUEST_POOL = [
    { id: "checkin", kind: "endowed", metric: "checkin", title: "Check in this week", target: 1, xp: 10 },
    { id: "picks3", kind: "effort", metric: "picks", title: "Make 3 picks", target: 3, xp: 40 },
    { id: "picks5", kind: "effort", metric: "picks", title: "Make 5 picks", target: 5, xp: 60 },
    { id: "days3", kind: "effort", metric: "pickDays", title: "Pick on 3 different days", target: 3, xp: 60 },
    { id: "react2", kind: "social", metric: "reactions", title: "React to 2 friends' picks", target: 2, xp: 50 },
    { id: "react4", kind: "social", metric: "reactions", title: "React to 4 friends' picks", target: 4, xp: 70 },
    { id: "underdog", kind: "skill", metric: "underdogWins", title: "Hit an underdog (2.00x or longer)", target: 1, xp: 75 },
    { id: "wins2", kind: "skill", metric: "wins", title: "Win 2 bets", target: 2, xp: 60 },
];
/** Drops malformed / inactive entries. Falls back to the default pool for any kind left empty. */
function normalizePool(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const ok = list.filter((q) => !!q &&
        typeof q.id === "string" &&
        q.id.length > 0 &&
        ["effort", "social", "skill", "endowed"].includes(q.kind) &&
        exports.QUEST_METRICS.includes(q.metric) &&
        typeof q.title === "string" &&
        Number.isFinite(q.target) &&
        q.target >= 1 &&
        Number.isFinite(q.xp) &&
        q.xp >= 0 &&
        q.active !== false);
    const out = [...ok];
    for (const kind of ["endowed", ...exports.SELECTED_KINDS]) {
        if (!out.some((q) => q.kind === kind))
            out.push(...exports.DEFAULT_QUEST_POOL.filter((q) => q.kind === kind));
    }
    return out;
}
/** Every endowed quest, then one per selected kind. Stable for a (week, uid). */
function selectWeeklyQuests(pool, week, uid) {
    const out = pool.filter((q) => q.kind === "endowed");
    for (const kind of exports.SELECTED_KINDS) {
        const c = pool.filter((q) => q.kind === kind).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const pick = c[(0, experiments_1.fnv1a)(`quests:${week}:${uid}:${kind}`) % Math.max(1, c.length)];
        if (pick)
            out.push(pick);
    }
    return out;
}
//# sourceMappingURL=questPool.js.map
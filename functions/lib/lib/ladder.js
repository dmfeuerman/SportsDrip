"use strict";
/**
 * Near-peer weekly ladder (pure). Tiers Bronze → Diamond. Cohorts of 10–15 per
 * tier, friends seeded together where possible. Weekly close promotes the top
 * 3 and relegates the bottom 3 (only in cohorts big enough that they don't overlap).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tierOf = exports.DEFAULT_MIN_WEEKLY_ACTIVES = exports.MOVERS = exports.COHORT_MAX = exports.COHORT_MIN = exports.TIERS = void 0;
exports.cohortSizes = cohortSizes;
exports.buildCohorts = buildCohorts;
exports.closeCohort = closeCohort;
exports.TIERS = ["bronze", "silver", "gold", "platinum", "diamond"];
exports.COHORT_MIN = 10;
exports.COHORT_MAX = 15;
exports.MOVERS = 3;
/** Default for meta/ladder.minWeeklyActives. Below this, cohorts are too thin. */
exports.DEFAULT_MIN_WEEKLY_ACTIVES = 200;
const tierOf = (t) => exports.TIERS.includes(t) ? t : "bronze";
exports.tierOf = tierOf;
/** Split n players into groups of 10–15 (one group when n < 20 can't split). */
function cohortSizes(n) {
    if (n <= 0)
        return [];
    if (n < exports.COHORT_MIN)
        return [n];
    let k = Math.ceil(n / exports.COHORT_MAX);
    // 16–19 can't split into two groups of ≥10; keep one slightly larger cohort instead.
    if (Math.floor(n / k) < exports.COHORT_MIN)
        k = Math.max(1, k - 1);
    const base = Math.floor(n / k);
    return Array.from({ length: k }, (_, i) => base + (i < n % k ? 1 : 0));
}
/**
 * Orders players so friends sit next to each other, then cuts by cohortSizes.
 * Deterministic for a given input order.
 */
function buildCohorts(uids, friendsOf) {
    const pool = new Set(uids);
    const ordered = [];
    for (const u of uids) {
        if (!pool.has(u))
            continue;
        pool.delete(u);
        ordered.push(u);
        for (const f of friendsOf(u)) {
            if (pool.has(f)) {
                pool.delete(f);
                ordered.push(f);
            }
        }
    }
    const out = [];
    let i = 0;
    for (const size of cohortSizes(ordered.length)) {
        out.push(ordered.slice(i, i + size));
        i += size;
    }
    return out;
}
/** Ranks a cohort by score (ties by uid) and decides moves. */
function closeCohort(tier, scores) {
    const ranked = [...scores].sort((a, b) => b.score - a.score || (a.uid < b.uid ? -1 : 1));
    const t = exports.TIERS.indexOf(tier);
    const movers = ranked.length >= exports.MOVERS * 2 + 1 ? exports.MOVERS : 0;
    return ranked.map((s, i) => {
        let to = tier;
        let result = "stayed";
        if (i < movers && t < exports.TIERS.length - 1 && s.score > 0) {
            to = exports.TIERS[t + 1];
            result = "promoted";
        }
        else if (i >= ranked.length - movers && t > 0) {
            to = exports.TIERS[t - 1];
            result = "relegated";
        }
        return { uid: s.uid, rank: i + 1, score: s.score, from: tier, to, result };
    });
}
//# sourceMappingURL=ladder.js.map
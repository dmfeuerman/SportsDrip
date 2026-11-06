"use strict";
/**
 * Deterministic experiment bucketing. MUST stay byte-for-byte equivalent to
 * artifacts/mobile/lib/experiments.ts so a push and the screen it opens agree
 * on the arm. Config lives in meta/experiments; treatments live in code.
 *
 *   bucket = fnv1a(experimentId + ":" + unit) % 100
 *
 * unit is the uid for individual features and the leagueId for social ones,
 * so a league shares one arm (no spillover). A global holdout (bucketed on uid
 * alone) gets "control" for every engagement experiment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPERIMENTS = exports.CONTROL = exports.HOLDOUT_ID = void 0;
exports.fnv1a = fnv1a;
exports.bucket = bucket;
exports.inHoldout = inHoldout;
exports.assignArm = assignArm;
exports.HOLDOUT_ID = "globalHoldout";
exports.CONTROL = "control";
function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}
function bucket(experimentId, unit) {
    return fnv1a(`${experimentId}:${unit}`) % 100;
}
function inHoldout(uid, pct) {
    return pct > 0 && bucket(exports.HOLDOUT_ID, uid) < pct;
}
/** The arm for this subject, or "control" when inactive, unknown, held out or unit missing. */
function assignArm(doc, experimentId, subject) {
    const exp = doc?.experiments?.find((e) => e.id === experimentId);
    if (!exp || !exp.active)
        return exports.CONTROL;
    // The holdout is per user; league-unit experiments share one arm per league, so it doesn't apply.
    if (exp.unit === "uid" && inHoldout(subject.uid, doc?.globalHoldout ?? 0))
        return exports.CONTROL;
    const unit = exp.unit === "leagueId" ? subject.leagueId : subject.uid;
    if (!unit)
        return exports.CONTROL;
    const b = bucket(experimentId, unit);
    let acc = 0;
    for (const [arm, pct] of Object.entries(exp.splits ?? {})) {
        acc += pct;
        if (b < acc)
            return arm;
    }
    return exports.CONTROL;
}
/** Experiment ids referenced by code. Seed meta/experiments with these. */
exports.EXPERIMENTS = {
    coopGoals: "coop_goals_v1",
    widgetPromo: "widget_promo_v1",
    ladder: "ladder_v1",
    shopRotation: "shop_rotation_v1",
    seasonPass: "season_pass_v1",
};
//# sourceMappingURL=experiments.js.map
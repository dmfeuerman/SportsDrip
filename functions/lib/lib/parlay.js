"use strict";
/**
 * Pure group-parlay math.
 *
 * Each member in a league can contribute a leg (2–4 legs total). Everyone who
 * rides the parlay stakes their own league tokens at the combined decimal
 * price, capped at MAX_PARLAY_ODDS (20x) to protect the league economy.
 * When any leg loses, `bustedBy` records whose leg killed the ticket.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PARLAY_ODDS = exports.MAX_PARLAY_LEGS = exports.MIN_PARLAY_LEGS = void 0;
exports.combinedParlayOdds = combinedParlayOdds;
exports.gradeParlayLegs = gradeParlayLegs;
exports.applyOutcomeToLeg = applyOutcomeToLeg;
exports.MIN_PARLAY_LEGS = 2;
exports.MAX_PARLAY_LEGS = 4;
exports.MAX_PARLAY_ODDS = 20.0;
const round2 = (n) => Math.round(n * 100) / 100;
/** Combined decimal price across legs, treating push/void legs as 1.0x and capping at 20x. */
function combinedParlayOdds(legs) {
    if (!legs.length)
        return 1;
    let product = 1;
    for (const leg of legs) {
        if (leg.status === "push" || leg.status === "void")
            continue;
        if (typeof leg.odds === "number" && Number.isFinite(leg.odds) && leg.odds > 1) {
            product *= leg.odds;
        }
    }
    return round2(Math.min(exports.MAX_PARLAY_ODDS, Math.max(1, product)));
}
/** Grades a parlay from its legs. A single lost leg busts the slip immediately. */
function gradeParlayLegs(legs) {
    const lost = legs.find((l) => l.status === "lost");
    if (lost) {
        return {
            status: "lost",
            effectiveOdds: 0,
            bustedBy: lost.uid,
            bustedByName: lost.name,
            bustedLeg: lost.label,
        };
    }
    if (legs.some((l) => l.status === "pending")) {
        return {
            status: "pending",
            effectiveOdds: combinedParlayOdds(legs),
            bustedBy: null,
            bustedByName: null,
            bustedLeg: null,
        };
    }
    const anyWon = legs.some((l) => l.status === "won");
    if (!anyWon) {
        return {
            status: "push",
            effectiveOdds: 1,
            bustedBy: null,
            bustedByName: null,
            bustedLeg: null,
        };
    }
    return {
        status: "won",
        effectiveOdds: combinedParlayOdds(legs),
        bustedBy: null,
        bustedByName: null,
        bustedLeg: null,
    };
}
function applyOutcomeToLeg(leg, outcome) {
    return { ...leg, status: outcome };
}
//# sourceMappingURL=parlay.js.map
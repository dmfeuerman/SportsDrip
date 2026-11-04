"use strict";
/** Pure settlement rules, shared by main-wallet and league bets. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decide = decide;
exports.settlementCredit = settlementCredit;
exports.payoutFor = payoutFor;
/**
 * Settles moneyline, point-spread, and over/under total picks.
 *
 *  - Moneyline: draws are a push (stake back), never scored as an away win (AUDIT B11).
 *  - Spread: `line` is stored from the picked team's perspective (e.g. -3.5 for a
 *    favourite, +3.5 for an underdog). Landing on the exact number is a push.
 *  - Total: compares `homeScore + awayScore` against `line`. Landing on the
 *    exact number is a push.
 */
function decide(pickOrSide, homeScore, awayScore) {
    if (typeof pickOrSide === "string") {
        if (homeScore === awayScore)
            return "push";
        const homeWon = homeScore > awayScore;
        return (pickOrSide === "home") === homeWon ? "won" : "lost";
    }
    const market = pickOrSide.market ?? "ml";
    const selection = pickOrSide.selection ?? (pickOrSide.side === "away" ? "away" : "home");
    if (market === "spread") {
        const line = typeof pickOrSide.line === "number" && Number.isFinite(pickOrSide.line) ? pickOrSide.line : 0;
        const pickedScore = (selection === "home" ? homeScore : awayScore) + line;
        const oppScore = selection === "home" ? awayScore : homeScore;
        if (Math.abs(pickedScore - oppScore) < 1e-9)
            return "push";
        return pickedScore > oppScore ? "won" : "lost";
    }
    if (market === "total") {
        const line = typeof pickOrSide.line === "number" && Number.isFinite(pickOrSide.line) ? pickOrSide.line : 0;
        const total = homeScore + awayScore;
        if (Math.abs(total - line) < 1e-9)
            return "push";
        if (selection === "over")
            return total > line ? "won" : "lost";
        return total < line ? "won" : "lost";
    }
    // Moneyline default
    if (homeScore === awayScore)
        return "push";
    const homeWon = homeScore > awayScore;
    return (selection === "home") === homeWon ? "won" : "lost";
}
/** Tokens returned to the bettor at settlement. The stake left at placement. */
function settlementCredit(outcome, stake, potentialPayout) {
    if (outcome === "won")
        return potentialPayout;
    if (outcome === "push")
        return stake;
    return 0;
}
function payoutFor(stake, odds) {
    return Math.round(stake * odds);
}
//# sourceMappingURL=settlement.js.map
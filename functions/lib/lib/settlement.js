"use strict";
/** Pure settlement rules, shared by main-wallet and league bets. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decide = decide;
exports.settlementCredit = settlementCredit;
exports.payoutFor = payoutFor;
/** Draws are a push (stake back), never scored as an away win (AUDIT B11). */
function decide(side, homeScore, awayScore) {
    if (homeScore === awayScore)
        return "push";
    const homeWon = homeScore > awayScore;
    return (side === "home") === homeWon ? "won" : "lost";
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
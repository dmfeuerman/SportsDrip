"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLASH_MAX_STAKE = exports.FLASH_MIN_STAKE = exports.FLASH_PAID_ODDS = exports.FLASH_REWARD = exports.FLASH_FREE_PER_DAY = void 0;
exports.decideFlash = decideFlash;
/**
 * Flash picks: "who scores next?" calls on a live game.
 *
 * The first 3 live picks each day are free (0 stake, +200 credits reward).
 * After those 3 free daily picks are used, players can place unlimited paid
 * live picks using quick-action credit stakes at flat 1.91x (stake deducted
 * up front and refunded on a push; 1 active pick per game at a time).
 */
exports.FLASH_FREE_PER_DAY = 3;
exports.FLASH_REWARD = 200;
exports.FLASH_PAID_ODDS = 1.91;
exports.FLASH_MIN_STAKE = 10;
exports.FLASH_MAX_STAKE = 5_000;
/**
 * Grades a pick against the current scoreboard. Null while nothing has
 * happened. Scores are sampled, not play-by-play: if both sides scored
 * between samples the bigger gain takes it, and equal gains push.
 * A game that ends with no further score is a push.
 */
function decideFlash(pick, home, away, status) {
    if (home === null || away === null)
        return status === "final" ? "push" : null;
    const dh = home - pick.homeAt;
    const da = away - pick.awayAt;
    // A corrected (lowered) score voids the pick.
    if (dh < 0 || da < 0)
        return "push";
    if (dh === 0 && da === 0)
        return status === "final" ? "push" : null;
    if (dh === da)
        return "push";
    const scorer = dh > da ? "home" : "away";
    return scorer === pick.side ? "won" : "lost";
}
//# sourceMappingURL=flash.js.map
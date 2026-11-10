"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLASH_PER_DAY = exports.FLASH_PER_GAME = exports.FLASH_REWARD = void 0;
exports.decideFlash = decideFlash;
/**
 * Flash picks: free "who scores next?" calls on a live game.
 *
 * No stake, a small fixed reward, hard caps per game and per day. In-play
 * betting is the feature most tied to harm in the gambling research, so this
 * stays free, small and rate-limited by design, and honours play limits.
 */
exports.FLASH_REWARD = 20;
exports.FLASH_PER_GAME = 3;
exports.FLASH_PER_DAY = 12;
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
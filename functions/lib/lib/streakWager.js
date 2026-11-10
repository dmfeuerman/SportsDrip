"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAGER_MULTIPLIER = exports.WAGER_STAKES = exports.WAGER_DAYS = void 0;
exports.evaluateWager = evaluateWager;
exports.wagerProgress = wagerProgress;
const streak_1 = require("./streak");
/**
 * Streak wager: stake credits that you'll add WAGER_DAYS to your pick streak.
 * Hit it and the stake comes back doubled; let the streak lapse and it's gone.
 * One at a time, small fixed stakes, so it can't become a way to print credits.
 */
exports.WAGER_DAYS = 7;
exports.WAGER_STAKES = [50, 100, 250];
exports.WAGER_MULTIPLIER = 2;
/** Grades a wager against the player's streak at `now`. */
function evaluateWager(w, streak, now) {
    const count = Math.floor(streak?.count ?? 0);
    const alive = (0, streak_1.activeStreakCount)(streak, now) > 0;
    if (alive && count >= w.target)
        return "won";
    // A same-day repair in progress shows a count of 1; it can still be restored today.
    const repairing = streak?.repairPending?.day === (0, streak_1.nyDay)(now);
    if (!alive && !(w.startCount === 0 && w.startDay === (0, streak_1.nyDay)(now)))
        return "lost";
    if (count < w.startCount && !repairing)
        return "lost";
    return "active";
}
/** Days banked toward the target (0..WAGER_DAYS). */
function wagerProgress(w, streak) {
    return Math.max(0, Math.min(exports.WAGER_DAYS, Math.floor(streak?.count ?? 0) - w.startCount));
}
//# sourceMappingURL=streakWager.js.map
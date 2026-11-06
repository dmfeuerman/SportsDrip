"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.advanceFriendStreak = advanceFriendStreak;
exports.activeFriendStreak = activeFriendStreak;
const streak_1 = require("./streak");
/**
 * Next state when both friends have acted on `day`, or null when that day was
 * already counted (idempotent across both users' triggers).
 */
function advanceFriendStreak(current, day) {
    const prevDay = current?.lastDay ?? "";
    if (prevDay === day)
        return null;
    const prevCount = Math.max(0, Math.floor(current?.count ?? 0));
    const longest = Math.max(prevCount, Math.floor(current?.longest ?? 0));
    if (prevDay && (0, streak_1.dayNumber)(prevDay) > (0, streak_1.dayNumber)(day))
        return null;
    const count = prevDay && (0, streak_1.dayNumber)(day) - (0, streak_1.dayNumber)(prevDay) === 1 && prevCount > 0 ? prevCount + 1 : 1;
    return { count, longest: Math.max(longest, count), lastDay: day };
}
/** Live length at `now`: alive through the end of the day after the last shared day. */
function activeFriendStreak(current, now) {
    if (!current?.lastDay || !current.count)
        return 0;
    const diff = (0, streak_1.dayNumber)((0, streak_1.nyDay)(now)) - (0, streak_1.dayNumber)(current.lastDay);
    return diff === 0 || diff === 1 ? Math.floor(current.count) : 0;
}
//# sourceMappingURL=friendStreak.js.map
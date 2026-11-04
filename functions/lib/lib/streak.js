"use strict";
/**
 * Daily pick streak tracking in server time (America/New_York).
 *
 * Counts consecutive calendar days with at least one placed bet and computes
 * the small prize-box streak bonus (kept small so store prices stay out of
 * reach of box openings alone).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nyDay = nyDay;
exports.advanceStreak = advanceStreak;
exports.activeStreakCount = activeStreakCount;
exports.streakBonusFor = streakBonusFor;
/** Formats epoch ms as YYYY-MM-DD in America/New_York. */
function nyDay(ms) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
}
function dayNumber(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d)
        return 0;
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
/**
 * Advances a user's daily pick streak when a bet is placed at `now`.
 * Placing multiple bets on the same ET calendar day keeps `count` unchanged.
 */
function advanceStreak(current, now) {
    const today = nyDay(now);
    const prevDay = current?.lastDay ?? "";
    const prevCount = Math.max(0, Math.floor(current?.count ?? 0));
    const prevLongest = Math.max(prevCount, Math.floor(current?.longest ?? 0));
    if (prevDay === today && prevCount > 0) {
        return { count: prevCount, longest: prevLongest, lastDay: today };
    }
    const diff = prevDay ? dayNumber(today) - dayNumber(prevDay) : 999;
    const count = diff === 1 && prevCount > 0 ? prevCount + 1 : 1;
    const longest = Math.max(prevLongest, count);
    return { count, longest, lastDay: today };
}
/**
 * Returns the active streak length at `now` (0 if the user missed yesterday
 * and hasn't bet today).
 */
function activeStreakCount(current, now) {
    if (!current?.lastDay || !(current.count && current.count > 0))
        return 0;
    const diff = dayNumber(nyDay(now)) - dayNumber(current.lastDay);
    return diff === 0 || diff === 1 ? Math.floor(current.count) : 0;
}
/**
 * Small streak bonus added to a prize box claim.
 * Capped at 7 days (+35 bronze, +70 silver, +105 gold) so store prices stay
 * out of reach of box openings.
 */
function streakBonusFor(tier, streakDays) {
    if (streakDays < 1)
        return 0;
    const capped = Math.min(streakDays, 7);
    const perDay = tier === "gold" ? 15 : tier === "silver" ? 10 : 5;
    return capped * perDay;
}
//# sourceMappingURL=streak.js.map
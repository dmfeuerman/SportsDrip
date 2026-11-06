"use strict";
/**
 * Daily pick streak tracking in server time (America/New_York).
 *
 * Counts consecutive calendar days with at least one placed bet and computes
 * the small prize-box streak bonus (kept small so store prices stay out of
 * reach of box openings alone).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREAK_MILESTONES = exports.REPAIR_ACTIONS = void 0;
exports.nyDay = nyDay;
exports.dayNumber = dayNumber;
exports.daysBetween = daysBetween;
exports.advanceStreak = advanceStreak;
exports.activeStreakCount = activeStreakCount;
exports.streakBonusFor = streakBonusFor;
exports.REPAIR_ACTIONS = 2;
exports.STREAK_MILESTONES = [7, 30, 100];
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
/** YYYY-MM-DD days strictly between `a` and `b`. */
function daysBetween(a, b) {
    const out = [];
    for (let n = dayNumber(a) + 1; n < dayNumber(b); n++)
        out.push(new Date(n * 86_400_000).toISOString().slice(0, 10));
    return out;
}
/**
 * Advances a user's daily pick streak when a qualifying action happens at `now`.
 * Multiple actions on the same ET day keep `count` unchanged, except while a
 * repair is pending (the second action that day completes it).
 * `emptyDays`: days with no featured game (dailyPick/{day}.empty) — neutral, not missed.
 */
function advanceStreak(current, now, opts = {}) {
    const today = nyDay(now);
    const prevDay = current?.lastDay ?? "";
    const prevCount = Math.max(0, Math.floor(current?.count ?? 0));
    const prevLongest = Math.max(prevCount, Math.floor(current?.longest ?? 0));
    let freezes = Math.max(0, Math.min(1, Math.floor(current?.freezes ?? 0)));
    const repair = current?.repairPending ?? null;
    if (prevDay === today && prevCount > 0) {
        if (repair && repair.day === today) {
            const done = repair.done + 1;
            if (done >= repair.needed) {
                const count = repair.from + 1;
                if (count % 7 === 0)
                    freezes = Math.min(1, freezes + 1);
                return { count, longest: Math.max(prevLongest, count), lastDay: today, freezes, repairPending: null };
            }
            return { count: prevCount, longest: prevLongest, lastDay: today, freezes, repairPending: { ...repair, done } };
        }
        return { count: prevCount, longest: prevLongest, lastDay: today, freezes, repairPending: null };
    }
    const empty = opts.emptyDays;
    const skipped = prevDay && empty ? daysBetween(prevDay, today).filter((d) => empty.has(d)).length : 0;
    const diff = prevDay ? dayNumber(today) - dayNumber(prevDay) - skipped : 999;
    let count;
    let repairPending = null;
    if (diff === 1 && prevCount > 0)
        count = prevCount + 1;
    else if (diff === 2 && prevCount > 0 && freezes > 0) {
        // Forgiving: a banked freeze covers exactly one missed day.
        freezes -= 1;
        count = prevCount + 1;
    }
    else if (diff === 2 && prevCount > 0) {
        // No freeze: start at 1, but a second action today restores the old streak.
        count = 1;
        repairPending = { day: today, needed: exports.REPAIR_ACTIONS, done: 1, from: prevCount };
    }
    else
        count = 1;
    if (count % 7 === 0)
        freezes = Math.min(1, freezes + 1);
    const longest = Math.max(prevLongest, count);
    return { count, longest, lastDay: today, freezes, repairPending };
}
/**
 * Returns the active streak length at `now` (0 if the user missed yesterday
 * and hasn't bet today).
 */
function activeStreakCount(current, now) {
    if (!current?.lastDay || !(current.count && current.count > 0))
        return 0;
    const diff = dayNumber(nyDay(now)) - dayNumber(current.lastDay);
    if (diff === 0 || diff === 1)
        return Math.floor(current.count);
    // Still alive while a freeze can cover the one missed day.
    return diff === 2 && (current.freezes ?? 0) > 0 ? Math.floor(current.count) : 0;
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
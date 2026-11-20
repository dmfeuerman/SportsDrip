"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyMaintenance = void 0;
exports.nyCalendarParts = nyCalendarParts;
exports.runDailyMaintenance = runDailyMaintenance;
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const syncGames_1 = require("./syncGames");
const settleBets_1 = require("./settleBets");
const achievementStats_1 = require("./achievementStats");
const winBack_1 = require("./winBack");
const birthdays_1 = require("./birthdays");
const liveOps_1 = require("./liveOps");
const ladder_1 = require("./ladder");
const weekly_1 = require("./weekly");
const wrapped_1 = require("./wrapped");
const DAY_MS = 86_400_000;
/** Calendar components in America/New_York (weekday: 0=Sun..6=Sat, month: 1..12, day: 1..31). */
function nyCalendarParts(now = Date.now()) {
    const d = new Date(now);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        weekday: "short",
    }).formatToParts(d);
    const num = (t) => Number(parts.find((p) => p.type === t)?.value);
    const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: num("year"),
        month: num("month"),
        day: num("day"),
        weekday: weekdayMap[wdStr] ?? 0,
    };
}
/**
 * Runs all daily, weekly, monthly, and yearly maintenance tasks in one
 * consolidated Cloud Scheduler job instead of 12 separate scheduled functions.
 * Every sub-task is idempotent and isolated so one failure doesn't block the rest.
 */
async function runDailyMaintenance(now = Date.now()) {
    const { year, month, day, weekday } = nyCalendarParts(now);
    const results = { year, month, day, weekday };
    const step = async (name, fn) => {
        try {
            results[name] = await fn();
        }
        catch (err) {
            firebase_functions_1.logger.error(`dailyMaintenance:${name} failed`, { error: String(err) });
            results[name] = { error: String(err) };
        }
    };
    // Daily jobs
    await step("pruneGames", () => (0, syncGames_1.runPruneGames)(now));
    await step("refundStaleBets", () => (0, settleBets_1.runRefundStaleBets)(now));
    await step("achievementStats", () => (0, achievementStats_1.computeAchievementStats)(now).then((r) => r.players));
    await step("winBack", () => (0, winBack_1.sendWinBacks)(now));
    await step("leagueMatchupJobs", () => (0, weekly_1.runLeagueMatchupJobs)(now));
    // Monday jobs (weekly live-ops, survivor sweep, close last week's ladder, open this week's ladder)
    if (weekday === 1) {
        await step("weeklyLiveOps", () => (0, liveOps_1.runLiveOps)(now));
        await step("mondayLeagueJobs", () => (0, weekly_1.runMondayLeagueJobs)(now));
        await step("ladderClose", () => (0, ladder_1.closeLadderWeek)(now - DAY_MS));
        await step("ladderOpen", () => (0, ladder_1.openLadderWeek)(now));
    }
    // Tuesday jobs
    if (weekday === 2) {
        await step("tuesdayLeagueReport", () => (0, weekly_1.runTuesdayLeagueReport)(now));
    }
    // 1st of month jobs
    if (day === 1) {
        await step("birthdayGifts", () => (0, birthdays_1.sendBirthdayGifts)(now));
    }
    // Dec 1 yearly job
    if (month === 12 && day === 1) {
        await step("yearWrapped", () => (0, wrapped_1.runYearWrapped)(year, now));
    }
    firebase_functions_1.logger.info("dailyMaintenance complete", results);
    return results;
}
/** Single consolidated cron replacing 12 low-frequency scheduled functions. */
exports.dailyMaintenance = (0, onlineSchedule_1.onSchedule)({ schedule: "0 9 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
    await runDailyMaintenance();
});
//# sourceMappingURL=maintenance.js.map
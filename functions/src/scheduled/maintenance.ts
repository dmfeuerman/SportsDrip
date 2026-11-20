import { onSchedule } from "../lib/onlineSchedule";
import { logger } from "firebase-functions";
import { runPruneGames } from "./syncGames";
import { runRefundStaleBets } from "./settleBets";
import { computeAchievementStats } from "./achievementStats";
import { sendWinBacks } from "./winBack";
import { sendBirthdayGifts } from "./birthdays";
import { runLiveOps } from "./liveOps";
import { closeLadderWeek, openLadderWeek } from "./ladder";
import { runLeagueMatchupJobs, runMondayLeagueJobs, runTuesdayLeagueReport } from "./weekly";
import { runYearWrapped } from "./wrapped";

const DAY_MS = 86_400_000;

/** Calendar components in America/New_York (weekday: 0=Sun..6=Sat, month: 1..12, day: 1..31). */
export function nyCalendarParts(now = Date.now()): { year: number; month: number; day: number; weekday: number } {
  const d = new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(d);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
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
export async function runDailyMaintenance(now = Date.now()): Promise<Record<string, unknown>> {
  const { year, month, day, weekday } = nyCalendarParts(now);
  const results: Record<string, unknown> = { year, month, day, weekday };

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      results[name] = await fn();
    } catch (err) {
      logger.error(`dailyMaintenance:${name} failed`, { error: String(err) });
      results[name] = { error: String(err) };
    }
  };

  // Daily jobs
  await step("pruneGames", () => runPruneGames(now));
  await step("refundStaleBets", () => runRefundStaleBets(now));
  await step("achievementStats", () => computeAchievementStats(now).then((r) => r.players));
  await step("winBack", () => sendWinBacks(now));
  await step("leagueMatchupJobs", () => runLeagueMatchupJobs(now));

  // Monday jobs (weekly live-ops, survivor sweep, close last week's ladder, open this week's ladder)
  if (weekday === 1) {
    await step("weeklyLiveOps", () => runLiveOps(now));
    await step("mondayLeagueJobs", () => runMondayLeagueJobs(now));
    await step("ladderClose", () => closeLadderWeek(now - DAY_MS));
    await step("ladderOpen", () => openLadderWeek(now));
  }

  // Tuesday jobs
  if (weekday === 2) {
    await step("tuesdayLeagueReport", () => runTuesdayLeagueReport(now));
  }

  // 1st of month jobs
  if (day === 1) {
    await step("birthdayGifts", () => sendBirthdayGifts(now));
  }

  // Dec 1 yearly job
  if (month === 12 && day === 1) {
    await step("yearWrapped", () => runYearWrapped(year, now));
  }

  logger.info("dailyMaintenance complete", results);
  return results;
}

/** Single consolidated cron replacing 12 low-frequency scheduled functions. */
export const dailyMaintenance = onSchedule(
  { schedule: "0 9 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    await runDailyMaintenance();
  }
);

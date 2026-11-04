import type { Sport } from "@/constants/leagueTypes";

/**
 * Sport seasons for "Full Season" leagues. Approximate regular-season start →
 * last game of the playoffs, as [month, day]; an end before the start means
 * the next year. Mirrors functions/src/lib/leagueConfig.ts, which decides the
 * real end date — this copy only drives the create screen.
 */
export const SEASONS: Record<Sport, { start: [number, number]; end: [number, number]; finale: string }> = {
  NFL: { start: [9, 4], end: [2, 10], finale: "Super Bowl" },
  NCAAF: { start: [8, 23], end: [1, 21], finale: "CFP title game" },
  NBA: { start: [10, 21], end: [6, 22], finale: "NBA Finals" },
  NCAAB: { start: [11, 3], end: [4, 8], finale: "Final Four" },
  NHL: { start: [10, 7], end: [6, 24], finale: "Stanley Cup Final" },
  MLB: { start: [3, 26], end: [11, 4], finale: "World Series" },
  Soccer: { start: [8, 15], end: [5, 31], finale: "end of the European season" },
};

const DAY = 86_400_000;
export const MIN_SEASON_DAYS = 28;
export const MAX_SEASON_DAYS = 500;

export interface SportSeason {
  sport: Sport;
  start: number;
  end: number;
  /** In progress now (vs. the next season, because this one is over half done or hasn't started). */
  current: boolean;
  /** "2026–27" or "2026". */
  label: string;
  finale: string;
}

/** The season a league created now covers for one sport: this one if at least half is left, else the next. */
export function sportSeason(sport: Sport, now: number): SportSeason {
  const w = SEASONS[sport];
  const year = new Date(now).getUTCFullYear();
  const at = (y: number, [m, d]: [number, number]) => Date.UTC(y, m - 1, d, 23, 59);
  const spans = [year - 1, year, year + 1].map((y) => {
    const wraps = w.end[0] < w.start[0] || (w.end[0] === w.start[0] && w.end[1] < w.start[1]);
    return { y, wraps, start: at(y, w.start), end: at(wraps ? y + 1 : y, w.end) };
  });
  let i = spans.findIndex((s) => s.end > now);
  const cur = spans[i]!;
  if (now > cur.start && cur.end - now < (cur.end - cur.start) / 2 && spans[i + 1]) i += 1;
  const s = spans[i]!;
  return {
    sport,
    start: s.start,
    end: s.end,
    current: now >= s.start,
    label: s.wraps ? `${s.y}–${String(s.y + 1).slice(2)}` : String(s.y),
    finale: w.finale,
  };
}

/** Each sport's season plus the league end (the latest of them, within limits). */
export function fullSeasonPlan(sports: Sport[], now: number) {
  const seasons = sports.map((s) => sportSeason(s, now)).sort((a, b) => a.end - b.end);
  const latest = seasons[seasons.length - 1];
  const end = Math.min(Math.max(latest?.end ?? 0, now + MIN_SEASON_DAYS * DAY), now + MAX_SEASON_DAYS * DAY);
  return { seasons, end, days: Math.ceil((end - now) / DAY), decidedBy: latest ?? null };
}

/** League end for any duration choice. */
export function leagueEndFor(duration: string, days: number | undefined, sports: Sport[], now: number): number {
  return duration === "Full Season" ? fullSeasonPlan(sports, now).end : now + (days ?? 28) * DAY;
}

export const fmtDate = (ms: number, withYear = true) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });

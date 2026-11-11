/**
 * The slice of functions/src/lib/sportsProvider.ts that the on-device insights
 * parser needs. Keep PATHS and toStatus in step with the server file (a
 * functions test checks the paths).
 */
import type { GameStatus, Sport } from "@/types/game";

export type { GameStatus, Sport };

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

const PATHS: Array<[Sport, string]> = [
  ["NFL", "football/nfl"],
  ["NBA", "basketball/nba"],
  ["MLB", "baseball/mlb"],
  ["NHL", "hockey/nhl"],
  ["NCAAF", "football/college-football"],
  ["NCAAB", "basketball/mens-college-basketball"],
  ["Soccer", "soccer/eng.1"],
  ["Soccer", "soccer/esp.1"],
  ["Soccer", "soccer/ita.1"],
  ["Soccer", "soccer/ger.1"],
  ["Soccer", "soccer/fra.1"],
  ["Soccer", "soccer/uefa.champions"],
  ["Soccer", "soccer/usa.1"],
];

/** Every provider path a sport can come from. Soccer spans several leagues. */
export function providerPathsFor(sport: Sport): string[] {
  return PATHS.filter(([s]) => s === sport).map(([, p]) => p);
}

export function toStatus(name: string): GameStatus {
  if (
    name === "STATUS_IN_PROGRESS" ||
    name === "STATUS_HALFTIME" ||
    name === "STATUS_END_PERIOD" ||
    name === "STATUS_FIRST_HALF" ||
    name === "STATUS_SECOND_HALF"
  ) {
    return "live";
  }
  if (name === "STATUS_FINAL" || name === "STATUS_FULL_TIME" || name === "STATUS_FINAL_PEN") {
    return "final";
  }
  return "upcoming";
}

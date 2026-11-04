import { isPriced, type Game, type Side } from "@/types/game";

/**
 * Shared client-side helpers for Moneyline ("ml"), Point Spread ("spread"),
 * and Game Total ("total") markets, plus week-key calculation and live
 * ahead/behind grading.
 */

export type Market = "ml" | "spread" | "total";
export type Selection = "home" | "away" | "over" | "under";

export const SPREAD_TOTAL_ODDS = 1.91;

export interface MarketOption {
  market: Market;
  selection: Selection;
  side: Side | null;
  line: number | null;
  odds: number | null;
  /** Short chip text: "DET -3.5", "O 45.5", "DET". */
  label: string;
  /** Full sentence for BetModal header: "Detroit Lions -3.5", "Over 45.5 pts". */
  pickTitle: string;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
}

export function formatSpread(line: number | null | undefined): string {
  if (typeof line !== "number" || !Number.isFinite(line)) return "—";
  const clean = Object.is(line, -0) ? 0 : line;
  return clean > 0 ? `+${clean}` : `${clean}`;
}

export function hasSpreadLine(game: Pick<Game, "line" | "disrupted">): boolean {
  if (game.disrupted) return false;
  const sh = game.line?.spreadHome;
  return typeof sh === "number" && Number.isFinite(sh);
}

export function hasTotalLine(game: Pick<Game, "line" | "disrupted">): boolean {
  if (game.disrupted) return false;
  const ou = game.line?.overUnder;
  return typeof ou === "number" && Number.isFinite(ou) && ou > 0;
}

export function quoteMarket(game: Game, market: Market, selection: Selection): MarketOption {
  const home = game.homeTeam;
  const away = game.awayTeam;

  if (market === "spread") {
    const side: Side = selection === "away" ? "away" : "home";
    const team = side === "home" ? home : away;
    const opp = side === "home" ? away : home;
    const sh = game.line?.spreadHome;
    const hasLine = typeof sh === "number" && Number.isFinite(sh) && !game.disrupted;
    const rawLine = hasLine ? (side === "home" ? sh : -sh) : null;
    const line = rawLine !== null && Object.is(rawLine, -0) ? 0 : rawLine;
    const spreadText = line !== null ? formatSpread(line) : "";
    const label = line !== null ? `${team.abbreviation} ${spreadText}` : team.abbreviation;
    return {
      market: "spread",
      selection: side,
      side,
      line,
      odds: hasLine ? SPREAD_TOTAL_ODDS : null,
      label,
      pickTitle: line !== null ? `${team.name} ${spreadText}` : `${team.name} spread`,
      teamName: team.name,
      teamAbbr: team.abbreviation,
      teamColor: team.color,
      opponentAbbr: opp.abbreviation,
    };
  }

  if (market === "total") {
    const ou = game.line?.overUnder;
    const hasLine = typeof ou === "number" && Number.isFinite(ou) && ou > 0 && !game.disrupted;
    const line = hasLine ? ou : null;
    const dir = selection === "under" ? "Under" : "Over";
    const shortDir = selection === "under" ? "U" : "O";
    const label = line !== null ? `${dir} ${line}` : dir;
    return {
      market: "total",
      selection: selection === "under" ? "under" : "over",
      side: null,
      line,
      odds: hasLine ? SPREAD_TOTAL_ODDS : null,
      label,
      pickTitle: line !== null ? `${dir} ${line} total points` : `${dir} total points`,
      teamName: `${away.abbreviation} @ ${home.abbreviation} ${label}`,
      teamAbbr: line !== null ? `${shortDir} ${line}` : shortDir,
      teamColor: selection === "under" ? away.color : home.color,
      opponentAbbr: `${away.abbreviation}@${home.abbreviation}`,
    };
  }

  // Default moneyline
  const side: Side = selection === "away" ? "away" : "home";
  const team = side === "home" ? home : away;
  const opp = side === "home" ? away : home;
  const priced = isPriced(game) && !game.disrupted;
  return {
    market: "ml",
    selection: side,
    side,
    line: null,
    odds: priced ? team.odds : null,
    label: team.abbreviation,
    pickTitle: `${team.name} to win`,
    teamName: team.name,
    teamAbbr: team.abbreviation,
    teamColor: team.color,
    opponentAbbr: opp.abbreviation,
  };
}

/**
 * Evaluates whether a bet is currently ahead, behind, or level on a live game.
 */
export function liveBetPosition(
  game: Pick<Game, "status" | "homeScore" | "awayScore">,
  bet: {
    side?: Side | null;
    market?: Market;
    selection?: Selection;
    line?: number | null;
  }
): "ahead" | "behind" | "level" | null {
  if (game.status !== "live" || game.homeScore === null || game.awayScore === null) return null;
  const market = bet.market ?? "ml";
  const selection = bet.selection ?? bet.side ?? "home";

  if (market === "spread" && typeof bet.line === "number") {
    const picked = (selection === "home" ? game.homeScore : game.awayScore) + bet.line;
    const other = selection === "home" ? game.awayScore : game.homeScore;
    if (Math.abs(picked - other) < 1e-9) return "level";
    return picked > other ? "ahead" : "behind";
  }

  if (market === "total" && typeof bet.line === "number") {
    const total = game.homeScore + game.awayScore;
    if (Math.abs(total - bet.line) < 1e-9) return "level";
    if (selection === "over") return total > bet.line ? "ahead" : "behind";
    return total < bet.line ? "ahead" : "behind";
  }

  if (game.homeScore === game.awayScore) return "level";
  const homeAhead = game.homeScore > game.awayScore;
  return (selection === "home") === homeAhead ? "ahead" : "behind";
}

/** Monday YYYY-MM-DD in America/New_York, matching functions/src/lib/weekly.ts. */
export function weekKey(ms = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = Number(parts.find((p) => p.type === "year")?.value ?? 1970);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const d = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

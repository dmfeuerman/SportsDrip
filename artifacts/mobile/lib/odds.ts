import type { Game, Side } from "@/types/game";

/**
 * Odds maths, in one place.
 *
 * Everything here is pure and takes decimal odds, which is what the provider
 * writes and what the server settles on.
 */

export const NO_LINE = "No line yet";

export type OddsFormat = "decimal" | "american";

/** Raw implied probability, vig included. 2.00 -> 0.50. Null (no line) -> 0. */
export function impliedProbability(decimalOdds: number | null | undefined): number {
  if (typeof decimalOdds !== "number" || !Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

/** "2.31x", or "—" when there is no line. */
export function formatDecimal(decimalOdds: number | null | undefined): string {
  return typeof decimalOdds === "number" && Number.isFinite(decimalOdds) && decimalOdds > 1 ? `${decimalOdds.toFixed(2)}x` : "—";
}

/**
 * Two-way market with the margin removed, so the pair sums to 100%.
 */
export function fairProbabilities(homeOdds: number | null | undefined, awayOdds: number | null | undefined): { home: number; away: number } {
  const h = impliedProbability(homeOdds);
  const a = impliedProbability(awayOdds);
  const total = h + a;
  if (total <= 0) return { home: 0.5, away: 0.5 };
  return { home: h / total, away: a / total };
}

/** The book's cut, as a percentage. Worth surfacing — it's the user's cost. */
export function margin(homeOdds: number | null | undefined, awayOdds: number | null | undefined): number {
  const h = impliedProbability(homeOdds);
  const a = impliedProbability(awayOdds);
  if (!h || !a) return 0;
  return Math.max(0, h + a - 1);
}

export function payout(stake: number, decimalOdds: number): number {
  return Math.round(stake * decimalOdds);
}

export function profit(stake: number, decimalOdds: number): number {
  return payout(stake, decimalOdds) - stake;
}

/** Decimal to American, for people who read lines that way. */
export function toAmerican(decimalOdds: number | null | undefined): string {
  if (typeof decimalOdds !== "number" || !Number.isFinite(decimalOdds) || decimalOdds <= 1) return "—";
  const value = decimalOdds >= 2 ? (decimalOdds - 1) * 100 : -100 / (decimalOdds - 1);
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** The user's chosen format (lib/settings.ts): "2.31x" by default, "+131" for sportsbook regulars. */
export function formatOdds(decimalOdds: number | null | undefined, format: OddsFormat = "decimal"): string {
  return format === "american" ? toAmerican(decimalOdds) : formatDecimal(decimalOdds);
}

export function formatPercent(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function sidePrice(game: Game, side: Side): number | null {
  return side === "home" ? game.homeTeam.odds : game.awayTeam.odds;
}

/** "the favourite", for copy that needs to name one. */
export function favourite(game: Game): Side | null {
  const h = game.homeTeam.odds;
  const a = game.awayTeam.odds;
  if (typeof h !== "number" || typeof a !== "number" || !Number.isFinite(h) || !Number.isFinite(a) || h === a) return null;
  return h < a ? "home" : "away";
}

export function team(game: Game, side: Side) {
  return side === "home" ? game.homeTeam : game.awayTeam;
}

export function score(game: Game, side: Side): number | null {
  return side === "home" ? game.homeScore : game.awayScore;
}

/**
 * Where a pending bet stands right now: ahead, behind, or level. Used to give
 * an open ticket a live state instead of a static "OPEN" pill.
 */
export function livePosition(
  game: Game,
  sideOrBet:
    | Side
    | null
    | undefined
    | { side?: Side | null; market?: "ml" | "spread" | "total"; selection?: "home" | "away" | "over" | "under"; line?: number | null }
): "ahead" | "behind" | "level" | null {
  if (game.status === "upcoming" || !sideOrBet) return null;
  if (typeof sideOrBet === "object") {
    if (game.homeScore === null || game.awayScore === null) return null;
    const market = sideOrBet.market ?? "ml";
    const sel = sideOrBet.selection ?? sideOrBet.side ?? "home";
    if (market === "spread" && typeof sideOrBet.line === "number") {
      const picked = (sel === "home" ? game.homeScore : game.awayScore) + sideOrBet.line;
      const other = sel === "home" ? game.awayScore : game.homeScore;
      if (Math.abs(picked - other) < 1e-9) return "level";
      return picked > other ? "ahead" : "behind";
    }
    if (market === "total" && typeof sideOrBet.line === "number") {
      const total = game.homeScore + game.awayScore;
      if (Math.abs(total - sideOrBet.line) < 1e-9) return "level";
      return sel === "over" ? (total > sideOrBet.line ? "ahead" : "behind") : (total < sideOrBet.line ? "ahead" : "behind");
    }
    const side: Side = sel === "away" ? "away" : "home";
    const mine = score(game, side);
    const theirs = score(game, side === "home" ? "away" : "home");
    if (mine === null || theirs === null) return null;
    if (mine === theirs) return "level";
    return mine > theirs ? "ahead" : "behind";
  }
  const mine = score(game, sideOrBet);
  const theirs = score(game, sideOrBet === "home" ? "away" : "home");
  if (mine === null || theirs === null) return null;
  if (mine === theirs) return "level";
  return mine > theirs ? "ahead" : "behind";
}

/** "in 2h 15m", "in 12m", "now". Countdown copy that doesn't need a timer above an hour. */
export function untilKickoff(startsAt: number, now = Date.now()): string {
  const ms = startsAt - now;
  if (ms <= 0) return "now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.round(hours / 24)}d`;
}

/**
 * "Today 7:30 PM", "Tomorrow 1:00 PM", "Sat 3:00 PM", "Nov 2 8:15 PM" in the
 * device's time zone.
 */
export function kickoffLabel(startsAt: number, now = Date.now()): string {
  const d = new Date(startsAt);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

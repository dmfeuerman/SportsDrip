import type { Game, Side } from "@/types/game";

/**
 * Odds maths, in one place.
 *
 * Three screens currently do their own arithmetic on `odds`: the card shows
 * `2.15x`, the bet sheet multiplies for the payout, the ticket list multiplies
 * again for the return. That's fine until you want to show a probability, and
 * then it's three places to get vig removal wrong.
 *
 * Everything here is pure and takes decimal odds, which is what the provider
 * writes and what the server settles on.
 */

/** Raw implied probability, vig included. 2.00 -> 0.50. */
export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

/**
 * Two-way market with the margin removed, so the pair sums to 100%.
 *
 * Showing the raw numbers is what most apps do and it's quietly wrong: on a
 * typical line they add to about 105%, so both teams look likelier than they
 * are, and the favourite's edge reads smaller than it is.
 */
export function fairProbabilities(homeOdds: number, awayOdds: number): { home: number; away: number } {
  const h = impliedProbability(homeOdds);
  const a = impliedProbability(awayOdds);
  const total = h + a;
  if (total <= 0) return { home: 0.5, away: 0.5 };
  return { home: h / total, away: a / total };
}

/** The book's cut, as a percentage. Worth surfacing — it's the user's cost. */
export function margin(homeOdds: number, awayOdds: number): number {
  const total = impliedProbability(homeOdds) + impliedProbability(awayOdds);
  return Math.max(0, total - 1);
}

export function payout(stake: number, decimalOdds: number): number {
  return Math.round(stake * decimalOdds);
}

export function profit(stake: number, decimalOdds: number): number {
  return payout(stake, decimalOdds) - stake;
}

/** Decimal to American, for people who read lines that way. */
export function toAmerican(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return "—";
  const value = decimalOdds >= 2 ? (decimalOdds - 1) * 100 : -100 / (decimalOdds - 1);
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function formatPercent(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/** "the favourite", for copy that needs to name one. */
export function favourite(game: Game): Side | null {
  const h = game.homeTeam.odds;
  const a = game.awayTeam.odds;
  if (!Number.isFinite(h) || !Number.isFinite(a) || h === a) return null;
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
export function livePosition(game: Game, side: Side): "ahead" | "behind" | "level" | null {
  if (game.status === "upcoming") return null;
  const mine = score(game, side);
  const theirs = score(game, side === "home" ? "away" : "home");
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

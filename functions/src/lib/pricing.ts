import { HttpsError } from "firebase-functions/v2/https";
import type { Market, Selection } from "./settlement";

/**
 * The single gate between a cached game document and a bet. Both wallets
 * (placeBet and placeLeagueBet) price through here, so "is this game
 * bettable, and at what price?" has one answer.
 */

export type Side = "home" | "away";

export interface PricedTeam {
  name: string;
  abbreviation: string;
  color: string;
  odds: number;
}

export interface PricedMarketSelection {
  market: Market;
  selection: Selection;
  side: Side | null;
  line: number | null;
  odds: number;
  label: string;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
}

export const NO_LINE_MESSAGE = "No line yet for this game. Check back closer to kickoff.";

/** Standard -110 juice in decimal for spread and total markets when ESPN omits price juice. */
export const SPREAD_TOTAL_ODDS = 1.91;

/** Drift against the bettor larger than this fails loudly instead of shrinking the payout. */
export const MAX_ADVERSE_DRIFT = 0.05;

/** Maximum spread or total points a line may move from expectedLine before freezing/rejecting. */
export const MAX_LINE_DRIFT = 0.5;

/** Within 30 minutes of kickoff, reject bets if an explicit updatedAt timestamp is stale (> 2 min). */
export const NEAR_KICKOFF_WINDOW_MS = 30 * 60_000;
export const MAX_NEAR_KICKOFF_STALE_MS = 2 * 60_000;

interface GameDoc {
  get(field: string): unknown;
}

function validOdds(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 1;
}

export function formatSpreadNumber(line: number): string {
  const clean = Object.is(line, -0) ? 0 : line;
  return clean > 0 ? `+${clean}` : `${clean}`;
}

export function assertGameNotDisruptedAndFresh(game: GameDoc, now = Date.now()): void {
  const disrupted = game.get("disrupted") as string | null | undefined;
  if (disrupted === "postponed" || disrupted === "canceled") {
    throw new HttpsError("failed-precondition", `This game is ${disrupted} — betting is closed.`);
  }
  if (game.get("expired") === true) {
    throw new HttpsError("failed-precondition", "Betting is closed for this game.");
  }
  const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
  const updatedAt = game.get("updatedAt") as number | undefined;
  if (
    typeof updatedAt === "number" &&
    startsAt > now &&
    startsAt - now <= NEAR_KICKOFF_WINDOW_MS &&
    now - updatedAt > MAX_NEAR_KICKOFF_STALE_MS
  ) {
    throw new HttpsError("aborted", "Odds are refreshing before kickoff. Try again in a moment.");
  }
}

/**
 * The picked side and its opponent, or a `failed-precondition` when the feed
 * had no moneyline. `priced` must be explicitly true: documents written by the
 * old sync (hash-priced) have no flag and are refused until the next sync
 * rewrites them.
 */
export function requirePricedSide(game: GameDoc, side: Side): { team: PricedTeam; opponent: { abbreviation: string; name: string } } {
  assertGameNotDisruptedAndFresh(game);
  const team = game.get(side === "home" ? "homeTeam" : "awayTeam") as Partial<PricedTeam> | undefined;
  const opponent = game.get(side === "home" ? "awayTeam" : "homeTeam") as { abbreviation?: string; name?: string } | undefined;
  if (game.get("priced") !== true || !team || !validOdds(team.odds)) {
    throw new HttpsError("failed-precondition", NO_LINE_MESSAGE);
  }
  return {
    team: {
      name: team.name ?? side,
      abbreviation: team.abbreviation ?? side.toUpperCase(),
      color: team.color ?? "#4A90D9",
      odds: team.odds,
    },
    opponent: { abbreviation: opponent?.abbreviation ?? "TBD", name: opponent?.name ?? "Opponent" },
  };
}

/**
 * Prices track a real moneyline, so they move between syncs. Drift in the
 * user's favour applies silently; drift against them past MAX_ADVERSE_DRIFT
 * is an `aborted` the client can retry at the new price.
 */
export function assertNoAdverseDrift(odds: number, expectedOdds: number | undefined): void {
  if (expectedOdds && odds < expectedOdds * (1 - MAX_ADVERSE_DRIFT)) {
    throw new HttpsError("aborted", `The price moved to ${odds.toFixed(2)}x before this went through. Tap again to take it.`);
  }
}

/**
 * Line freeze guard for spread and total markets: rejects when the current line
 * moved by more than 0.5 points from `expectedLine`.
 */
export function assertNoLineDrift(currentLine: number, expectedLine: number | undefined): void {
  if (expectedLine !== undefined && Math.abs(currentLine - expectedLine) > MAX_LINE_DRIFT) {
    throw new HttpsError(
      "aborted",
      `The line moved from ${expectedLine} to ${currentLine} before this went through. Tap again to take the new number.`
    );
  }
}

/**
 * Resolves and validates any of the three markets ("ml" | "spread" | "total").
 * Backwards-compatible with callers that pass `{ side: "home" | "away" }` only.
 */
export function requirePricedMarket(
  game: GameDoc,
  input: {
    market?: Market;
    selection?: Selection;
    side?: Side;
    expectedOdds?: number;
    expectedLine?: number;
  }
): PricedMarketSelection {
  assertGameNotDisruptedAndFresh(game);

  const market: Market = input.market ?? "ml";
  const selection: Selection | undefined = input.selection ?? input.side;
  if (!selection) {
    throw new HttpsError("invalid-argument", "Pick a side or total selection.");
  }

  const home = (game.get("homeTeam") as Partial<PricedTeam> | undefined) ?? {};
  const away = (game.get("awayTeam") as Partial<PricedTeam> | undefined) ?? {};
  const homeAbbr = home.abbreviation ?? "HOME";
  const awayAbbr = away.abbreviation ?? "AWAY";

  if (market === "ml") {
    if (selection !== "home" && selection !== "away") {
      throw new HttpsError("invalid-argument", "Moneyline bets must pick home or away.");
    }
    const { team, opponent } = requirePricedSide(game, selection);
    assertNoAdverseDrift(team.odds, input.expectedOdds);
    return {
      market: "ml",
      selection,
      side: selection,
      line: null,
      odds: team.odds,
      label: team.abbreviation,
      teamName: team.name,
      teamAbbr: team.abbreviation,
      teamColor: team.color,
      opponentAbbr: opponent.abbreviation,
    };
  }

  if (market === "spread") {
    if (selection !== "home" && selection !== "away") {
      throw new HttpsError("invalid-argument", "Spread bets must pick home or away.");
    }
    const lineObj = game.get("line") as { spreadHome?: number | null } | null | undefined;
    const spreadHome = lineObj?.spreadHome;
    if (typeof spreadHome !== "number" || !Number.isFinite(spreadHome)) {
      throw new HttpsError("failed-precondition", "No spread line yet for this game.");
    }
    const rawLine = selection === "home" ? spreadHome : -spreadHome;
    const line = Object.is(rawLine, -0) ? 0 : rawLine;
    assertNoLineDrift(line, input.expectedLine);
    assertNoAdverseDrift(SPREAD_TOTAL_ODDS, input.expectedOdds);

    const picked = selection === "home" ? home : away;
    const opp = selection === "home" ? away : home;
    const abbr = picked.abbreviation ?? selection.toUpperCase();
    const label = `${abbr} ${formatSpreadNumber(line)}`;
    return {
      market: "spread",
      selection,
      side: selection,
      line,
      odds: SPREAD_TOTAL_ODDS,
      label,
      teamName: picked.name ?? abbr,
      teamAbbr: abbr,
      teamColor: picked.color ?? "#4A90D9",
      opponentAbbr: opp.abbreviation ?? "OPP",
    };
  }

  // market === "total"
  if (selection !== "over" && selection !== "under") {
    throw new HttpsError("invalid-argument", "Total bets must pick over or under.");
  }
  const lineObj = game.get("line") as { overUnder?: number | null } | null | undefined;
  const overUnder = lineObj?.overUnder;
  if (typeof overUnder !== "number" || !Number.isFinite(overUnder) || overUnder <= 0) {
    throw new HttpsError("failed-precondition", "No total line yet for this game.");
  }
  assertNoLineDrift(overUnder, input.expectedLine);
  assertNoAdverseDrift(SPREAD_TOTAL_ODDS, input.expectedOdds);

  const prefix = selection === "over" ? "Over" : "Under";
  const label = `${prefix} ${overUnder}`;
  return {
    market: "total",
    selection,
    side: null,
    line: overUnder,
    odds: SPREAD_TOTAL_ODDS,
    label,
    teamName: `${awayAbbr} @ ${homeAbbr} ${label}`,
    teamAbbr: `${selection === "over" ? "O" : "U"} ${overUnder}`,
    teamColor: selection === "over" ? (home.color ?? "#43C67F") : (away.color ?? "#5AA9E6"),
    opponentAbbr: `${awayAbbr}@${homeAbbr}`,
  };
}

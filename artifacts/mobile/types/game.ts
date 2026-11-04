/**
 * Shape of games/{gameId} as written by the syncGames scheduled function.
 *
 * Everything added in this revision is optional. Documents written by the
 * previous version of syncGames still parse, and a card renders the same as
 * before until the enriched sync has run at least once — no migration, no
 * empty-state flash.
 */
export type Sport = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";
export type GameStatus = "upcoming" | "live" | "final";
export type Side = "home" | "away";

export interface TeamSide {
  name: string;
  abbreviation: string;
  color: string;
  /** Decimal moneyline. Null when the feed has no line (see `priced`). */
  odds: number | null;

  /** Secondary/alternate kit colour, for two-tone team chips. */
  altColor?: string | null;
  logoUrl?: string | null;
  /** "Detroit" — the city half, so a card can show city over nickname. */
  location?: string | null;
  /** "9-3" overall. */
  record?: string | null;
  /** "5-1 Home" or "4-2 Away", whichever applies to this fixture. */
  splitRecord?: string | null;
  /** Poll or conference rank where the sport has one. */
  rank?: number | null;
  /** Most recent results, newest first: ["W","W","L","W","L"]. */
  form?: Array<"W" | "L" | "D"> | null;
  /** Season points/runs scored and allowed per game, when the provider has it. */
  pointsFor?: number | null;
  pointsAgainst?: number | null;
}

/** Live state from the scoreboard. Football fills the first three, baseball the rest. */
export interface LiveSituation {
  downDistance: string | null;
  possession: Side | null;
  redZone: boolean;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
}

export interface GameLine {
  /** "DET -3.5" exactly as the book words it. */
  spread?: string | null;
  /** Numeric spread from the home team's perspective. */
  spreadHome?: number | null;
  overUnder?: number | null;
  /** Book the line came from, so the number is attributable. */
  provider?: string | null;
}

export interface Game {
  id: string;
  sport: Sport;
  sportIcon: string;
  status: GameStatus;
  startsAt: number;
  startTimeLabel: string;
  /** Set by the server when the provider stopped reporting a game that never finished. */
  expired?: boolean;
  /** Postponed or cancelled by the league: never bettable, open bets are voided. */
  disrupted?: "postponed" | "canceled" | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: TeamSide;
  awayTeam: TeamSide;
  /** True only when the feed carried a real moneyline. The server refuses bets otherwise. */
  priced?: boolean;
  /** Book the moneyline came from. */
  oddsProvider?: string | null;
  updatedAt: number;

  /** "Q3 · 4:12", "Top 7", "78'". Present while live. */
  period?: number | null;
  clock?: string | null;
  /** Seconds left in the period (elapsed for soccer) while live. */
  clockSec?: number | null;
  /** Provider's own one-liner: "Bottom 9th, 2 out". */
  situation?: string | null;
  lastPlay?: string | null;

  venue?: string | null;
  city?: string | null;
  neutralSite?: boolean | null;
  /** "ESPN", "Sky Sports" — the answer to "can I actually watch this?". */
  broadcast?: string | null;
  /** Competition or round: "Week 12", "Matchday 14", "Conference Semifinal". */
  seasonLabel?: string | null;
  line?: GameLine | null;
  /** Points per period, once the game has started. */
  linescore?: { home: Array<number | null>; away: Array<number | null> } | null;
  live?: LiveSituation | null;
  providerPath?: string;
}

export const SPORTS: Sport[] = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"];

const validOdds = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 1;

/** Mirrors the server gate (functions/src/lib/pricing.ts): explicit flag and both prices present. */
export function isPriced(game: Pick<Game, "priced" | "homeTeam" | "awayTeam" | "disrupted">): boolean {
  if (game.disrupted) return false;
  return game.priced === true && validOdds(game.homeTeam.odds) && validOdds(game.awayTeam.odds);
}

/** The price for one side, or null when the game has no line. */
export function sideOdds(game: Pick<Game, "priced" | "homeTeam" | "awayTeam" | "disrupted">, side: Side): number | null {
  if (!isPriced(game)) return null;
  return side === "home" ? game.homeTeam.odds : game.awayTeam.odds;
}

/** Games whose start time has passed but which the provider still calls upcoming. */
export function isStale(game: Game, now = Date.now()): boolean {
  return game.status === "upcoming" && game.startsAt > 0 && game.startsAt < now - 15 * 60_000;
}

/**
 * SportDrip model line: our own moneyline for games the feed hasn't priced.
 *
 * One shared rating per team per sport, stored at ratings/{sport} and updated
 * server-side as results come in, so every user sees the same price.
 *
 *  1. Elo. Every final result moves both teams (margin-of-victory weighted,
 *     autocorrelation-damped, FiveThirtyEight style), with a per-sport home
 *     edge that is switched off at neutral sites.
 *  2. Record prior. Early in a season, or for a team we have few results for,
 *     the feed's own season record and points for/against stand in: smoothed
 *     win% blended with a Pythagorean expectation, converted to the Elo scale
 *     and shrunk toward average by sample size.
 *  3. Price. Win probability from the blended ratings, a flat house margin a
 *     little wider than the book-derived one (the model is less sharp), then
 *     the same odds bounds the book prices use.
 *
 * A bet always keeps the price it was placed at; a re-price only affects new
 * bets. Book lines always win: as soon as the feed carries a moneyline, the
 * model price is replaced.
 */

export type ModelSport = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";

export const MODEL_VERSION = "elo-v1";
export const BASE_ELO = 1500;
/** House margin on model prices (book-derived prices use 4.5%). */
export const MODEL_OVERROUND = 0.06;
const MIN_ODDS = 1.15;
const MAX_ODDS = 6.0;

interface SportParams {
  /** Elo K-factor. */
  k: number;
  /** Home edge in Elo points. */
  hfa: number;
  /** Pythagorean exponent for points for/against. */
  pyth: number;
  /** Games of record before it carries half its weight (shrink toward average). */
  shrink: number;
  /** Elo results before the Elo rating fully replaces the record prior. */
  eloFull: number;
}

export const SPORT_PARAMS: Record<ModelSport, SportParams> = {
  NFL: { k: 20, hfa: 48, pyth: 2.37, shrink: 4, eloFull: 8 },
  NCAAF: { k: 25, hfa: 55, pyth: 2.37, shrink: 4, eloFull: 8 },
  NBA: { k: 20, hfa: 70, pyth: 14, shrink: 10, eloFull: 20 },
  NCAAB: { k: 20, hfa: 80, pyth: 11.5, shrink: 8, eloFull: 15 },
  MLB: { k: 4, hfa: 24, pyth: 1.83, shrink: 20, eloFull: 40 },
  NHL: { k: 6, hfa: 33, pyth: 2.05, shrink: 15, eloFull: 30 },
  Soccer: { k: 20, hfa: 60, pyth: 1.3, shrink: 8, eloFull: 15 },
};

export interface TeamRating {
  elo: number;
  /** Results folded into `elo`. */
  games: number;
  updatedAt: number;
}

export interface RecordInput {
  /** "9-3", "9-3-1", "12-5-4" (soccer W-D-L is not used by ESPN here; ties are the third number). */
  record?: string | null;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
}

const clampOdds = (n: number) => Math.round(Math.min(MAX_ODDS, Math.max(MIN_ODDS, n)) * 100) / 100;
const probToElo = (p: number) => 400 * Math.log10(p / (1 - p));

export function parseRecord(record: string | null | undefined): { w: number; l: number; t: number } | null {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec((record ?? "").trim());
  if (!m) return null;
  return { w: Number(m[1]), l: Number(m[2]), t: Number(m[3] ?? 0) };
}

/** Elo-scale rating implied by a season record (and scoring, when the feed has it). */
export function recordRating(sport: ModelSport, input: RecordInput): { rating: number; games: number } | null {
  const r = parseRecord(input.record);
  if (!r) return null;
  const n = r.w + r.l + r.t;
  if (n === 0) return { rating: BASE_ELO, games: 0 };
  const P = SPORT_PARAMS[sport];
  // Laplace-smoothed win%, so 1-0 isn't "perfect".
  let p = (r.w + 0.5 * r.t + 2) / (n + 4);
  const pf = input.pointsFor ?? null;
  const pa = input.pointsAgainst ?? null;
  if (pf && pa && pf > 0 && pa > 0) {
    const pyth = pf ** P.pyth / (pf ** P.pyth + pa ** P.pyth);
    p = 0.5 * p + 0.5 * pyth;
  }
  p = Math.min(0.97, Math.max(0.03, p));
  const shrink = n / (n + P.shrink);
  return { rating: BASE_ELO + probToElo(p) * shrink, games: n };
}

/** The rating used to price: Elo once there's enough of it, the record prior before that. */
export function blendedRating(sport: ModelSport, elo: TeamRating | null | undefined, rec: RecordInput): number {
  const prior = recordRating(sport, rec);
  if (!elo || elo.games === 0) return prior?.rating ?? BASE_ELO;
  if (!prior) return elo.elo;
  const w = Math.min(1, elo.games / SPORT_PARAMS[sport].eloFull);
  return w * elo.elo + (1 - w) * prior.rating;
}

/** Home win probability (two-way: in soccer, given it isn't a draw). */
export function homeWinProbability(sport: ModelSport, homeRating: number, awayRating: number, neutral = false): number {
  const diff = homeRating - awayRating + (neutral ? 0 : SPORT_PARAMS[sport].hfa);
  return 1 / (1 + 10 ** (-diff / 400));
}

/** Decimal prices for both sides from a home win probability, with the model margin. */
export function priceFromProbability(pHome: number): { home: number; away: number } {
  const p = Math.min(0.95, Math.max(0.05, pHome));
  const scale = 1 + MODEL_OVERROUND;
  return { home: clampOdds(1 / (p * scale)), away: clampOdds(1 / ((1 - p) * scale)) };
}

/**
 * Elo after one final. `result` is the home side's score: 1 win, 0.5 draw, 0 loss.
 * Margin of victory widens the move (log-scaled), damped when the favourite wins
 * so blowouts by good teams don't snowball.
 */
export function eloUpdate(
  sport: ModelSport,
  home: number,
  away: number,
  homeScore: number,
  awayScore: number,
  neutral = false
): { home: number; away: number; delta: number } {
  const P = SPORT_PARAMS[sport];
  const diff = home - away + (neutral ? 0 : P.hfa);
  const expected = 1 / (1 + 10 ** (-diff / 400));
  const result = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
  const mov = Math.abs(homeScore - awayScore);
  const winnerDiff = result === 1 ? diff : result === 0 ? -diff : 0;
  const mult = result === 0.5 ? 1 : Math.log(mov + 1) * (2.2 / (winnerDiff * 0.001 + 2.2));
  const delta = P.k * Math.max(0.5, mult) * (result - expected);
  return { home: home + delta, away: away - delta, delta };
}

/** Confidence label for the UI: how much data stands behind both sides. */
export function modelConfidence(sport: ModelSport, homeGames: number, awayGames: number): "low" | "medium" | "high" {
  const need = SPORT_PARAMS[sport].shrink;
  const g = Math.min(homeGames, awayGames);
  return g >= need * 2 ? "high" : g >= need / 2 ? "medium" : "low";
}

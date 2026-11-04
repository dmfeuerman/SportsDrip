/** Pure settlement rules, shared by main-wallet and league bets. */

export type Outcome = "won" | "lost" | "push";
export type Market = "ml" | "spread" | "total";
export type Selection = "home" | "away" | "over" | "under";

export interface PickSpec {
  market?: Market | null;
  selection?: Selection | null;
  side?: "home" | "away" | null;
  line?: number | null;
}

/**
 * Settles moneyline, point-spread, and over/under total picks.
 *
 *  - Moneyline: draws are a push (stake back), never scored as an away win (AUDIT B11).
 *  - Spread: `line` is stored from the picked team's perspective (e.g. -3.5 for a
 *    favourite, +3.5 for an underdog). Landing on the exact number is a push.
 *  - Total: compares `homeScore + awayScore` against `line`. Landing on the
 *    exact number is a push.
 */
export function decide(
  pickOrSide: "home" | "away" | PickSpec,
  homeScore: number,
  awayScore: number
): Outcome {
  if (typeof pickOrSide === "string") {
    if (homeScore === awayScore) return "push";
    const homeWon = homeScore > awayScore;
    return (pickOrSide === "home") === homeWon ? "won" : "lost";
  }

  const market: Market = pickOrSide.market ?? "ml";
  const selection: Selection =
    pickOrSide.selection ?? (pickOrSide.side === "away" ? "away" : "home");

  if (market === "spread") {
    const line = typeof pickOrSide.line === "number" && Number.isFinite(pickOrSide.line) ? pickOrSide.line : 0;
    const pickedScore = (selection === "home" ? homeScore : awayScore) + line;
    const oppScore = selection === "home" ? awayScore : homeScore;
    if (Math.abs(pickedScore - oppScore) < 1e-9) return "push";
    return pickedScore > oppScore ? "won" : "lost";
  }

  if (market === "total") {
    const line = typeof pickOrSide.line === "number" && Number.isFinite(pickOrSide.line) ? pickOrSide.line : 0;
    const total = homeScore + awayScore;
    if (Math.abs(total - line) < 1e-9) return "push";
    if (selection === "over") return total > line ? "won" : "lost";
    return total < line ? "won" : "lost";
  }

  // Moneyline default
  if (homeScore === awayScore) return "push";
  const homeWon = homeScore > awayScore;
  return (selection === "home") === homeWon ? "won" : "lost";
}

/** Tokens returned to the bettor at settlement. The stake left at placement. */
export function settlementCredit(outcome: Outcome, stake: number, potentialPayout: number): number {
  if (outcome === "won") return potentialPayout;
  if (outcome === "push") return stake;
  return 0;
}

export function payoutFor(stake: number, odds: number): number {
  return Math.round(stake * odds);
}

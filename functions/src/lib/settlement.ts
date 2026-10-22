/** Pure settlement rules, shared by main-wallet and league bets. */

export type Outcome = "won" | "lost" | "push";

/** Draws are a push (stake back), never scored as an away win (AUDIT B11). */
export function decide(side: "home" | "away", homeScore: number, awayScore: number): Outcome {
  if (homeScore === awayScore) return "push";
  const homeWon = homeScore > awayScore;
  return (side === "home") === homeWon ? "won" : "lost";
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

/**
 * Flash picks: "who scores next?" calls on a live game.
 *
 * The first 3 live picks each day are free (0 stake, +200 credits reward).
 * After those 3 free daily picks are used, players can place unlimited paid
 * live picks using quick-action credit stakes at flat 1.91x (stake deducted
 * up front and refunded on a push; 1 active pick per game at a time).
 */
export const FLASH_FREE_PER_DAY = 3;
export const FLASH_REWARD = 200;
export const FLASH_PAID_ODDS = 1.91;
export const FLASH_MIN_STAKE = 10;
export const FLASH_MAX_STAKE = 5_000;

export type FlashSide = "home" | "away";
export type FlashOutcome = "won" | "lost" | "push";

export interface FlashSnapshot {
  side: FlashSide;
  homeAt: number;
  awayAt: number;
}

/**
 * Grades a pick against the current scoreboard. Null while nothing has
 * happened. Scores are sampled, not play-by-play: if both sides scored
 * between samples the bigger gain takes it, and equal gains push.
 * A game that ends with no further score is a push.
 */
export function decideFlash(pick: FlashSnapshot, home: number | null, away: number | null, status: string): FlashOutcome | null {
  if (home === null || away === null) return status === "final" ? "push" : null;
  const dh = home - pick.homeAt;
  const da = away - pick.awayAt;
  // A corrected (lowered) score voids the pick.
  if (dh < 0 || da < 0) return "push";
  if (dh === 0 && da === 0) return status === "final" ? "push" : null;
  if (dh === da) return "push";
  const scorer: FlashSide = dh > da ? "home" : "away";
  return scorer === pick.side ? "won" : "lost";
}

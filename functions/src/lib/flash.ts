/**
 * Flash picks: free "who scores next?" calls on a live game.
 *
 * No stake, a small fixed reward, hard caps per game and per day. In-play
 * betting is the feature most tied to harm in the gambling research, so this
 * stays free, small and rate-limited by design, and honours play limits.
 */
export const FLASH_REWARD = 200;
export const FLASH_PER_GAME = 3;
export const FLASH_PER_DAY = 12;

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

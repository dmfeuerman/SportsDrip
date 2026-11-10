import { activeStreakCount, nyDay, type StreakState } from "./streak";

/**
 * Streak wager: stake credits that you'll add WAGER_DAYS to your pick streak.
 * Hit it and the stake comes back doubled; let the streak lapse and it's gone.
 * One at a time, small fixed stakes, so it can't become a way to print credits.
 */
export const WAGER_DAYS = 7;
export const WAGER_STAKES = [50, 100, 250] as const;
export const WAGER_MULTIPLIER = 2;

export interface StreakWager {
  stake: number;
  /** Streak length when the wager was placed. */
  startCount: number;
  startDay: string;
  target: number;
}

export type WagerState = "active" | "won" | "lost";

/** Grades a wager against the player's streak at `now`. */
export function evaluateWager(w: StreakWager, streak: Partial<StreakState> | null | undefined, now: number): WagerState {
  const count = Math.floor(streak?.count ?? 0);
  const alive = activeStreakCount(streak, now) > 0;
  if (alive && count >= w.target) return "won";
  // A same-day repair in progress shows a count of 1; it can still be restored today.
  const repairing = streak?.repairPending?.day === nyDay(now);
  if (!alive && !(w.startCount === 0 && w.startDay === nyDay(now))) return "lost";
  if (count < w.startCount && !repairing) return "lost";
  return "active";
}

/** Days banked toward the target (0..WAGER_DAYS). */
export function wagerProgress(w: StreakWager, streak: Partial<StreakState> | null | undefined): number {
  return Math.max(0, Math.min(WAGER_DAYS, Math.floor(streak?.count ?? 0) - w.startCount));
}

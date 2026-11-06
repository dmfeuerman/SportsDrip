import { dayNumber, nyDay } from "./streak";

/**
 * Friend Streak: consecutive ET days on which BOTH friends placed a pick.
 * Stored on friendships/{pairId}.streak. Pure so it can be unit tested.
 */
export interface FriendStreakState {
  count: number;
  longest: number;
  lastDay: string;
}

/**
 * Next state when both friends have acted on `day`, or null when that day was
 * already counted (idempotent across both users' triggers).
 */
export function advanceFriendStreak(
  current: Partial<FriendStreakState> | null | undefined,
  day: string
): FriendStreakState | null {
  const prevDay = current?.lastDay ?? "";
  if (prevDay === day) return null;
  const prevCount = Math.max(0, Math.floor(current?.count ?? 0));
  const longest = Math.max(prevCount, Math.floor(current?.longest ?? 0));
  if (prevDay && dayNumber(prevDay) > dayNumber(day)) return null;
  const count = prevDay && dayNumber(day) - dayNumber(prevDay) === 1 && prevCount > 0 ? prevCount + 1 : 1;
  return { count, longest: Math.max(longest, count), lastDay: day };
}

/** Live length at `now`: alive through the end of the day after the last shared day. */
export function activeFriendStreak(current: Partial<FriendStreakState> | null | undefined, now: number): number {
  if (!current?.lastDay || !current.count) return 0;
  const diff = dayNumber(nyDay(now)) - dayNumber(current.lastDay);
  return diff === 0 || diff === 1 ? Math.floor(current.count) : 0;
}

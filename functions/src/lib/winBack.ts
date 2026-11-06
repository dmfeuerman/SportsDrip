import { dayNumber } from "./streak";

/**
 * Lapsed-player win-back. "Inactive" = no qualifying pick (users.streak.lastDay)
 * for exactly N ET days, N in WIN_BACK_STAGES. Pure for tests.
 */
export const WIN_BACK_STAGES = [3, 7, 14] as const;
export type WinBackStage = (typeof WIN_BACK_STAGES)[number];

export interface WinBackState {
  /** The streak.lastDay this lapse is measured from. */
  lastDay: string;
  stage: number;
  pending: boolean;
  at: number;
  claimedAt?: number | null;
}

/** Stage due today for a user last active on `lastDay`, or null. Each stage fires once per lapse. */
export function dueWinBackStage(lastDay: string | undefined, today: string, prev: Partial<WinBackState> | null | undefined): WinBackStage | null {
  if (!lastDay) return null;
  const diff = dayNumber(today) - dayNumber(lastDay);
  const stage = (WIN_BACK_STAGES as readonly number[]).includes(diff) ? (diff as WinBackStage) : null;
  if (!stage) return null;
  if (prev?.lastDay === lastDay && (prev.stage ?? 0) >= stage) return null;
  return stage;
}

export function winBackCopy(stage: WinBackStage, name: string | undefined): { title: string; body: string } {
  const who = name ? `${name}, ` : "";
  switch (stage) {
    case 3:
      return { title: `${who}your crew's still picking`, body: "Jump back in — a returning-player Prize Box is waiting for you." };
    case 7:
      return { title: "It's been a week 👀", body: "Your Prize Box is on the house. Open the app to claim it." };
    default:
      return { title: "We saved you a box", body: "Two weeks out — come back and grab your returning-player Prize Box." };
  }
}

/** The returning-player box is claimable once the user has a pending win-back. */
export function canClaimWinBack(state: Partial<WinBackState> | null | undefined): boolean {
  return !!state?.pending && !!state.lastDay;
}

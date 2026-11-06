/**
 * Celebration ladder: one table so intensity scales consistently across
 * surfaces. Higher rungs are rarer, so they get more. Reduced motion is
 * honoured inside the fx components themselves.
 */

export type CelebrationRung = "bet_win" | "h2h_week" | "streak_milestone" | "level_up" | "promotion";

export interface Celebration {
  rank: number;
  burst: { count: number; power: number; duration: number } | null;
  beams: boolean;
  /** AvatarDisplay reaction kind, when the surface shows the avatar. */
  avatarMove: "win" | "dance" | null;
  shareCard: boolean;
}

export const CELEBRATIONS: Record<CelebrationRung, Celebration> = {
  bet_win: { rank: 1, burst: { count: 36, power: 1.05, duration: 1500 }, beams: false, avatarMove: "win", shareCard: true },
  h2h_week: { rank: 2, burst: { count: 48, power: 1.15, duration: 1600 }, beams: false, avatarMove: "win", shareCard: true },
  streak_milestone: { rank: 3, burst: { count: 52, power: 1.2, duration: 1700 }, beams: false, avatarMove: "win", shareCard: true },
  level_up: { rank: 4, burst: { count: 56, power: 1.25, duration: 1800 }, beams: true, avatarMove: "dance", shareCard: false },
  promotion: { rank: 5, burst: { count: 72, power: 1.5, duration: 2000 }, beams: true, avatarMove: "dance", shareCard: true },
};

/** A big win borrows the next rung's burst so it still reads as special, never above level-up. */
export function celebrate(rung: CelebrationRung, opts: { big?: boolean } = {}): Celebration {
  const base = CELEBRATIONS[rung];
  if (rung === "bet_win" && opts.big) return { ...base, burst: { count: 64, power: 1.5, duration: 1500 } };
  return base;
}

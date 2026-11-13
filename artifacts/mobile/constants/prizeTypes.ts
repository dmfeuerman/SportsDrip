import type { BoxTier } from "@/lib/api";

/**
 * DISPLAY ONLY.
 *
 * The old `PRIZE_BOXES` in this file was the authoritative reward table and the
 * client drew from it with `Math.random()` (AUDIT S3). The real table now lives
 * in `functions/src/lib/economy.ts`, server-side, where the user can't read or
 * influence it.
 *
 * What remains here is the wheel's face: labels, colours and the wait copy. If
 * these drift from the server table the wheel may land on a wedge whose number
 * doesn't match the payout, so keep the `credits` values in sync — but nothing
 * about the payout depends on this file being correct.
 */

export interface WheelSegment {
  credits: number;
  color: string;
}

export interface BoxDisplay {
  tier: BoxTier;
  label: string;
  waitHours: number;
  color: string;
  glowColor: string;
  emoji: string;
  segments: WheelSegment[];
}

export const BOX_DISPLAY: Record<BoxTier, BoxDisplay> = {
  bronze: {
    tier: "bronze",
    label: "Bronze Box",
    waitHours: 1,
    color: "#CD7F32",
    glowColor: "#FF9A3C",
    emoji: "📦",
    segments: [
      { credits: 500, color: "#8B4513" },
      { credits: 750, color: "#A0522D" },
      { credits: 1000, color: "#CD7F32" },
      { credits: 500, color: "#8B4513" },
      { credits: 1250, color: "#D2691E" },
      { credits: 750, color: "#A0522D" },
      { credits: 2000, color: "#FF8C00" },
      { credits: 500, color: "#8B4513" },
    ],
  },
  silver: {
    tier: "silver",
    label: "Silver Box",
    waitHours: 4,
    color: "#9E9E9E",
    glowColor: "#E0E0E0",
    emoji: "🎁",
    segments: [
      { credits: 1500, color: "#607D8B" },
      { credits: 2000, color: "#78909C" },
      { credits: 2500, color: "#90A4AE" },
      { credits: 1500, color: "#607D8B" },
      { credits: 3500, color: "#B0BEC5" },
      { credits: 2000, color: "#78909C" },
      { credits: 5000, color: "#CFD8DC" },
      { credits: 1500, color: "#607D8B" },
    ],
  },
  gold: {
    tier: "gold",
    label: "Gold Box",
    waitHours: 12,
    color: "#FFD700",
    glowColor: "#FFEC6E",
    emoji: "🏆",
    segments: [
      { credits: 4000, color: "#B8860B" },
      { credits: 6000, color: "#DAA520" },
      { credits: 8000, color: "#C9A227" },
      { credits: 4000, color: "#B8860B" },
      { credits: 12_000, color: "#FFC107" },
      { credits: 6000, color: "#DAA520" },
      { credits: 20_000, color: "#E0B400" },
      { credits: 4000, color: "#B8860B" },
    ],
  },
};

export const BOX_TIERS: BoxTier[] = ["bronze", "silver", "gold"];

/**
 * Published odds, mirroring functions/src/lib/economy.ts PRIZE_BOXES weights
 * (the server is authoritative). Shown on the Prizes screen.
 */
export const BOX_ODDS: Record<BoxTier, Array<{ credits: number; pct: number }>> = (() => {
  const w: Record<BoxTier, Array<[number, number]>> = {
    bronze: [[500, 9], [750, 4], [1000, 2], [1250, 1], [2000, 1]],
    silver: [[1500, 9], [2000, 4], [2500, 2], [3500, 1], [5000, 1]],
    gold: [[4000, 9], [6000, 4], [8000, 2], [12_000, 1], [20_000, 1]],
  };
  const out = {} as Record<BoxTier, Array<{ credits: number; pct: number }>>;
  for (const t of Object.keys(w) as BoxTier[]) {
    const total = w[t].reduce((s, [, x]) => s + x, 0);
    out[t] = w[t].map(([credits, x]) => ({ credits, pct: (x / total) * 100 }));
  }
  return out;
})();

/** Mirrors functions/src/callable/prizes.ts PITY_AFTER. */
export const BOX_PITY_AFTER = 15;

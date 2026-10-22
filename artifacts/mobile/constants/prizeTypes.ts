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
      { credits: 50, color: "#8B4513" },
      { credits: 75, color: "#A0522D" },
      { credits: 100, color: "#CD7F32" },
      { credits: 50, color: "#8B4513" },
      { credits: 125, color: "#D2691E" },
      { credits: 75, color: "#A0522D" },
      { credits: 200, color: "#FF8C00" },
      { credits: 50, color: "#8B4513" },
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
      { credits: 150, color: "#607D8B" },
      { credits: 200, color: "#78909C" },
      { credits: 250, color: "#90A4AE" },
      { credits: 150, color: "#607D8B" },
      { credits: 350, color: "#B0BEC5" },
      { credits: 200, color: "#78909C" },
      { credits: 500, color: "#CFD8DC" },
      { credits: 150, color: "#607D8B" },
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
      { credits: 400, color: "#B8860B" },
      { credits: 600, color: "#DAA520" },
      { credits: 800, color: "#C9A227" },
      { credits: 400, color: "#B8860B" },
      { credits: 1200, color: "#FFC107" },
      { credits: 600, color: "#DAA520" },
      { credits: 2000, color: "#E0B400" },
      { credits: 400, color: "#B8860B" },
    ],
  },
};

export const BOX_TIERS: BoxTier[] = ["bronze", "silver", "gold"];

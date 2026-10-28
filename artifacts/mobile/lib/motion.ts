import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { Easing } from "react-native-reanimated";

/**
 * Shared motion vocabulary: springs, curves, haptics and reward rarity
 * colours, so every animated surface in the app moves and buzzes the same way.
 */

export const SPRING = {
  /** Press states, chips, selection: settles in ~180 ms with no visible overshoot. */
  snappy: { damping: 16, stiffness: 380, mass: 0.6 },
  /** Things arriving: cards, toasts, the lock-in ticket. A little overshoot. */
  pop: { damping: 12, stiffness: 220, mass: 0.8 },
  /** Big reveals: one confident bounce. */
  bouncy: { damping: 9, stiffness: 170, mass: 0.9 },
  soft: { damping: 20, stiffness: 140, mass: 1 },
} as const;

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /**
   * The prize wheel: a hard launch, a long glide and a slow, tense crawl over
   * the last few pegs (most of the 5.6 s is spent in the final quarter turn).
   */
  wheel: Easing.bezier(0.08, 0.72, 0.06, 1),
  linear: Easing.linear,
} as const;

const quiet = () => {};
const native = Platform.OS !== "web";

/** Fire-and-forget haptics; no-ops on web and never throw. */
export const haptic = {
  tick: () => (native ? Haptics.selectionAsync().catch(quiet) : undefined),
  light: () => (native ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(quiet) : undefined),
  medium: () => (native ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(quiet) : undefined),
  heavy: () => (native ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(quiet) : undefined),
  rigid: () => (native ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(quiet) : undefined),
  success: () => (native ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet) : undefined),
  warning: () => (native ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(quiet) : undefined),
  error: () => (native ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(quiet) : undefined),
};

/* ── reward rarity ──────────────────────────────────────────────────────── */

export type RewardRarity = "common" | "rare" | "epic";

export const REWARD_RARITY: Record<RewardRarity, { label: string; color: string; glow: string; confetti: string[] }> = {
  common: { label: "NICE PULL", color: "#4C9BFF", glow: "#9CC8FF", confetti: ["#4C9BFF", "#9CC8FF", "#FFFFFF", "#2FE38A"] },
  rare: { label: "RARE PULL", color: "#9B7BFF", glow: "#CDBDFF", confetti: ["#9B7BFF", "#CDBDFF", "#FF7BD8", "#FFFFFF"] },
  epic: { label: "EPIC PULL", color: "#FFC83D", glow: "#FFE7A3", confetti: ["#FFC83D", "#FFE7A3", "#FF8A3D", "#FFFFFF", "#2FE38A"] },
};

/**
 * How special a prize is within its own table: the top prize is epic, the
 * next one down rare, everything else common. Relative, so a bronze box's best
 * wedge still feels like a big hit.
 */
export function rewardRarity(credits: number, table: number[]): RewardRarity {
  const tiers = [...new Set(table)].sort((a, b) => b - a);
  if (credits >= (tiers[0] ?? Infinity)) return "epic";
  if (tiers.length > 2 && credits >= (tiers[1] ?? Infinity)) return "rare";
  return "common";
}

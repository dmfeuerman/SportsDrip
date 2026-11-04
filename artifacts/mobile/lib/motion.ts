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

let enabled = true;
let seq = 0;
/** Master switch (e.g. a settings toggle). */
export function setHapticsEnabled(on: boolean) {
  enabled = on;
}
/** Increments on every haptic fired; lets a press wrapper tell whether its handler already buzzed. */
export const hapticSeq = () => seq;

function fire(run: () => Promise<void>) {
  if (!native || !enabled) return undefined;
  seq++;
  return run().catch(quiet);
}
const after = (ms: number, fn: () => unknown) => setTimeout(fn, ms);
let rollUntil = 0;

const base = {
  tick: () => fire(() => Haptics.selectionAsync()),
  light: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  rigid: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

/** Fire-and-forget haptics; no-ops on web and never throw. */
export const haptic = {
  ...base,
  /** A win: a rising thump-thump into a success, with an aftershock for big ones. */
  celebrate: (big = false) => {
    base.medium();
    after(90, base.heavy);
    after(220, base.success);
    if (big) {
      after(480, base.heavy);
      after(580, base.rigid);
      after(680, base.medium);
      after(800, base.light);
    }
  },
  /** A loss: one dull thud. */
  thud: () => {
    base.warning();
    after(160, base.heavy);
  },
  /** Confetti popping: a scatter of light pops that fades out. */
  crackle: (pops = 6, delay = 0) => {
    for (let i = 0; i < pops; i++) {
      const at = delay + i * 55 + Math.random() * 30;
      after(at, i < pops / 2 ? base.light : base.tick);
    }
  },
  /** A number counting up: ticks that slow down with the ease-out, then a click as it lands. */
  roll: (durationMs = 750, delay = 0) => {
    const now = Date.now();
    if (now < rollUntil) return; // several on-screen counters animating together buzz once
    rollUntil = now + delay + durationMs;
    const steps = Math.max(4, Math.min(14, Math.round(durationMs / 70)));
    for (let i = 0; i < steps; i++) {
      const k = i / steps;
      after(delay + durationMs * (1 - Math.pow(1 - k, 2)) * 0.9, base.tick);
    }
    after(delay + durationMs, base.light);
  },
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

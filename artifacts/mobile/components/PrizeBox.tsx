import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import Shimmer from "@/components/fx/Shimmer";
import type { PrizeBoxState } from "@/context/AppContext";
import type { BoxDisplay } from "@/constants/prizeTypes";
import { useColors } from "@/hooks/useColors";
import { useBreathe } from "@/hooks/useMotion";
import { haptic } from "@/lib/motion";

/** How long the box rattles before it bursts open (the claim runs underneath). */
export const CHARGE_MS = 1300;

interface Props {
  display: BoxDisplay;
  state: PrizeBoxState;
  /** Shared 1s tick from the parent — see the note below. */
  now: number;
  busy: boolean;
  /** The box is rattling open (the claim is in flight). */
  charging?: boolean;
  onOpen: () => void;
  onClaim: () => void;
  onReset: () => void;
}

function countdown(ms: number): string {
  if (ms <= 0) return "Ready";
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * One prize box, driven by server state (idle → waiting → ready → claimed).
 *
 * The tick is hoisted to the parent (one timer for the screen, only while
 * something counts down). On top of that, motion:
 *  - idle and ready boxes float and breathe; a ready one glows and its
 *    button glints, so it reads as "open me" from across the screen
 *  - opening it rattles the box harder and harder with escalating haptic
 *    ticks while the claim is committed server-side, then hands over to the
 *    wheel
 */
export default function PrizeBox({ display, state, now, busy, charging = false, onOpen, onClaim, onReset }: Props) {
  const colors = useColors();
  const reduced = useReducedMotion();

  const readyAt = state.readyAt ?? 0;
  const waiting = state.state === "waiting" && now < readyAt;
  const ready = (state.state === "waiting" || state.state === "ready") && now >= readyAt;
  const claimed = state.state === "claimed";
  const idle = state.state === "idle";

  const breathe = useBreathe((idle || ready) && !charging, ready ? 1600 : 2600);

  // Rattle: amplitude grows over CHARGE_MS, driven per frame on the UI thread.
  const charge = useSharedValue(0);
  const phase = useSharedValue(0);
  const rattle = useFrameCallback((f) => {
    phase.value += (f.timeSincePreviousFrame ?? 16) * (0.045 + 0.06 * charge.value);
  }, false);
  useEffect(() => {
    if (!charging || reduced) {
      rattle.setActive(false);
      cancelAnimation(charge);
      charge.value = withTiming(0, { duration: 150 });
      return;
    }
    charge.value = 0;
    charge.value = withTiming(1, { duration: CHARGE_MS, easing: Easing.in(Easing.quad) });
    rattle.setActive(true);
    // Haptic ticks that speed up and hit harder as the box is about to pop.
    let t = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const k = Math.min(1, t / CHARGE_MS);
      (k > 0.75 ? haptic.heavy : k > 0.4 ? haptic.medium : haptic.light)();
      const gap = 210 - 160 * k;
      t += gap;
      if (t < CHARGE_MS + 400) timer = setTimeout(step, gap);
    };
    step();
    return () => {
      clearTimeout(timer);
      rattle.setActive(false);
    };
  }, [charging, reduced, charge, rattle]);

  const iconStyle = useAnimatedStyle(() => {
    const amp = 2 + 11 * charge.value;
    return {
      transform: [
        { translateY: -5 * breathe.value },
        { translateX: Math.sin(phase.value * 1.7) * amp * 0.35 * charge.value },
        { rotate: `${Math.sin(phase.value) * amp * (charge.value > 0.01 ? 1 : 0)}deg` },
        { scale: 1 + 0.035 * breathe.value + 0.12 * charge.value },
      ],
    };
  });
  const glowStyle = useAnimatedStyle(() => ({
    opacity: ready ? 0.25 + 0.4 * breathe.value + 0.35 * charge.value : 0.08 + 0.1 * breathe.value,
    transform: [{ scale: 0.9 + 0.25 * breathe.value + 0.5 * charge.value }],
  }));

  function press() {
    if (busy || charging) return;
    haptic.medium();
    if (idle) onOpen();
    else if (ready) onClaim();
    else if (claimed) onReset();
  }

  const actionLabel = charging ? "Opening…" : ready ? "Open!" : waiting ? "Waiting" : claimed ? "Open again" : "Start timer";
  const min = Math.min(...display.segments.map((s) => s.credits));
  const max = Math.max(...display.segments.map((s) => s.credits));

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: ready || charging ? display.color : colors.border,
          borderWidth: ready ? 2 : 1,
          shadowColor: display.glowColor,
          shadowOpacity: ready ? 0.45 : 0,
        },
      ]}
    >
      {ready && <View style={[styles.glowBar, { backgroundColor: display.glowColor }]} />}

      <View style={styles.iconArea}>
        <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: display.glowColor }, glowStyle]} />
        <Animated.View style={[styles.iconWrap, { backgroundColor: display.color + "22", borderColor: display.color + "77" }, iconStyle]}>
          <Text style={styles.emoji}>{display.emoji}</Text>
        </Animated.View>
      </View>

      <Text style={[styles.tier, { color: display.color }]}>{display.label}</Text>
      <Text style={[styles.range, { color: colors.mutedForeground }]}>
        {min.toLocaleString()}–{max.toLocaleString()} credits
      </Text>
      <Text style={[styles.wait, { color: colors.mutedForeground }]}>{display.waitHours}h wait</Text>

      {waiting && (
        <View style={[styles.timer, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="timer-outline" size={12} color={colors.mutedForeground} />
          <Text style={[styles.timerText, { color: colors.mutedForeground }]}>{countdown(readyAt - now)}</Text>
        </View>
      )}

      {claimed && state.rewardCredits !== null && (
        <View style={[styles.timer, { backgroundColor: colors.primary + "22", borderColor: colors.primary }]}>
          <MaterialCommunityIcons name="check" size={12} color={colors.primary} />
          <Text style={[styles.timerText, { color: colors.primary }]}>+{state.rewardCredits.toLocaleString()}</Text>
        </View>
      )}

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${display.label}: ${actionLabel}`}
        accessibilityState={{ disabled: waiting || busy || charging, busy: busy || charging }}
        style={[
          styles.action,
          {
            backgroundColor: ready || charging ? display.color : colors.secondary,
            borderColor: ready ? display.color : waiting ? colors.border : display.color + "66",
            opacity: waiting || (busy && !charging) ? 0.6 : 1,
          },
        ]}
        scaleTo={0.94}
        onPress={press}
        disabled={waiting || busy || charging}
      >
        {ready && !charging ? <Shimmer intensity={0.5} every={1800} /> : null}
        {busy && !charging ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Text style={[styles.actionText, { color: ready || charging ? "#000" : waiting ? colors.mutedForeground : display.color }]}>{actionLabel}</Text>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 8,
    minHeight: 222,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  glowBar: { position: "absolute", top: 0, left: 14, right: 14, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, opacity: 0.9 },
  iconArea: { width: 84, height: 84, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 74, height: 74, borderRadius: 37 },
  iconWrap: { width: 68, height: 68, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 32 },
  tier: { fontSize: 13, fontFamily: "Inter_700Bold" },
  range: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  wait: { fontSize: 10, fontFamily: "Inter_400Regular" },
  timer: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  timerText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  action: { width: "100%", paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, alignItems: "center", marginTop: "auto", overflow: "hidden" },
  actionText: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
});

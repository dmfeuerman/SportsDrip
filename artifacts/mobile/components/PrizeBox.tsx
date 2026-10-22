import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { PrizeBoxState } from "@/context/AppContext";
import type { BoxDisplay } from "@/constants/prizeTypes";
import { useColors } from "@/hooks/useColors";

interface Props {
  display: BoxDisplay;
  state: PrizeBoxState;
  /** Shared 1s tick from the parent — see the note below. */
  now: number;
  busy: boolean;
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
 * Rewritten around server state.
 *
 * The old component owned its own `setInterval` — three boxes meant three
 * timers, each re-rendering its card every second (AUDIT U3). The tick is now
 * hoisted to the parent and passed down, so there is one timer for the screen
 * and it only runs while something is actually counting down.
 *
 * The four states are explicit and come from Firestore, not from the absence of
 * a local object. `claimed` finally renders — the old code deleted the claim on
 * spin, so the `spun` overlay was dead code and the "N opened" stat was
 * permanently zero (AUDIT B8).
 */
export default function PrizeBox({ display, state, now, busy, onOpen, onClaim, onReset }: Props) {
  const colors = useColors();

  const readyAt = state.readyAt ?? 0;
  const waiting = state.state === "waiting" && now < readyAt;
  const ready = (state.state === "waiting" || state.state === "ready") && now >= readyAt;
  const claimed = state.state === "claimed";
  const idle = state.state === "idle";

  function press() {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (idle) onOpen();
    else if (ready) onClaim();
    else if (claimed) onReset();
  }

  const actionLabel = ready ? "Spin" : waiting ? "Waiting" : claimed ? "Open again" : "Open box";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: ready ? display.color : colors.border,
          borderWidth: ready ? 2 : 1,
        },
      ]}
    >
      {ready && <View style={[styles.glow, { backgroundColor: display.glowColor }]} />}

      <View
        style={[
          styles.iconWrap,
          { backgroundColor: display.color + "22", borderColor: display.color + "55" },
        ]}
      >
        <Text style={styles.emoji}>{display.emoji}</Text>
      </View>

      <Text style={[styles.tier, { color: display.color }]}>{display.label}</Text>
      <Text style={[styles.range, { color: colors.mutedForeground }]}>
        {Math.min(...display.segments.map((s) => s.credits))}–
        {Math.max(...display.segments.map((s) => s.credits))} credits
      </Text>
      <Text style={[styles.wait, { color: colors.mutedForeground }]}>
        {display.waitHours}h wait
      </Text>

      {waiting && (
        <View style={[styles.timer, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="timer-outline" size={12} color={colors.mutedForeground} />
          <Text style={[styles.timerText, { color: colors.mutedForeground }]}>
            {countdown(readyAt - now)}
          </Text>
        </View>
      )}

      {claimed && state.rewardCredits !== null && (
        <View style={[styles.timer, { backgroundColor: colors.primary + "22", borderColor: colors.primary }]}>
          <MaterialCommunityIcons name="check" size={12} color={colors.primary} />
          <Text style={[styles.timerText, { color: colors.primary }]}>
            +{state.rewardCredits.toLocaleString()}
          </Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.action,
          {
            backgroundColor: ready ? display.color : colors.secondary,
            borderColor: ready ? display.color : waiting ? colors.border : display.color + "66",
            opacity: waiting || busy ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
        onPress={press}
        disabled={waiting || busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Text
            style={[
              styles.actionText,
              { color: ready ? "#000" : waiting ? colors.mutedForeground : display.color },
            ]}
          >
            {actionLabel}
          </Text>
        )}
      </Pressable>
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
    overflow: "hidden",
    minHeight: 208,
  },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 3, opacity: 0.9 },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 30 },
  tier: { fontSize: 13, fontFamily: "Inter_700Bold" },
  range: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  wait: { fontSize: 10, fontFamily: "Inter_400Regular" },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  timerText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  action: {
    width: "100%",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    marginTop: "auto",
  },
  actionText: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
});

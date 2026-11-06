import { MaterialCommunityIcons } from "@expo/vector-icons";
import TeamCrest from "@/components/TeamCrest";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Burst from "@/components/fx/Burst";
import { Amount } from "@/components/ui";
import type { BetLockedInput } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { haptic, SPRING } from "@/lib/motion";

const SHOW_MS = 2300;

/**
 * "Bet locked in": the ticket springs up, a LOCKED IN stamp slams onto it
 * with a heavy haptic, a glow sweeps its border and confetti in the team's
 * colours bursts out. Tap anywhere to skip; it clears itself after ~2 s.
 */
export default function BetLockedOverlay({ bet, onDone }: { bet: BetLockedInput; onDone: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const tint = bet.currency === "league" ? c.league : c.primary;

  const card = useSharedValue(0);
  const stamp = useSharedValue(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Bet locked in. ${bet.stake} on ${bet.teamName}.`);
    haptic.medium();
    card.value = reduced ? 1 : withSpring(1, SPRING.pop);
    stamp.value = reduced ? 1 : withDelay(260, withSpring(1, { damping: 11, stiffness: 260, mass: 0.7 }));
    sweep.value = reduced ? 0 : withDelay(380, withSequence(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 0 })));
    const thud = setTimeout(() => haptic.heavy(), reduced ? 0 : 300);
    const ok = setTimeout(() => haptic.success(), reduced ? 0 : 520);
    const done = setTimeout(onDone, SHOW_MS);
    return () => [thud, ok, done].forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, card.value * 1.5),
    transform: [{ translateY: (1 - card.value) * 80 }, { scale: 0.85 + 0.15 * card.value }],
  }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: stamp.value > 0.02 ? 1 : 0,
    transform: [{ scale: 2.6 - 1.6 * stamp.value }, { rotate: "-12deg" }],
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweep.value > 0 && sweep.value < 1 ? 1 : 0,
    transform: [{ translateX: -260 + sweep.value * 620 }, { skewX: "-18deg" }],
  }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(160)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDone} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <Burst colors={[bet.teamColor, tint, "#FFFFFF", "#FFC83D"]} count={48} power={1.25} trigger={1} />
        <Animated.View pointerEvents="none" style={[styles.ticket, { backgroundColor: c.elevated, borderColor: tint, shadowColor: tint }, cardStyle]}>
          <View style={[styles.stripe, { backgroundColor: bet.teamColor }]} />
          <View style={styles.head}>
            <TeamCrest abbr={bet.teamAbbr} color={bet.teamColor} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>YOUR PICK</Text>
              <Text style={[styles.team, { color: c.foreground }]} numberOfLines={1}>
                {bet.teamName} to win
              </Text>
              <Text style={[styles.k2, { color: c.mutedForeground }]}>
                {bet.odds.toFixed(2)}x{bet.walletLabel ? ` · ${bet.walletLabel}` : ""}
              </Text>
            </View>
          </View>
          <View style={[styles.perf, { borderColor: c.border }]} />
          <View style={styles.nums}>
            <View>
              <Text style={[styles.k, { color: c.mutedForeground }]}>STAKE</Text>
              <Amount value={bet.stake} currency={bet.currency} size="md" />
            </View>
            <MaterialCommunityIcons name="arrow-right" size={18} color={c.subtleForeground} />
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>TO WIN</Text>
              <Amount value={bet.payout} currency={bet.currency} size="lg" tone="positive" />
            </View>
          </View>

          <Animated.View style={[styles.sweep, sweepStyle]}>
            <LinearGradient colors={["rgba(255,255,255,0)", c.alpha(tint, 0.55), "rgba(255,255,255,0)"] as const} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>

          <Animated.View style={[styles.stamp, { borderColor: tint }, stampStyle]}>
            <MaterialCommunityIcons name="lock-check" size={18} color={tint} />
            <Text style={[styles.stampText, { color: tint }]}>LOCKED IN</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  ticket: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: 2,
    overflow: "hidden",
    paddingBottom: 18,
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 24,
  },
  stripe: { height: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  badge: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  abbr: { fontSize: 14, fontFamily: "Inter_900Black" },
  k: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  k2: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  team: { fontSize: 17, fontFamily: "Inter_900Black", letterSpacing: -0.3 },
  perf: { borderTopWidth: 1.5, borderStyle: "dashed", marginHorizontal: 12 },
  nums: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14 },
  sweep: { position: "absolute", top: 0, bottom: 0, width: 140 },
  stamp: {
    position: "absolute",
    right: 18,
    top: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  stampText: { fontSize: 18, fontFamily: "Inter_900Black", letterSpacing: 1.5 },
});

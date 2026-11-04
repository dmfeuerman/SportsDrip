import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOutUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import type { LevelProgress } from "@/constants/progression";
import { useColors } from "@/hooks/useColors";

const GLASS = "rgba(10, 11, 14, 0.66)";

/**
 * Level, XP into it and what it takes, drawn over the character on Home (it
 * replaces the old "wearing" pills). Readable on every backdrop: a dark glass
 * pill with white type in both themes.
 *
 * The fill animates to new XP; a level-up runs it to the end, wraps, and fills
 * again. Earned XP floats up as "+40 XP" for a moment.
 */
export default function LevelBar({
  progress,
  nextReward,
  onPress,
  style,
}: {
  progress: LevelProgress;
  /** "Rookie Cap at Lv 3" — the next thing worth climbing for. */
  nextReward?: string | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const fill = useSharedValue(progress.pct);
  const prev = useRef(progress);
  const [gain, setGain] = useState<{ amount: number; n: number } | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = progress;
    if (reduced) {
      fill.value = progress.pct;
      return;
    }
    if (progress.level > before.level) {
      fill.value = withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }), withTiming(0, { duration: 0 }), withTiming(progress.pct, { duration: 620, easing: Easing.out(Easing.cubic) }));
    } else {
      fill.value = withTiming(progress.pct, { duration: 700, easing: Easing.out(Easing.cubic) });
    }
    const delta = progress.xp - before.xp;
    if (delta > 0 && before.xp > 0) setGain((g) => ({ amount: delta, n: (g?.n ?? 0) + 1 }));
  }, [progress, reduced, fill]);

  useEffect(() => {
    if (!gain) return;
    const t = setTimeout(() => setGain(null), 1800);
    return () => clearTimeout(t);
  }, [gain]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0.03, fill.value) * 100}%` }));

  const label = progress.maxed
    ? `Level ${progress.level}, max level`
    : `Level ${progress.level}, ${progress.into.toLocaleString()} of ${progress.needed.toLocaleString()} XP`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Opens levels and rewards.`}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
    >
      <LevelBadge level={progress.level} size={42} />
      <View style={styles.mid}>
        <View style={styles.row}>
          <Text style={styles.level}>LEVEL {progress.level}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.xp} numberOfLines={1}>
            {progress.maxed ? "MAX" : `${progress.into.toLocaleString()} / ${progress.needed.toLocaleString()} XP`}
          </Text>
        </View>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]}>
            <LinearGradient colors={[c.primary, "#7CF5B8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <View style={styles.sheen} />
          </Animated.View>
        </View>
        {nextReward ? (
          <Text style={styles.next} numberOfLines={1}>
            <MaterialCommunityIcons name="gift-outline" size={10} color="rgba(255,255,255,0.6)" /> Next: {nextReward}
          </Text>
        ) : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={18} color="rgba(255,255,255,0.55)" /> : null}
      {gain ? (
        <Animated.View key={gain.n} entering={FadeIn.duration(160)} exiting={FadeOutUp.duration(700)} style={[styles.gain, { backgroundColor: c.primary }]} pointerEvents="none">
          <Text style={[styles.gainText, { color: c.primaryForeground }]}>+{gain.amount.toLocaleString()} XP</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/** The level number in a two-tone medallion. Shared with the level-up celebration and the Levels screen. */
export function LevelBadge({ level, size = 42, glow }: { level: number; size?: number; glow?: boolean }) {
  const tier = levelTier(level);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {glow ? <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: tier.glow, transform: [{ scale: 1.35 }], opacity: 0.35 }]} /> : null}
      <LinearGradient
        colors={tier.ring}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, padding: Math.max(2, size * 0.07) }}
      >
        <LinearGradient
          colors={tier.face}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{ flex: 1, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}
        >
          <Text
            style={{
              color: tier.text,
              fontFamily: "Inter_900Black",
              fontSize: size * (String(level).length > 1 ? 0.4 : 0.48),
              letterSpacing: -0.5,
              fontVariant: ["tabular-nums"],
            }}
          >
            {level}
          </Text>
        </LinearGradient>
      </LinearGradient>
      {level >= 10 ? (
        <MaterialCommunityIcons name="star-four-points" size={size * 0.28} color={tier.glow} style={{ position: "absolute", top: -size * 0.06, right: -size * 0.04 }} />
      ) : null}
    </View>
  );
}

/** Medallion colours by level band: green → blue → violet → gold. */
export function levelTier(level: number): { ring: [string, string]; face: [string, string]; text: string; glow: string; name: string } {
  if (level >= 30) return { ring: ["#FFF3C4", "#C8901A"], face: ["#FFD86B", "#E0A82E"], text: "#3A2500", glow: "#FFC23D", name: "Legend" };
  if (level >= 20) return { ring: ["#E1D4FF", "#6B3FD9"], face: ["#B07BFF", "#7B4DFF"], text: "#FFFFFF", glow: "#B07BFF", name: "Elite" };
  if (level >= 10) return { ring: ["#CFE5FF", "#2160C4"], face: ["#4C9BFF", "#2F74E0"], text: "#FFFFFF", glow: "#4C9BFF", name: "Pro" };
  return { ring: ["#C9FBE2", "#13A862"], face: ["#2FE38A", "#19C673"], text: "#03140B", glow: "#2FE38A", name: "Rookie" };
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 8,
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  mid: { flex: 1, gap: 5 },
  row: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  level: { color: "#FFFFFF", fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 1.4 },
  xp: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  track: { height: 9, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.14)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5, overflow: "hidden" },
  sheen: { position: "absolute", left: 0, right: 0, top: 0, height: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  next: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontFamily: "Inter_600SemiBold" },
  gain: { position: "absolute", right: 30, top: -14, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  gainText: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.3 },
});

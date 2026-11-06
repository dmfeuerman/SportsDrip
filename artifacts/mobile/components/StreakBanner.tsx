import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import { useColors } from "@/hooks/useColors";
import { useBreathe } from "@/hooks/useMotion";
import { nyDayOf } from "@/lib/streakGrid";

const FIRE = "#FF7A1A";
const MAX_DAYS = 7;

/**
 * The streak bonus, front and centre above the prize boxes: a living flame
 * with the day count, the bonus every box pays right now, progress to the
 * max (7 days) and whether today already counts.
 */
export default function StreakBanner({
  streak,
  now,
  expanded,
  onPress,
}: {
  streak: { count?: number; longest?: number; lastDay?: string; freezes?: number } | null | undefined;
  now: number;
  expanded: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const count = streak?.count ?? 0;
  const days = Math.min(MAX_DAYS, count);
  const today = nyDayOf(now);
  const doneToday = streak?.lastDay === today;
  const alive = count > 0;
  const flame = useBreathe(alive, doneToday ? 2400 : 1200);
  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(flame.value, [0, 1], [1, 1.14]) }, { rotate: `${interpolate(flame.value, [0, 1], [-4, 4])}deg` }],
  }));
  const next = Math.min(MAX_DAYS, days + 1);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${count}-day streak. Bonus on every box: ${days * 5}, ${days * 10} and ${days * 15} credits. ${doneToday ? "Today counted." : "Bet today to keep it."} Tap for details.`}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={[styles.card, { borderColor: alive ? FIRE : c.border }]}
    >
      <LinearGradient
        colors={alive ? ["rgba(255,122,26,0.30)", "rgba(255,60,60,0.10)"] : [c.alpha(c.foreground, 0.05), c.alpha(c.foreground, 0.02)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.flameWrap}>
        <Animated.View style={flameStyle}>
          <MaterialCommunityIcons name="fire" size={46} color={alive ? FIRE : c.subtleForeground} />
        </Animated.View>
        <Text style={[styles.count, { color: alive ? "#fff" : c.mutedForeground }]}>{count}</Text>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.row}>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {alive ? `${count}-Day Streak` : "Start a Streak"}
          </Text>
          <View style={[styles.today, { backgroundColor: doneToday ? c.alpha(c.positive, 0.18) : c.alpha(FIRE, 0.18), borderColor: doneToday ? c.positive : FIRE }]}>
            <MaterialCommunityIcons name={doneToday ? "check" : "alert-circle-outline"} size={11} color={doneToday ? c.positive : FIRE} />
            <Text style={[styles.todayText, { color: doneToday ? c.positive : FIRE }]}>{doneToday ? "TODAY ✓" : alive ? "BET TODAY" : "BET TO START"}</Text>
          </View>
        </View>
        <Text style={[styles.bonus, { color: c.foreground }]}>
          {alive ? (
            <>
              <Text style={{ color: FIRE }}>+{days * 5} / +{days * 10} / +{days * 15}</Text> bonus on every box
            </>
          ) : (
            "Bet on back-to-back days for bonus credits on every box"
          )}
        </Text>
        <View style={styles.pips}>
          {Array.from({ length: MAX_DAYS }, (_, i) => (
            <View key={i} style={[styles.pip, { backgroundColor: i < days ? FIRE : c.alpha(c.foreground, 0.12) }]} />
          ))}
        </View>
        <Text style={[styles.hint, { color: c.mutedForeground }]} numberOfLines={1}>
          {days >= MAX_DAYS
            ? `Max bonus unlocked${streak?.freezes ? " · 🧊 freeze banked" : ""}`
            : `Day ${next}: +${next * 5} / +${next * 10} / +${next * 15} · max at ${MAX_DAYS} days`}
        </Text>
      </View>
      <MaterialCommunityIcons name={expanded ? "chevron-up" : "information-outline"} size={16} color={c.mutedForeground} style={{ alignSelf: "flex-start" }} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1.5, padding: 12, overflow: "hidden" },
  flameWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", bottom: 8, fontSize: 17, fontFamily: "Inter_900Black", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_900Black" },
  today: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  todayText: { fontSize: 10, letterSpacing: 0.6, fontFamily: "Inter_800ExtraBold" },
  bonus: { fontSize: 13, fontFamily: "Inter_700Bold" },
  pips: { flexDirection: "row", gap: 4 },
  pip: { flex: 1, height: 6, borderRadius: 3 },
  hint: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

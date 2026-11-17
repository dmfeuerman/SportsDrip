import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useBreathe } from "@/hooks/useMotion";
import { nyDayOf } from "@/lib/streakGrid";

const FIRE = "#FF7A1A";
/** Per streak day, per box (functions/src/lib/streak.ts streakBonusFor). */
export const STREAK_BONUS_PER_DAY = { bronze: 50, silver: 100, gold: 150 } as const;
export const STREAK_BONUS_MAX_DAYS = 7;
const MAX_DAYS = STREAK_BONUS_MAX_DAYS;
/** Free-bet stake bonus per streak day (functions/src/lib/streak.ts FREE_BET_STREAK_PER_DAY). */
export const FREE_PER_DAY = 100;
const B = STREAK_BONUS_PER_DAY;
const TIERS = [
  { key: "bronze", label: "BRONZE", color: "#E0915A" },
  { key: "silver", label: "SILVER", color: "#C9D2DA" },
  { key: "gold", label: "GOLD", color: "#F2B925" },
] as const;

/**
 * The streak bonus, front and centre above the prize boxes: a living flame
 * with the day count, the bonus every box pays right now, progress to the
 * max (7 days) and whether today already counts.
 */
export default function StreakBanner({
  streak,
  now,
}: {
  streak: { count?: number; longest?: number; lastDay?: string } | null | undefined;
  now: number;
}) {
  const c = useColors();
  const today = nyDayOf(now);
  const doneToday = streak?.lastDay === today;
  // Alive only if the last betting day was today or yesterday (no freezes).
  const alive = (streak?.count ?? 0) > 0 && (doneToday || streak?.lastDay === nyDayOf(now - 86_400_000));
  const count = alive ? streak?.count ?? 0 : 0;
  const days = Math.min(MAX_DAYS, count);
  const maxed = days >= MAX_DAYS;
  const heat = heatOf(days);
  const flame = useBreathe(alive, doneToday ? 2400 : 1200);
  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(flame.value, [0, 1], [1, 1.14]) }, { rotate: `${interpolate(flame.value, [0, 1], [-4, 4])}deg` }],
  }));
  // Today's bet adds a day; until then the boxes still pay the current streak.
  const shown = alive ? days : 0;
  const next = Math.min(MAX_DAYS, days + 1);

  return (
    <View
      accessible
      accessibilityLabel={`${count}-day betting streak. Prize boxes pay plus ${shown * B.bronze} Bronze, ${shown * B.silver} Silver, ${shown * B.gold} Gold, and your free bet is ${(shown * FREE_PER_DAY).toLocaleString()} bigger. ${doneToday ? "Today counted." : "Place a bet today to keep it."}`}
      style={[styles.card, { borderColor: alive ? heat.border : c.border }]}
    >
      <LinearGradient
        colors={alive ? heat.grad : [c.alpha(c.foreground, 0.05), c.alpha(c.foreground, 0.02)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.flameWrap}>
        <Animated.View style={flameStyle}>
          <MaterialCommunityIcons name="fire" size={46} color={alive ? heat.flame : c.subtleForeground} />
        </Animated.View>
        <Text style={[styles.count, { color: alive ? "#fff" : c.mutedForeground }]}>{alive ? count : ""}</Text>
      </View>

      <View style={{ flex: 1, gap: 5 }}>
        <View style={styles.row}>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {alive ? `${count}-Day Streak` : "Start a Streak"}
          </Text>
          <View style={[styles.today, { backgroundColor: doneToday ? c.alpha(c.positive, 0.18) : c.alpha(FIRE, 0.18), borderColor: doneToday ? c.positive : FIRE }]}>
            <MaterialCommunityIcons name={doneToday ? "check" : "clock-outline"} size={11} color={doneToday ? c.positive : FIRE} />
            <Text style={[styles.todayText, { color: doneToday ? c.positive : FIRE }]}>{doneToday ? "TODAY" : alive ? "BET TODAY" : "BET TO START"}</Text>
          </View>
        </View>
        <Text style={[styles.bonus, { color: c.mutedForeground }]}>
          {alive
            ? maxed
              ? "Max streak bonus. Bet every day to keep it:"
              : "Every day you place a bet grows these bonuses:"
            : "Place a bet each day to earn bonuses on your prize boxes and free bet:"}
        </Text>
        <View style={styles.chips}>
          {TIERS.map((t) => {
            const v = (alive ? Math.max(1, shown) : 1) * B[t.key];
            return (
              <View key={t.key} style={[styles.chip, { borderColor: t.color, backgroundColor: c.alpha(t.color, alive ? 0.16 : 0.06), opacity: alive ? 1 : 0.6 }]}>
                <Text style={[styles.chipAmt, { color: alive ? "#fff" : c.mutedForeground }]}>+{v.toLocaleString()}</Text>
                <Text style={[styles.chipTier, { color: t.color }]}>{t.label} BOX</Text>
              </View>
            );
          })}
          <View style={[styles.chip, { borderColor: c.positive, backgroundColor: c.alpha(c.positive, alive ? 0.16 : 0.06), opacity: alive ? 1 : 0.6 }]}>
            <Text style={[styles.chipAmt, { color: alive ? "#fff" : c.mutedForeground }]}>+{((alive ? Math.max(1, shown) : 1) * FREE_PER_DAY).toLocaleString()}</Text>
            <Text style={[styles.chipTier, { color: c.positive }]}>FREE BET</Text>
          </View>
        </View>
        <View style={styles.pips}>
          {Array.from({ length: MAX_DAYS }, (_, i) => (
            <View key={i} style={[styles.pip, { backgroundColor: i < days ? heat.border : c.alpha(c.foreground, 0.12) }]} />
          ))}
        </View>
        <Text style={[styles.hint, { color: c.mutedForeground }]} numberOfLines={1}>
          {maxed
            ? "Max bonus"
            : alive
              ? `Bet ${doneToday ? "tomorrow" : "today"}: +${next * B.bronze} / +${next * B.silver} / +${next * B.gold} / +${next * FREE_PER_DAY} · max at ${MAX_DAYS} days`
              : `Grows every betting day, up to +${MAX_DAYS * B.bronze} / +${MAX_DAYS * B.silver} / +${MAX_DAYS * B.gold} / +${MAX_DAYS * FREE_PER_DAY}`}
        </Text>
      </View>
    </View>
  );
}

/** Colour steps up with the streak; 7+ (max bonus) goes blue-white. */
function heatOf(days: number): { border: string; flame: string; grad: [string, string] } {
  if (days >= MAX_DAYS) return { border: "#9FE3F5", flame: "#BDEFFF", grad: ["rgba(159,227,245,0.30)", "rgba(80,120,255,0.10)"] };
  if (days >= 5) return { border: "#FF4D2E", flame: "#FF5A2E", grad: ["rgba(255,77,46,0.35)", "rgba(180,20,20,0.12)"] };
  if (days >= 3) return { border: FIRE, flame: FIRE, grad: ["rgba(255,122,26,0.30)", "rgba(255,60,60,0.10)"] };
  return { border: "#FFB547", flame: "#FFB547", grad: ["rgba(255,181,71,0.25)", "rgba(255,181,71,0.05)"] };
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1.5, padding: 12, overflow: "hidden" },
  flameWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", bottom: 8, fontSize: 17, fontFamily: "Inter_900Black", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_900Black" },
  today: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  todayText: { fontSize: 10, letterSpacing: 0.6, fontFamily: "Inter_800ExtraBold" },
  bonus: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  chips: { flexDirection: "row", gap: 6 },
  chip: { flex: 1, alignItems: "center", borderWidth: 1.5, borderRadius: 10, paddingVertical: 5 },
  chipAmt: { fontSize: 15, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  chipTier: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  pips: { flexDirection: "row", gap: 4 },
  pip: { flex: 1, height: 6, borderRadius: 3 },
  hint: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

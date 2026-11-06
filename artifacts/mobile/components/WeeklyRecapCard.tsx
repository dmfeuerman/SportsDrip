import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Button, SectionHeader } from "@/components/ui";
import type { Bet } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { markItemsSeen, useUnseenCount } from "@/lib/settings";
import { nyDayOf, weekDays } from "@/lib/streakGrid";

const DAY = 86_400_000;

/**
 * Monday–Wednesday recap of last week (ET, Mon–Sun): record, net and best hit,
 * with a share. Dismissed per week.
 */
export default function WeeklyRecapCard({ bets, now, leagueLine }: { bets: Bet[]; now: number; leagueLine?: string | null }) {
  const c = useColors();
  const thisWeek = weekDays(now);
  const lastWeek = weekDays(now - 7 * DAY);
  const key = lastWeek[0]!;
  const unseen = useUnseenCount("recap.weekly", [key], false);
  const dow = thisWeek.indexOf(nyDayOf(now)); // Mon = 0
  if (dow < 0 || dow > 2 || !unseen) return null;

  const from = lastWeek[0]!;
  const to = lastWeek[6]!;
  const inWeek = bets.filter((b) => {
    if (!b.settledAt || (b.status !== "won" && b.status !== "lost" && b.status !== "push")) return false;
    const d = nyDayOf(b.settledAt.seconds * 1000);
    return d >= from && d <= to;
  });
  if (!inWeek.length) return null;
  const w = inWeek.filter((b) => b.status === "won").length;
  const l = inWeek.filter((b) => b.status === "lost").length;
  const net = inWeek.reduce((s, b) => s + (b.status === "won" ? b.potentialPayout : b.status === "push" ? b.stake : 0) - b.stake, 0);
  const best = inWeek.filter((b) => b.status === "won").sort((a, b) => b.potentialPayout - b.stake - (a.potentialPayout - a.stake))[0];
  const dismiss = () => markItemsSeen("recap.weekly", [key]);

  const share = () => {
    const text = [`My SportDrip week: ${w}-${l}, ${net >= 0 ? "+" : ""}${net.toLocaleString()} credits`, best ? `Best hit: ${best.label ?? best.teamName} +${(best.potentialPayout - best.stake).toLocaleString()}` : null, leagueLine].filter(Boolean).join("\n");
    Share.share({ message: text }).catch(() => {});
  };

  return (
    <View style={{ gap: 8 }}>
    <SectionHeader title="Your Week" icon="calendar-week" />
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.alpha(c.accent, 0.5) }]}>
      <View style={styles.head}>
        <Text style={[styles.kicker, { color: c.accent }]}>LAST WEEK · MON–SUN</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss weekly recap" hitSlop={10} onPress={dismiss}>
          <MaterialCommunityIcons name="close" size={18} color={c.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.stats}>
        <Stat label="RECORD" value={`${w}-${l}`} color={c.foreground} />
        <Stat label="NET" value={`${net >= 0 ? "+" : ""}${net.toLocaleString()}`} color={net >= 0 ? c.positive : c.negative} />
        <Stat label="BETS" value={String(inWeek.length)} color={c.foreground} />
      </View>
      {best ? (
        <Text style={[styles.best, { color: c.mutedForeground }]} numberOfLines={1}>
          Best hit: <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold" }}>{best.label ?? best.teamName}</Text> +{(best.potentialPayout - best.stake).toLocaleString()}
        </Text>
      ) : null}
      {leagueLine ? <Text style={[styles.best, { color: c.mutedForeground }]}>{leagueLine}</Text> : null}
      <Button label="Share My Week" icon="share-variant" size="sm" variant="secondary" onPress={share} />
    </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  stats: { flexDirection: "row" },
  value: { fontSize: 22, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  label: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_700Bold" },
  best: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

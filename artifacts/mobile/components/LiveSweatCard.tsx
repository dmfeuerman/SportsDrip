import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SectionHeader } from "@/components/ui";
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import TeamCrest from "@/components/TeamCrest";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import { livePosition } from "@/lib/odds";
import type { Game } from "@/types/game";

export interface SweatBet {
  key: string;
  gameId: string;
  side: "home" | "away";
  market?: "ml" | "spread" | "total";
  selection?: "home" | "away" | "over" | "under";
  line?: number | null;
  label?: string | null;
  teamAbbr: string;
  teamColor: string;
  stake: number;
  potentialPayout: number;
  wallet?: string | null;
}

/**
 * Home's live sweat: every open bet whose game is live, with the score, the
 * clock and whether you're winning right now. Shown only while games are on.
 */
export default function LiveSweatCard({ bets, gameById, onOpen }: { bets: SweatBet[]; gameById: Map<string, Game>; onOpen: (gameId: string) => void }) {
  const c = useColors();
  const live = bets.filter((b) => gameById.get(b.gameId)?.status === "live");
  const pulse = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !live.length) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, live.length, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * pulse.value, transform: [{ scale: 0.8 + 0.4 * pulse.value }] }));
  if (!live.length) return null;
  const winning = live.filter((b) => livePosition(gameById.get(b.gameId)!, b) === "ahead").length;

  return (
    <View style={{ gap: 8 }}>
    <SectionHeader title="Live Now" icon="broadcast" />
    <View style={[styles.card, { backgroundColor: c.alpha(c.live, 0.08), borderColor: c.alpha(c.live, 0.55) }]}>
      <View style={styles.head}>
        <Animated.View style={[styles.dot, { backgroundColor: c.live }, dot]} />
        <Text style={[styles.kicker, { color: c.live }]}>SWEATING · {live.length} LIVE</Text>
        <Text style={[styles.summary, { color: c.mutedForeground }]}>
          {winning}/{live.length} winning
        </Text>
      </View>
      {live.map((b) => {
        const g = gameById.get(b.gameId)!;
        const pos = livePosition(g, b);
        const tone = pos === "ahead" ? c.positive : pos === "behind" ? c.negative : c.mutedForeground;
        return (
          <Pressable
            key={b.key}
            accessibilityRole="button"
            accessibilityLabel={`${g.awayTeam.abbreviation} ${g.awayScore ?? 0}, ${g.homeTeam.abbreviation} ${g.homeScore ?? 0}. Your pick ${b.label ?? b.teamAbbr} is ${pos ?? "live"}`}
            onPress={() => {
              haptic.tick();
              onOpen(g.id);
            }}
            style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <TeamCrest abbr={b.teamAbbr} color={b.teamColor} size={30} sport={g.sport} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.score, { color: c.foreground }]} numberOfLines={1}>
                {g.awayTeam.abbreviation} {g.awayScore ?? 0} – {g.homeScore ?? 0} {g.homeTeam.abbreviation}
              </Text>
              <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
                {g.clock ?? "Live"} · {b.label ?? b.teamAbbr}
                {b.wallet ? ` · ${b.wallet}` : ""} · {b.stake.toLocaleString()} → {b.potentialPayout.toLocaleString()}
              </Text>
            </View>
            <View style={[styles.pos, { backgroundColor: c.alpha(tone, 0.16), borderColor: tone }]}>
              <MaterialCommunityIcons name={pos === "ahead" ? "arrow-up-bold" : pos === "behind" ? "arrow-down-bold" : "equal"} size={12} color={tone} />
              <Text style={[styles.posText, { color: tone }]}>{pos === "ahead" ? "WINNING" : pos === "behind" ? "LOSING" : "TIED"}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  summary: { fontSize: 12, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 10 },
  score: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 11, fontFamily: "Inter_500Medium" },
  pos: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  posText: { fontSize: 10, letterSpacing: 0.6, fontFamily: "Inter_800ExtraBold" },
});

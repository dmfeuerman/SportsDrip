import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SectionHeader } from "@/components/ui";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import TeamCrest from "@/components/TeamCrest";
import { useColors } from "@/hooks/useColors";
import { describeBet } from "@/lib/markets";
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
  freeBet?: boolean;
}

const CARD_WIDTH = 264;
const CARD_GAP = 10;

/**
 * Home's live sweat: fixed-height horizontal swipe carousel of every open bet
 * whose game is live, showing the bet type (ML / SPREAD / O/U), live score,
 * clock, and whether you're winning right now.
 */
export default function LiveSweatCard({ bets, gameById, onOpen }: { bets: SweatBet[]; gameById: Map<string, Game>; onOpen: (gameId: string) => void }) {
  const c = useColors();
  const live = bets.filter((b) => gameById.get(b.gameId)?.status === "live");
  const [page, setPage] = useState(0);
  const pulse = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !live.length) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, live.length, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * pulse.value, transform: [{ scale: 0.8 + 0.4 * pulse.value }] }));
  if (!live.length) return null;
  const winning = live.filter((b) => livePosition(gameById.get(b.gameId)!, b) === "ahead").length;
  const multi = live.length > 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    if (idx !== page && idx >= 0 && idx < live.length) setPage(idx);
  };

  const renderCard = (b: SweatBet, fullWidth: boolean) => {
    const g = gameById.get(b.gameId)!;
    const pos = livePosition(g, b);
    const tone = pos === "ahead" ? c.positive : pos === "behind" ? c.negative : c.mutedForeground;
    const desc = describeBet({
      market: b.market,
      selection: b.selection,
      side: b.side,
      line: b.line,
      teamName: b.teamAbbr,
      teamAbbr: b.teamAbbr,
      opponentAbbr: b.side === "home" ? g.awayTeam.abbreviation : g.homeTeam.abbreviation,
    });
    const typeLabel = b.freeBet ? "FREE" : desc.tag;
    return (
      <Pressable
        key={b.key}
        accessibilityRole="button"
        accessibilityLabel={`${typeLabel} ${b.label ?? b.teamAbbr}: ${g.awayTeam.abbreviation} ${g.awayScore ?? 0}, ${g.homeTeam.abbreviation} ${g.homeScore ?? 0}, ${pos ?? "live"}`}
        onPress={() => {
          haptic.tick();
          onOpen(g.id);
        }}
        style={({ pressed }) => [
          styles.tile,
          fullWidth ? styles.tileFull : { width: CARD_WIDTH },
          { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={styles.tileTop}>
          <TeamCrest abbr={b.teamAbbr} name={(b.side === "home" ? g.homeTeam : g.awayTeam)?.name} color={b.teamColor} size={26} sport={g.sport} />
          <View style={[styles.typePill, { backgroundColor: c.secondary, borderColor: c.border }]}>
            <Text style={[styles.typeText, { color: c.foreground }]}>{typeLabel}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={[styles.pos, { backgroundColor: c.alpha(tone, 0.16), borderColor: tone }]}>
            <MaterialCommunityIcons name={pos === "ahead" ? "arrow-up-bold" : pos === "behind" ? "arrow-down-bold" : "equal"} size={11} color={tone} />
            <Text style={[styles.posText, { color: tone }]}>{pos === "ahead" ? "WINNING" : pos === "behind" ? "LOSING" : "TIED"}</Text>
          </View>
        </View>

        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color: c.foreground }]} numberOfLines={1}>
            {g.awayTeam.abbreviation} {g.awayScore ?? 0} – {g.homeScore ?? 0} {g.homeTeam.abbreviation}
          </Text>
          <Text style={[styles.clock, { color: c.live }]} numberOfLines={1}>
            {g.clock ?? "Live"}
          </Text>
        </View>

        <View style={styles.tileFoot}>
          <Text style={[styles.pick, { color: c.foreground }]} numberOfLines={1}>
            {b.label ?? b.teamAbbr}
            {b.wallet ? <Text style={{ color: c.league }}>{` · ${b.wallet}`}</Text> : null}
          </Text>
          <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
            {b.stake.toLocaleString()} → {b.potentialPayout.toLocaleString()}
          </Text>
        </View>
      </Pressable>
    );
  };

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

        {multi ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={CARD_WIDTH + CARD_GAP}
              snapToAlignment="start"
              onScroll={onScroll}
              scrollEventThrottle={32}
              contentContainerStyle={styles.carousel}
            >
              {live.map((b) => renderCard(b, false))}
            </ScrollView>
            <View style={styles.dots}>
              {live.slice(0, 8).map((b, i) => (
                <View
                  key={b.key}
                  style={[
                    styles.pageDot,
                    { backgroundColor: i === Math.min(page, 7) ? c.live : c.alpha(c.mutedForeground, 0.35) },
                  ]}
                />
              ))}
            </View>
          </>
        ) : (
          renderCard(live[0]!, true)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  summary: { fontSize: 12, fontFamily: "Inter_700Bold" },
  carousel: { gap: CARD_GAP, paddingRight: 4 },
  tile: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 7 },
  tileFull: { width: "100%" },
  tileTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  typePill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  typeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  score: { fontSize: 16, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"], flexShrink: 1 },
  clock: { fontSize: 11, fontFamily: "Inter_700Bold" },
  tileFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pick: { fontSize: 12, fontFamily: "Inter_700Bold", flexShrink: 1 },
  meta: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  pos: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  posText: { fontSize: 10, letterSpacing: 0.6, fontFamily: "Inter_800ExtraBold" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  pageDot: { width: 6, height: 6, borderRadius: 3 },
});

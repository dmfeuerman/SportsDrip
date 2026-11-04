import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from "react-native-reanimated";
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import RollingNumber from "@/components/fx/RollingNumber";
import { Button } from "@/components/ui";
import type { AppNotification } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useShake } from "@/hooks/useMotion";
import { haptic, REWARD_RARITY } from "@/lib/motion";

type Outcome = "won" | "lost" | "push" | "payout";

function outcomeOf(n: AppNotification): Outcome {
  if (n.type === "bet_won" || n.type === "challenge_won") return "won";
  if (n.type === "bet_lost" || n.type === "challenge_lost") return "lost";
  if (n.type === "league_payout") return "payout";
  return "push";
}

/** What a result did to its wallet: profit on a win, the stake on a loss. */
function netOf(n: AppNotification): number {
  const o = outcomeOf(n);
  if (o === "won") return n.bet ? n.bet.payout - n.bet.stake : n.delta;
  if (o === "lost") return n.bet ? -n.bet.stake : n.delta;
  if (o === "payout") return n.delta;
  return 0;
}

/**
 * "While you were away": every bet that settled while the app was closed, in
 * one card on open. The header beams and confetti if you came out ahead (gold
 * for a big night), the card shakes if you didn't; the net rolls up from zero
 * and the results deal in one after another.
 */
export default function ResultRecap({ items, onDismiss }: { items: AppNotification[]; onDismiss: () => void }) {
  const c = useColors();
  const { style: shakeStyle, shake } = useShake();

  const sum = useMemo(() => {
    let won = 0, lost = 0, push = 0, credits = 0, league = 0;
    for (const n of items) {
      const o = outcomeOf(n);
      if (o === "won" || o === "payout") won++;
      else if (o === "lost") lost++;
      else push++;
      if (n.wallet === "league") league += netOf(n);
      else credits += netOf(n);
    }
    return { won, lost, push, credits, league };
  }, [items]);

  // Credits lead; a league-only night shows league tokens instead.
  const showLeague = sum.credits === 0 && sum.league !== 0;
  const net = showLeague ? sum.league : sum.credits;
  const ahead = net > 0 || (net === 0 && sum.won > sum.lost);
  const big = net >= 1000 || sum.won >= 4;
  const accent = ahead ? c.positive : sum.lost > 0 ? c.negative : c.accent;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setShown(Math.abs(net));
      if (ahead) haptic.success();
      else if (sum.lost) {
        haptic.warning();
        shake(1);
      }
    }, 420);
    AccessibilityInfo.announceForAccessibility(
      `While you were away: ${sum.won} won, ${sum.lost} lost. Net ${net >= 0 ? "plus" : "minus"} ${Math.abs(net)} ${showLeague ? "league tokens" : "credits"}.`
    );
    return () => clearTimeout(t1);
    // Once, when the recap opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
        {ahead ? <Burst colors={big ? REWARD_RARITY.epic.confetti : [c.positive, "#FFFFFF", c.accent, c.positive]} count={big ? 64 : 40} power={big ? 1.45 : 1.1} originY={0.3} /> : null}
        {/* Shake on the wrapper, zoom-in on the card: a layout animation and an animated transform shouldn't share a view. */}
        <Animated.View style={[styles.shell, shakeStyle]}>
        <Animated.View entering={ZoomIn.springify().damping(14).stiffness(170)} style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(accent, 0.7), shadowColor: accent }]} accessibilityViewIsModal>
          <View style={[styles.head, { backgroundColor: c.alpha(accent, 0.12) }]}>
            {ahead ? <LightBeams color={big ? REWARD_RARITY.epic.color : accent} size={360} opacity={0.35} /> : null}
            <View style={[styles.ring, { borderColor: c.alpha(accent, 0.6), backgroundColor: c.alpha(accent, 0.15) }]}>
              <MaterialCommunityIcons name={ahead ? (big ? "trophy" : "trending-up") : sum.lost ? "trending-down" : "scale-balance"} size={32} color={accent} />
            </View>
            <Text style={[styles.kicker, { color: c.mutedForeground }]}>WHILE YOU WERE AWAY</Text>
            <Text style={[styles.title, { color: c.foreground }]}>{ahead ? (big ? "Big night!" : "You came out ahead") : sum.lost ? "Rough run" : "All square"}</Text>
            <View style={styles.netRow}>
              <MaterialCommunityIcons name={showLeague ? "shield-star" : "lightning-bolt"} size={28} color={accent} />
              <RollingNumber
                value={shown}
                prefix={net > 0 ? "+" : net < 0 ? "−" : ""}
                style={[styles.net, { color: accent }]}
                duration={1000}
                flash={false}
                haptics={net > 0}
                accessibilityLabel={`Net ${net >= 0 ? "plus" : "minus"} ${Math.abs(net)}`}
              />
            </View>
            <View style={styles.tally}>
              <Tally label="WON" value={sum.won} color={c.positive} />
              <Tally label="LOST" value={sum.lost} color={c.negative} />
              {sum.push ? <Tally label="PUSH" value={sum.push} color={c.mutedForeground} /> : null}
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8, padding: 14 }} showsVerticalScrollIndicator={false}>
            {items.map((n, i) => {
              const o = outcomeOf(n);
              const v = netOf(n);
              const tone = o === "won" || o === "payout" ? c.positive : o === "lost" ? c.negative : c.mutedForeground;
              return (
                <Animated.View
                  key={n.id}
                  entering={FadeInDown.delay(260 + i * 90).springify().damping(16)}
                  style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <View style={[styles.chip, { backgroundColor: n.bet?.teamColor ?? c.league }]}>
                    <Text style={styles.chipText}>{n.bet?.teamAbbr ?? "LG"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: c.foreground }]} numberOfLines={1}>
                      {n.bet ? `${n.bet.teamName}${n.bet.finalHomeScore !== null && n.bet.finalAwayScore !== null ? ` · ${score(n)}` : ""}` : n.title}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
                      {n.leagueName ?? (n.bet ? `${n.bet.stake.toLocaleString()} at ${n.bet.odds.toFixed(2)}x` : n.body)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.badge, { color: tone }]}>{o === "payout" ? "PRIZE" : o.toUpperCase()}</Text>
                    <Text style={[styles.rowAmt, { color: tone }]}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toLocaleString()}</Text>
                  </View>
                </Animated.View>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <Button
              label="My bets"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                onDismiss();
                router.push("/bets");
              }}
            />
            <Button label={ahead ? "Collect" : "Got it"} style={{ flex: 1 }} onPress={onDismiss} haptic={false} shimmer={ahead} />
          </View>
        </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function score(n: AppNotification) {
  const b = n.bet!;
  const mine = b.side === "home" ? b.finalHomeScore : b.finalAwayScore;
  const theirs = b.side === "home" ? b.finalAwayScore : b.finalHomeScore;
  return `${mine}–${theirs} vs ${b.opponentAbbr}`;
}

function Tally({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Animated.View entering={ZoomIn.delay(200).springify()} style={styles.tallyItem}>
      <Text style={[styles.tallyValue, { color }]}>{value}</Text>
      <Text style={[styles.tallyLabel, { color }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  shell: { width: "100%", maxWidth: 400, maxHeight: "88%" },
  card: { width: "100%", flexShrink: 1, borderRadius: 26, borderWidth: 1.5, overflow: "hidden", shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 20 },
  head: { alignItems: "center", paddingTop: 22, paddingBottom: 16, paddingHorizontal: 16, gap: 6, overflow: "hidden" },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  kicker: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.4 },
  title: { fontSize: 24, fontFamily: "Inter_900Black", letterSpacing: -0.6 },
  netRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  net: { fontSize: 40, fontFamily: "Inter_900Black", letterSpacing: -1.2 },
  tally: { flexDirection: "row", gap: 22, marginTop: 4 },
  tallyItem: { alignItems: "center" },
  tallyValue: { fontSize: 20, fontFamily: "Inter_900Black" },
  tallyLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, borderWidth: 1 },
  chip: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  chipText: { color: "#FFFFFF", fontSize: 11, fontFamily: "Inter_900Black" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  badge: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1 },
  rowAmt: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 16, paddingTop: 4 },
});

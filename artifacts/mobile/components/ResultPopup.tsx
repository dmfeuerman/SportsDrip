import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { Amount, Button, Pill } from "@/components/ui";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";

/**
 * Win / loss popups.
 *
 * One at a time, from the server-written notification queue. Wins get a
 * spring, a count-up and a success haptic; losses get the same layout in
 * clay with the stake and the balance it leaves — the consequence is on screen,
 * not buried. Nothing here decides an outcome: the popup only exists because
 * a settlement committed.
 */
export default function ResultPopupHost() {
  const { popup, waiting, dismissPopup, dismissAllPopups } = useNotifications();
  if (!popup) return null;
  return (
    <ResultPopup
      key={popup.id}
      n={popup}
      waiting={waiting}
      onDismiss={dismissPopup}
      onDismissAll={dismissAllPopups}
    />
  );
}

function useCountUp(target: number, ms = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ResultPopup({
  n,
  waiting,
  onDismiss,
  onDismissAll,
}: {
  n: AppNotification;
  waiting: number;
  onDismiss: () => void;
  onDismissAll: () => void;
}) {
  const c = useColors();
  const won = n.type === "bet_won" || n.type === "league_payout";
  const lost = n.type === "bet_lost";
  const bet = n.bet;
  const profit = bet ? bet.payout - bet.stake : n.delta;
  const big = won && bet ? bet.payout >= bet.stake * 3 || profit >= 1000 : n.type === "league_payout";
  const shown = useCountUp(Math.abs(won && bet ? profit : n.delta));
  const fired = useRef(false);

  const accent = won ? c.positive : lost ? c.negative : c.accent;
  const soft = won ? c.positiveSoft : lost ? c.negativeSoft : c.alpha(c.accent, 0.14);
  const currency = n.wallet === "league" ? "league" : "credits";

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    Haptics.notificationAsync(
      won ? Haptics.NotificationFeedbackType.Success : lost ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success
    ).catch(() => {});
    AccessibilityInfo.announceForAccessibility(`${n.title}. ${n.body}`);
  }, [won, lost, n.title, n.body]);

  const my = bet ? (bet.side === "home" ? bet.finalHomeScore : bet.finalAwayScore) : null;
  const their = bet ? (bet.side === "home" ? bet.finalAwayScore : bet.finalHomeScore) : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
        <Animated.View
          entering={ZoomIn.springify().damping(14).stiffness(160)}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(accent, big ? 0.9 : 0.45), shadowColor: accent }]}
        >
          {bet && <View style={[styles.stripe, { backgroundColor: bet.teamColor }]} />}

          <View style={styles.top}>
            <View style={[styles.iconRing, { backgroundColor: soft, borderColor: c.alpha(accent, 0.5) }]}>
              <MaterialCommunityIcons
                name={won ? (big ? "trophy" : "check-decagram") : lost ? "close-octagon-outline" : n.type === "league_ended" ? "flag-checkered" : "bell-ring-outline"}
                size={34}
                color={accent}
              />
            </View>
            <View style={styles.pills}>
              <Pill
                label={won ? (big ? "BIG WIN" : "WIN") : lost ? "LOSS" : n.type === "bet_push" ? "PUSH" : "UPDATE"}
                tone={won ? "positive" : lost ? "negative" : "accent"}
                icon={won ? "arrow-up-bold" : lost ? "arrow-down-bold" : undefined}
              />
              {n.leagueName ? <Pill label={n.leagueName} tone="league" icon="shield-star" /> : null}
            </View>
            <Text style={[styles.title, { color: c.foreground }]} accessibilityRole="header">
              {n.title}
            </Text>
            {bet && my !== null && their !== null ? (
              <Text style={[styles.score, { color: c.mutedForeground }]}>
                Final · {bet.teamAbbr} {my}–{their} {bet.opponentAbbr}
              </Text>
            ) : (
              <Text style={[styles.score, { color: c.mutedForeground }]}>{n.body}</Text>
            )}
          </View>

          <View style={[styles.hero, { backgroundColor: soft }]}>
            <Text style={[styles.heroLabel, { color: accent }]}>
              {won ? (bet ? "PROFIT" : "PRIZE") : lost ? "STAKE LOST" : "AMOUNT"}
            </Text>
            <Amount value={won ? shown : lost ? -shown : shown} currency={currency} size="xl" signed tone={won ? "positive" : lost ? "negative" : "neutral"} />
          </View>

          {bet && (
            <View style={styles.rows}>
              <Row label="Your pick" value={`${bet.teamName} · ${bet.odds.toFixed(2)}x`} />
              <Row label="Stake" value={bet.stake.toLocaleString()} />
              <Row label={won ? "Paid out" : "Returned"} value={(won ? bet.payout : 0).toLocaleString()} />
            </View>
          )}
          {n.balanceAfter !== null && (
            <View style={[styles.balance, { borderTopColor: c.border }]}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
                {currency === "league" ? `${n.leagueName ?? "League"} balance` : "New balance"}
              </Text>
              <Amount value={n.balanceAfter} currency={currency} />
            </View>
          )}

          <View style={styles.actions}>
            {bet && (
              <Button
                label="My bets"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  onDismiss();
                  router.push(n.leagueId ? { pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } } : "/bets");
                }}
              />
            )}
            <Button label={won ? "Collect" : "Got it"} style={{ flex: 1 }} onPress={onDismiss} haptic={false} />
          </View>
          {waiting > 0 && (
            <Pressable accessibilityRole="button" onPress={onDismissAll} style={styles.more} hitSlop={8}>
              <Text style={[styles.moreText, { color: c.mutedForeground }]}>
                {waiting} more result{waiting > 1 ? "s" : ""} · <Text style={{ color: c.accent }}>Skip all</Text>
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: c.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 26,
    borderWidth: 1.5,
    overflow: "hidden",
    paddingBottom: 16,
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  stripe: { height: 5, width: "100%" },
  top: { alignItems: "center", paddingHorizontal: 20, paddingTop: 20, gap: 8 },
  iconRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pills: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  title: { fontSize: 21, lineHeight: 26, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.3 },
  score: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  hero: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, paddingVertical: 14, alignItems: "center", gap: 2 },
  heroLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  rows: { paddingHorizontal: 20, paddingTop: 14, gap: 7 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "right" },
  balance: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginHorizontal: 20, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 16 },
  more: { alignSelf: "center", marginTop: 12 },
  moreText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

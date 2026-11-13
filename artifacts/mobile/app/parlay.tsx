import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "@/components/fx/Tap";
import NumericInput from "@/components/NumericInput";
import TokenBalance from "@/components/TokenBalance";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { Button } from "@/components/ui";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { MAX_SLIP_LEGS, MAX_SLIP_ODDS, slipOdds, useParlay, type SlipLeg } from "@/context/ParlayContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";
import { formatOdds, kickoffLabel } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { tourEvent, tourPractice } from "@/lib/tour/store";

const QUICK = [250, 500, 1000, 2500];
const MIN_STAKE = 10;
const MARKET_NAME: Record<SlipLeg["market"], string> = { ml: "Moneyline", spread: "Spread", total: "Total" };

/**
 * The parlay slip as a full checkout screen, the way sportsbook apps show it:
 * every leg with its game, market and price; the prices multiplied out in
 * front of you; stake; payout; one button to place. Opened from the floating
 * "Parlay" button that appears once a pick is added.
 */
export default function ParlayScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const fmt = useOddsFormat();
  const { legs, remove, clear } = useParlay();
  const { balance } = useApp();
  const { show, betLocked } = useToast();
  const [stake, setStake] = useState("");
  const [howOpen, setHowOpen] = useState(true);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef);

  const odds = slipOdds(legs);
  const amount = Math.floor(Number(stake) || 0);
  const ready = legs.length >= 2;
  const short = amount > balance;
  const payout = Math.round(amount * odds);
  const capped = legs.reduce((p, l) => p * l.odds, 1) > MAX_SLIP_ODDS;
  const canPlace = ready && amount >= MIN_STAKE && !short;

  useEffect(() => {
    if (amount >= MIN_STAKE) tourEvent("parlay:stake");
  }, [amount]);

  const closePlaced = () => {
    clear();
    tourEvent("parlay:placed");
    if (!tourPractice()) back();
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/games"));
  const addMore = () => router.navigate("/(tabs)/games");

  const place = () => {
    if (!canPlace) return;
    const n = legs.length;
    const practice = tourPractice();
    haptic.success();
    betLocked({
      test: practice,
      teamName: `${n}-leg parlay`,
      pickLabel: `${n}-leg parlay`,
      teamAbbr: `${n}L`,
      teamColor: c.primary,
      odds,
      stake: amount,
      payout,
      currency: "credits",
      walletLabel: practice ? "Test — nothing staked" : legs.map((l) => l.label).join(" · "),
    });
    if (!practice) {
      const sent = legs.map((l) => ({ gameId: l.gameId, market: l.market, selection: l.selection }));
      api.placeParlay({ legs: sent, stake: amount, idempotencyKey: api.newIdempotencyKey() }).catch((e) => {
        haptic.error();
        show({ kind: "warning", title: "Parlay didn't go through", body: `${api.friendlyError(e)} You weren't charged.` });
      });
    }
    closePlaced();
  };

  const top = (Platform.OS === "web" ? 12 : insets.top) + 6;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: top, borderBottomColor: c.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={10} style={[styles.round, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Parlay Slip</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {legs.length} {legs.length === 1 ? "leg" : "legs"} · {MAX_SLIP_LEGS} max
          </Text>
        </View>
        <TokenBalance tokens={balance} size="sm" />
      </View>

      <ScrollView ref={scrollRef} onScroll={tourScroll.onScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <tourScroll.Provider>
          {/* How it works */}
          <TourTarget id="parlay.how">
            <Pressable onPress={() => setHowOpen((v) => !v)} style={[styles.card, { backgroundColor: c.alpha(c.primary, 0.08), borderColor: c.alpha(c.primary, 0.4) }]}>
              <View style={styles.row}>
                <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={c.primary} />
                <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>How a parlay works</Text>
                <MaterialCommunityIcons name={howOpen ? "chevron-up" : "chevron-down"} size={20} color={c.mutedForeground} />
              </View>
              {howOpen ? (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {[
                    ["numeric-1-circle", "Pick from different games", "Tap a price on a game, then “+ Parlay”. One pick per game, 2 to 10 legs."],
                    ["numeric-2-circle", "The prices multiply", "Two 2.00x legs make a 4.00x ticket. More legs, bigger payout — and harder to hit."],
                    ["numeric-3-circle", "Every leg has to win", "One losing leg loses the whole parlay. A push or a cancelled game drops that leg and the price shrinks."],
                  ].map(([icon, t, d]) => (
                    <View key={t} style={styles.howRow}>
                      <MaterialCommunityIcons name={icon as never} size={20} color={c.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.howTitle, { color: c.foreground }]}>{t}</Text>
                        <Text style={[styles.sub, { color: c.mutedForeground }]}>{d}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          </TourTarget>

          {/* Legs */}
          <TourTarget id="parlay.legs" style={{ gap: 8 }}>
            <View style={styles.row}>
              <Text style={[styles.section, { color: c.foreground, flex: 1 }]}>Your legs</Text>
              {legs.length ? (
                <Pressable accessibilityRole="button" onPress={clear} hitSlop={8}>
                  <Text style={[styles.link, { color: c.mutedForeground }]}>Clear all</Text>
                </Pressable>
              ) : null}
            </View>
            {legs.map((l, i) => (
              <View key={l.gameId} style={[styles.leg, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={[styles.legNum, { backgroundColor: c.alpha(c.primary, 0.15) }]}>
                  <Text style={[styles.legNumText, { color: c.primary }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.legLabel, { color: c.foreground }]} numberOfLines={1}>{l.label}</Text>
                  <View style={styles.row}>
                    <MaterialCommunityIcons name={(SPORT_ICONS[l.sport as keyof typeof SPORT_ICONS] ?? "trophy") as never} size={13} color={c.mutedForeground} />
                    <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
                      {MARKET_NAME[l.market]} · {l.matchup} · {kickoffLabel(l.startsAt)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.legOdds, { color: c.foreground }]}>{formatOdds(l.odds, fmt)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${l.label}`} hitSlop={8} onPress={() => remove(l.gameId)}>
                  <MaterialCommunityIcons name="close-circle" size={20} color={c.mutedForeground} />
                </Pressable>
              </View>
            ))}
            {legs.length < MAX_SLIP_LEGS ? (
              <Pressable onPress={addMore} style={[styles.addLeg, { borderColor: c.border }]}>
                <MaterialCommunityIcons name="plus-circle-outline" size={18} color={c.primary} />
                <Text style={[styles.link, { color: c.primary }]}>{ready ? "Add another leg" : "Add a leg from another game"}</Text>
              </Pressable>
            ) : null}
          </TourTarget>

          {/* The math */}
          <TourTarget id="parlay.math">
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>COMBINED PRICE</Text>
              <Text style={[styles.math, { color: c.mutedForeground }]}>
                {legs.length ? legs.map((l) => `${l.odds.toFixed(2)}x`).join("  ×  ") : "—"}
              </Text>
              <Text style={[styles.big, { color: ready ? c.primary : c.mutedForeground }]}>= {ready ? formatOdds(odds, fmt) : "needs 2 legs"}</Text>
              {capped ? <Text style={[styles.sub, { color: c.warning }]}>Parlays are capped at {MAX_SLIP_ODDS}x.</Text> : null}
            </View>
          </TourTarget>

          {/* Stake */}
          <TourTarget id="parlay.stake" style={{ gap: 8 }}>
            <Text style={[styles.section, { color: c.foreground }]}>Stake</Text>
            <View style={styles.row}>
              <NumericInput
                value={stake}
                onChangeText={(t) => setStake(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder={`Credits (min ${MIN_STAKE})`}
                placeholderTextColor={c.subtleForeground}
                style={[styles.input, { color: c.foreground, borderColor: short ? c.negative : c.border, backgroundColor: c.secondary }]}
              />
            </View>
            <View style={styles.row}>
              {QUICK.map((q) => (
                <Pressable key={q} onPress={() => setStake(String(q))} style={[styles.quick, { borderColor: amount === q ? c.primary : c.border, backgroundColor: amount === q ? c.alpha(c.primary, 0.15) : c.secondary }]}>
                  <Text style={[styles.quickText, { color: c.foreground }]}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </TourTarget>

          {/* Receipt */}
          <TourTarget id="parlay.summary">
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, gap: 8 }]}>
              <Line label="Stake" value={amount ? amount.toLocaleString() : "—"} c={c} />
              <Line label="Combined price" value={ready ? formatOdds(odds, fmt) : "—"} c={c} />
              <Line label="Pays if every leg hits" value={ready && amount ? payout.toLocaleString() : "—"} c={c} strong />
              <Line label="Profit" value={ready && amount ? `+${(payout - amount).toLocaleString()}` : "—"} c={c} color={c.positive} />
              <Line label="If any leg loses" value={amount ? `−${amount.toLocaleString()}` : "—"} c={c} color={amount ? c.negative : undefined} />
              <Line label="Balance after" value={(balance - amount).toLocaleString()} c={c} color={short ? c.negative : undefined} />
            </View>
          </TourTarget>
          {short ? <Text style={[styles.sub, { color: c.negative }]}>You have {balance.toLocaleString()} credits.</Text> : null}
        </tourScroll.Provider>
      </ScrollView>


      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background, paddingBottom: insets.bottom + 12 }]}>
        <TourTarget id="parlay.place">
          <Button
            label={!ready ? "Add at least 2 legs" : amount < MIN_STAKE ? `Enter a stake (min ${MIN_STAKE})` : tourPractice() ? "Place test parlay" : `Place ${legs.length}-leg parlay · ${amount.toLocaleString()}`}
            icon="lock"
            size="lg"
            disabled={!canPlace}
            onPress={place}
          />
        </TourTarget>
      </View>
    </View>
  );
}

function Line({ label, value, c, strong, color }: { label: string; value: string; c: ReturnType<typeof useColors>; strong?: boolean; color?: string }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.sub, { color: c.mutedForeground, fontSize: 13 }]}>{label}</Text>
      <Text style={[strong ? styles.lineStrong : styles.lineValue, { color: color ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  popWrap: { flex: 1, backgroundColor: "rgba(4,10,24,0.85)", alignItems: "center", justifyContent: "center", padding: 24 },
  popCard: { width: "100%", maxWidth: 400, borderRadius: 22, borderWidth: 2, padding: 22, gap: 14, alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  howRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  howTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  section: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  link: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  k: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  leg: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  legNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  legNumText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  legLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  legOdds: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  addLeg: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, paddingVertical: 12 },
  math: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 6, fontVariant: ["tabular-nums"] },
  big: { fontSize: 26, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], marginTop: 2 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontFamily: "Inter_700Bold" },
  quick: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 9 },
  quickText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  lineValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  lineStrong: { fontSize: 17, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
});

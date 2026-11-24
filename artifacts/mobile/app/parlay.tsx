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
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
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
 * 2026 Liquid Glass Parlay Slip:
 * Combined multiplier Bento hero card up top, translucent glass leg cards,
 * tactile glass stake input + quick pills, receipt card, and frosted footer.
 */
export default function ParlayScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const fmt = useOddsFormat();
  const { legs, remove, clear } = useParlay();
  const { balance } = useApp();
  const { show, betLocked } = useToast();
  const [stake, setStake] = useState("");
  const [howOpen, setHowOpen] = useState(false);
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
      <ObsidianBackdrop />
      <LiquidGlass
        variant="bar"
        borderColor={c.isDark ? c.alpha("#FFFFFF", 0.14) : c.alpha(c.foreground, 0.1)}
        contentStyle={[styles.header, { paddingTop: top }]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={10}>
          <LiquidGlass variant="pill" interactive contentStyle={styles.round}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={c.foreground} />
          </LiquidGlass>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Parlay Slip</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {legs.length} {legs.length === 1 ? "leg" : "legs"} · {MAX_SLIP_LEGS} max
          </Text>
        </View>
        <TokenBalance tokens={balance} size="sm" glass />
      </LiquidGlass>

      <ScrollView ref={scrollRef} onScroll={tourScroll.onScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <tourScroll.Provider>
          {/* 2026 Luminous Hero Multiplier Bento Card */}
          <TourTarget id="parlay.math">
            <LiquidGlass variant="hero" borderColor={ready ? c.alpha(c.primary, 0.55) : undefined} contentStyle={styles.heroCard}>
              <GlassDomeSheen id="parlay_math" glowColor={c.primary} intensity={ready ? 0.40 : 0.18} />
              <View style={styles.heroTopRow}>
                <Text style={[styles.k, { color: c.mutedForeground }]}>COMBINED MULTIPLIER</Text>
                {ready && amount > 0 ? (
                  <View style={[styles.payoutPill, { backgroundColor: c.alpha(c.positive, 0.18), borderColor: c.alpha(c.positive, 0.45) }]}>
                    <Text style={[styles.payoutPillText, { color: c.positive }]}>PAYS {payout.toLocaleString()}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.big, { color: ready ? c.primary : c.mutedForeground }]}>
                {ready ? formatOdds(odds, fmt) : "Needs 2 legs"}
              </Text>
              <Text style={[styles.math, { color: c.mutedForeground }]}>
                {legs.length ? legs.map((l) => `${l.odds.toFixed(2)}x`).join("  ×  ") : "Add picks from 2+ different games"}
              </Text>
              {capped ? <Text style={[styles.sub, { color: c.warning }]}>Parlays are capped at {MAX_SLIP_ODDS}x.</Text> : null}
            </LiquidGlass>
          </TourTarget>

          {/* Legs */}
          <TourTarget id="parlay.legs" style={{ gap: 8 }}>
            <View style={styles.row}>
              <Text style={[styles.section, { color: c.foreground, flex: 1 }]}>YOUR LEGS ({legs.length})</Text>
              {legs.length ? (
                <Pressable accessibilityRole="button" onPress={clear} hitSlop={8}>
                  <Text style={[styles.link, { color: c.mutedForeground }]}>Clear all</Text>
                </Pressable>
              ) : null}
            </View>
            {legs.map((l, i) => (
              <LiquidGlass key={l.gameId} variant="card" contentStyle={styles.leg}>
                <View style={[styles.legNum, { backgroundColor: c.alpha(c.primary, 0.18) }]}>
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
                <Text style={[styles.legOdds, { color: c.primary }]}>{formatOdds(l.odds, fmt)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${l.label}`} hitSlop={8} onPress={() => remove(l.gameId)}>
                  <MaterialCommunityIcons name="close-circle" size={20} color={c.mutedForeground} />
                </Pressable>
              </LiquidGlass>
            ))}
            {legs.length < MAX_SLIP_LEGS ? (
              <Pressable onPress={addMore} style={[styles.addLeg, { borderColor: c.alpha(c.primary, 0.45), backgroundColor: c.alpha(c.primary, 0.08) }]}>
                <MaterialCommunityIcons name="plus-circle-outline" size={18} color={c.primary} />
                <Text style={[styles.link, { color: c.primary }]}>{ready ? "Add another leg" : "Add a leg from another game"}</Text>
              </Pressable>
            ) : null}
          </TourTarget>

          {/* Stake */}
          <TourTarget id="parlay.stake" style={{ gap: 8 }}>
            <Text style={[styles.section, { color: c.foreground }]}>STAKE</Text>
            <LiquidGlass variant="tile" radius={16} borderColor={short ? c.negative : undefined} contentStyle={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              <NumericInput
                value={stake}
                onChangeText={(t) => setStake(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder={`Credits (min ${MIN_STAKE})`}
                placeholderTextColor={c.subtleForeground}
                style={[styles.input, { color: c.foreground }]}
              />
            </LiquidGlass>
            <View style={styles.row}>
              {QUICK.map((q) => (
                <Pressable key={q} onPress={() => setStake(String(q))} style={{ flex: 1 }}>
                  <LiquidGlass
                    variant="pill"
                    interactive
                    tintColor={amount === q ? c.alpha(c.primary, 0.22) : undefined}
                    borderColor={amount === q ? c.primary : undefined}
                    contentStyle={styles.quick}
                  >
                    <Text style={[styles.quickText, { color: amount === q ? c.primary : c.foreground }]}>{q}</Text>
                  </LiquidGlass>
                </Pressable>
              ))}
            </View>
          </TourTarget>

          {/* Receipt */}
          <TourTarget id="parlay.summary">
            <LiquidGlass variant="card" contentStyle={[styles.card, { gap: 8 }]}>
              <Line label="Stake" value={amount ? amount.toLocaleString() : "—"} c={c} />
              <Line label="Combined price" value={ready ? formatOdds(odds, fmt) : "—"} c={c} />
              <Line label="Pays if every leg hits" value={ready && amount ? payout.toLocaleString() : "—"} c={c} strong />
              <Line label="Profit" value={ready && amount ? `+${(payout - amount).toLocaleString()}` : "—"} c={c} color={c.positive} />
              <Line label="If any leg loses" value={amount ? `−${amount.toLocaleString()}` : "—"} c={c} color={amount ? c.negative : undefined} />
              <Line label="Balance after" value={(balance - amount).toLocaleString()} c={c} color={short ? c.negative : undefined} />
            </LiquidGlass>
          </TourTarget>
          {short ? <Text style={[styles.sub, { color: c.negative }]}>You have {balance.toLocaleString()} credits.</Text> : null}

          {/* How it works (compact collapsible glass card at bottom so action stays first) */}
          <TourTarget id="parlay.how">
            <Pressable onPress={() => setHowOpen((v) => !v)}>
              <LiquidGlass variant="tile" radius={18} tintColor={c.alpha(c.primary, 0.08)} borderColor={c.alpha(c.primary, 0.35)} contentStyle={styles.card}>
                <View style={styles.row}>
                  <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={c.primary} />
                  <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>How a parlay works</Text>
                  <MaterialCommunityIcons name={howOpen ? "chevron-up" : "chevron-down"} size={20} color={c.mutedForeground} />
                </View>
                {howOpen ? (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {[
                      ["numeric-1-circle", "Pick from different games", "Tap a price, then Add to Parlay on the slip. After that, each tap adds a leg. One pick per game, 2 to 10 legs."],
                      ["numeric-2-circle", "The prices multiply", "Two 2.00x legs make a 4.00x ticket. More legs, bigger payout — and harder to hit."],
                      ["numeric-3-circle", "Every leg has to win", "One losing leg loses the whole parlay. A push or a canceled game drops that leg and the price shrinks."],
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
              </LiquidGlass>
            </Pressable>
          </TourTarget>
        </tourScroll.Provider>
      </ScrollView>

      <LiquidGlass variant="bar" contentStyle={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TourTarget id="parlay.place">
          <Button
            label={!ready ? "Add at least 2 legs" : amount < MIN_STAKE ? `Enter a stake (min ${MIN_STAKE})` : tourPractice() ? "Place test parlay" : `Place ${legs.length}-leg parlay · ${amount.toLocaleString()}`}
            icon="lock"
            size="lg"
            disabled={!canPlace}
            onPress={place}
          />
        </TourTarget>
      </LiquidGlass>
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
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  round: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: -0.4 },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  heroCard: { padding: 18, gap: 4 },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  payoutPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  payoutPillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  card: { padding: 16 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  howRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  howTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  section: { fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1 },
  link: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  k: { fontSize: 10.5, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.0 },
  leg: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
  legNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  legNumText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  legLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  legOdds: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  addLeg: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 16, paddingVertical: 13 },
  math: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", marginTop: 4, fontVariant: ["tabular-nums"] },
  big: { fontSize: 32, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], marginTop: 2, letterSpacing: -0.8 },
  input: { flex: 1, paddingVertical: 10, fontSize: 20, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  quick: { alignItems: "center", paddingVertical: 9 },
  quickText: { fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  lineValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  lineStrong: { fontSize: 17, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  footer: { paddingHorizontal: 16, paddingTop: 12 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import KeyboardSheet from "@/components/KeyboardSheet";
import NumericInput from "@/components/NumericInput";
import { Button } from "@/components/ui";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { slipOdds, useParlay } from "@/context/ParlayContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";
import { formatOdds } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";

const QUICK = [50, 100, 250, 500];
const TAB_BAR = 72;

/**
 * The parlay bet slip: a pill above the tab bar while it has picks, and the
 * sheet it opens — legs, combined price, stake and payout. Placing is
 * instant: the slip closes and the server confirms behind it.
 */
export default function ParlaySlip() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const fmt = useOddsFormat();
  const { legs, remove, clear, open, setOpen } = useParlay();
  const { balance } = useApp();
  const { show } = useToast();
  const [stake, setStake] = useState("100");

  if (!legs.length) return null;
  const odds = slipOdds(legs);
  const amount = Math.floor(Number(stake) || 0);
  const ready = legs.length >= 2;
  const short = amount > balance;
  const payout = Math.round(amount * odds);

  const place = () => {
    if (!ready || amount < 10 || short) return;
    const sent = legs.map((l) => ({ gameId: l.gameId, market: l.market, selection: l.selection }));
    const n = legs.length;
    haptic.success();
    setOpen(false);
    clear();
    show({ id: `parlay_${Date.now()}`, kind: "info", icon: "link-variant", title: `${n}-leg parlay locked in`, body: `${amount.toLocaleString()} at ${formatOdds(odds, fmt)} · to win ${(payout - amount).toLocaleString()}`, href: "/bets", cta: "View" });
    api.placeParlay({ legs: sent, stake: amount, idempotencyKey: api.newIdempotencyKey() }).catch((e) => {
      haptic.error();
      show({ kind: "warning", title: "Parlay didn't go through", body: `${api.friendlyError(e)} You weren't charged.` });
    });
  };

  return (
    <>
      {!open ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.pillWrap, { bottom: insets.bottom + TAB_BAR + 44 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Parlay slip, ${legs.length} legs`}
            onPress={() => setOpen(true)}
            style={[styles.pill, { backgroundColor: c.primary }]}
          >
            <MaterialCommunityIcons name="link-variant" size={16} color="#000" />
            <Text style={styles.pillText}>
              Parlay · {legs.length} {legs.length === 1 ? "leg" : "legs"}
              {ready ? ` · ${formatOdds(odds, fmt)}` : " · add 1 more"}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      <KeyboardSheet visible={open} onClose={() => setOpen(false)} maxHeight="85%">
        <View style={styles.sheet}>
          <View style={styles.head}>
            <MaterialCommunityIcons name="link-variant" size={20} color={c.primary} />
            <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>Parlay Slip</Text>
            <Pressable accessibilityRole="button" onPress={clear} hitSlop={8}>
              <Text style={[styles.link, { color: c.mutedForeground }]}>Clear</Text>
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>Every leg has to hit. The prices multiply. One pick per game, 2–10 legs.</Text>

          {legs.map((l) => (
            <View key={l.gameId} style={[styles.leg, { borderColor: c.border, backgroundColor: c.secondary }]}>
              <MaterialCommunityIcons name={(SPORT_ICONS[l.sport as keyof typeof SPORT_ICONS] ?? "trophy") as never} size={16} color={c.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.legLabel, { color: c.foreground }]} numberOfLines={1}>
                  {l.label}
                </Text>
                <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
                  {l.matchup}
                </Text>
              </View>
              <Text style={[styles.legOdds, { color: c.foreground }]}>{formatOdds(l.odds, fmt)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${l.label}`} hitSlop={8} onPress={() => remove(l.gameId)}>
                <MaterialCommunityIcons name="close-circle" size={20} color={c.mutedForeground} />
              </Pressable>
            </View>
          ))}

          <View style={[styles.total, { borderColor: c.border }]}>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Combined price</Text>
            <Text style={[styles.big, { color: c.primary }]}>{ready ? formatOdds(odds, fmt) : "—"}</Text>
          </View>

          <View style={styles.stakeRow}>
            <NumericInput
              value={stake}
              onChangeText={(t) => setStake(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="Stake"
              placeholderTextColor={c.subtleForeground}
              style={[styles.input, { color: c.foreground, borderColor: short ? c.negative : c.border, backgroundColor: c.secondary }]}
            />
            {QUICK.map((q) => (
              <Pressable key={q} onPress={() => setStake(String(q))} style={[styles.quick, { borderColor: c.border, backgroundColor: amount === q ? c.alpha(c.primary, 0.18) : c.secondary }]}>
                <Text style={[styles.quickText, { color: c.foreground }]}>{q}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.sub, { color: short ? c.negative : c.mutedForeground }]}>
            {short ? `You have ${balance.toLocaleString()} credits.` : ready && amount >= 10 ? `Pays ${payout.toLocaleString()} (+${(payout - amount).toLocaleString()}) if every leg hits.` : ready ? "Minimum stake is 10." : "Add at least one more pick from another game."}
          </Text>

          <Button label={ready ? `Place ${legs.length}-Leg Parlay` : "Add Another Leg"} icon="lock" disabled={!ready || amount < 10 || short} onPress={place} />
        </View>
      </KeyboardSheet>
    </>
  );
}

const styles = StyleSheet.create({
  pillWrap: { position: "absolute", right: 16, zIndex: 40 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  pillText: { color: "#000", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  sheet: { gap: 12, padding: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  link: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  leg: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  legLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  legOdds: { fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 10 },
  big: { fontSize: 22, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  stakeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, fontFamily: "Inter_700Bold" },
  quick: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 8 },
  quickText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

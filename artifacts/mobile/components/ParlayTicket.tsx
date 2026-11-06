import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Pill } from "@/components/ui";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import type { ParlayDoc } from "@/hooks/useMyParlays";
import { formatOdds } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";

const LEG_ICON = { pending: "circle-outline", won: "check-circle", lost: "close-circle", push: "minus-circle", void: "minus-circle-outline" } as const;

/** A bet-slip parlay in My Bets: every leg with its result, the price and the payout. */
export default function ParlayTicket({ p, onCancel, busy }: { p: ParlayDoc; onCancel?: () => void; busy?: boolean }) {
  const c = useColors();
  const fmt = useOddsFormat();
  const tone = p.status === "won" ? c.positive : p.status === "lost" ? c.negative : p.status === "pending" ? c.primary : c.push;
  const label = p.status === "pending" ? (p.legs.some((l) => l.status !== "pending") ? "Live" : "Open") : p.status === "won" ? "Won" : p.status === "lost" ? "Lost" : p.status === "push" ? "Push" : "Cancelled";
  const canCancel = p.status === "pending" && p.firstStartsAt > Date.now() && !!onCancel;
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.alpha(tone, 0.45) }]}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="link-variant" size={18} color={tone} />
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>{p.legs.length}-Leg Parlay</Text>
        <Pill label={label} tone={p.status === "won" ? "positive" : p.status === "lost" ? "negative" : "accent"} />
      </View>
      {p.legs.map((l, i) => (
        <View key={`${l.gameId}_${i}`} style={styles.leg}>
          <MaterialCommunityIcons name={LEG_ICON[l.status]} size={16} color={l.status === "won" ? c.positive : l.status === "lost" ? c.negative : c.mutedForeground} />
          <MaterialCommunityIcons name={(SPORT_ICONS[l.sport as keyof typeof SPORT_ICONS] ?? "trophy") as never} size={13} color={c.subtleForeground} />
          <Text style={[styles.legText, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
            {l.label} <Text style={{ color: c.mutedForeground }}>vs {l.opponentAbbr}</Text>
          </Text>
          <Text style={[styles.legText, { color: c.mutedForeground }]}>{formatOdds(l.odds, fmt)}</Text>
        </View>
      ))}
      <View style={[styles.foot, { borderTopColor: c.border }]}>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          Stake {p.stake.toLocaleString()} · {formatOdds(p.odds, fmt)}
        </Text>
        <Text style={[styles.pay, { color: tone }]}>
          {p.status === "won" ? `+${(p.potentialPayout - p.stake).toLocaleString()}` : p.status === "lost" ? `−${p.stake.toLocaleString()}` : `Pays ${p.potentialPayout.toLocaleString()}`}
        </Text>
      </View>
      {canCancel ? (
        <Pressable onPress={onCancel} disabled={busy} style={[styles.cancel, { borderColor: c.alpha(c.foreground, 0.25), opacity: busy ? 0.5 : 1 }]}>
          <MaterialCommunityIcons name="undo-variant" size={15} color={c.foreground} />
          <Text style={[styles.sub, { color: c.foreground }]}>Cancel and get the stake back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  leg: { flexDirection: "row", alignItems: "center", gap: 6 },
  legText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  pay: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  cancel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
});

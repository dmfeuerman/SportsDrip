import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { openSocialNotification } from "@/components/InviteToastHost";
import { Amount, Button, EmptyState, ScreenHeader, useBottomPad } from "@/components/ui";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";

const ICON: Record<AppNotification["type"], React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  bet_won: "arrow-up-bold-circle",
  bet_lost: "arrow-down-bold-circle",
  bet_push: "minus-circle",
  bet_refunded: "undo-variant",
  league_payout: "trophy",
  league_ended: "flag-checkered",
  league_invite: "email-outline",
  loan_funded: "handshake-outline",
  loan_repaid: "cash-refund",
  loan_countered: "swap-horizontal",
  loan_request: "hand-coin-outline",
  friend_request: "account-plus",
  friend_accepted: "account-check",
};

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Every result, payout, loan event and invite — the history behind the popups. */
export default function ActivityScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const now = useNow(60_000);
  const { notifications, unreadCount, markAllRead, markRead, refresh } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Opening the feed reads what's on it, after a beat so the unread dots are seen.
  useEffect(() => {
    if (!unreadCount) return;
    const t = setTimeout(markAllRead, 2500);
    return () => clearTimeout(t);
  }, [unreadCount, markAllRead]);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Activity" subtitle={unreadCount ? `${unreadCount} new` : "Results, payouts, loans and invites"} right={unreadCount ? <Button size="sm" variant="ghost" label="Mark read" onPress={markAllRead} /> : undefined} />
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.mutedForeground} />}
        renderItem={({ item: n }) => {
          const tone = n.type === "bet_won" || n.type === "league_payout" || n.type === "loan_repaid" ? c.positive : n.type === "bet_lost" ? c.negative : n.leagueId ? c.league : c.mutedForeground;
          const go = () => {
            markRead([n.id]);
            if ((n.type === "league_invite" && n.data?.code) || n.type === "friend_request" || n.type === "friend_accepted") openSocialNotification(n);
            else if (n.leagueId) router.push({ pathname: "/league/[id]", params: { id: n.leagueId, tab: n.type.startsWith("loan") ? "bank" : n.bet ? "bets" : "standings" } });
            else if (n.bet) router.push("/bets");
          };
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}`} onPress={go} style={({ pressed }) => [styles.row, { backgroundColor: n.read ? c.card : c.elevated, borderColor: n.read ? c.border : c.alpha(tone, 0.4), opacity: pressed ? 0.85 : 1 }]}>
              <View style={[styles.icon, { backgroundColor: c.alpha(tone, 0.14) }]}>
                <MaterialCommunityIcons name={ICON[n.type] ?? "bell-outline"} size={20} color={tone} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={[styles.body, { color: c.mutedForeground }]} numberOfLines={2}>
                  {n.body}
                </Text>
                {n.type === "league_invite" && <Text style={[styles.cta, { color: c.accent }]}>Tap to join</Text>}
                {n.type === "friend_request" && <Text style={[styles.cta, { color: c.accent }]}>Tap to respond</Text>}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={[styles.time, { color: c.subtleForeground }]}>{ago(n.createdAtMs, now)}</Text>
                {n.delta !== 0 && (n.bet || n.type === "league_payout" || n.type === "loan_repaid") ? (
                  <Amount value={n.type === "bet_won" && n.bet ? n.bet.payout - n.bet.stake : n.delta} currency={n.wallet === "league" ? "league" : "credits"} size="sm" signed tone={n.delta > 0 ? "positive" : "negative"} />
                ) : null}
                {!n.read && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState icon="bell-sleep-outline" title="All quiet" body="Bet results, league payouts, loan updates and invites will show up here." />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  body: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  cta: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  time: { fontSize: 11, fontFamily: "Inter_500Medium" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

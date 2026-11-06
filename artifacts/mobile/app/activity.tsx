import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import GameQuickView from "@/components/GameQuickView";
import { openSocialNotification } from "@/components/InviteToastHost";
import { Amount, EmptyState, ScreenHeader, useBottomPad } from "@/components/ui";
import { isChallenge, isLoss, isWin, useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";

const ICON: Record<AppNotification["type"], React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  bet_won: "arrow-up-bold-circle",
  level_up: "star-circle",
  team_reminder: "bell-ring-outline",
  reaction: "emoticon-happy-outline",
  sweat_alert: "fire",
  achievement: "trophy-award",
  referral_bonus: "account-heart",
  gift_received: "gift-outline",
  credits_received: "cash-fast",
  birthday_gift: "cake-variant",
  win_back: "hand-wave-outline",
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
  challenge_received: "sword-cross",
  challenge_accepted: "lock",
  challenge_declined: "close-circle-outline",
  challenge_cancelled: "close-circle-outline",
  challenge_expired: "timer-sand",
  challenge_won: "trophy",
  challenge_lost: "arrow-down-bold-circle",
  challenge_push: "minus-circle",
  challenge_refunded: "undo-variant",
  bet_tailed: "account-multiple-plus",
  bet_faded: "account-switch",
  stimulus_request: "cash-plus",
  stimulus_approved: "cash-plus",
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
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  const [quickGame, setQuickGame] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Opening Activity clears its badge at once; what was new stays highlighted
  // here until you leave.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!unreadCount) return;
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    setFresh((prev) => new Set([...prev, ...ids]));
    markAllRead();
  }, [unreadCount, notifications, markAllRead]);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Activity" subtitle={fresh.size ? `${fresh.size} new` : "Results, payouts, loans and invites"} />
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.mutedForeground} />}
        renderItem={({ item: n }) => {
          const tone = isWin(n) || n.type === "league_payout" || n.type === "loan_repaid" || n.type === "level_up" || n.type === "referral_bonus" ? c.positive : isLoss(n) ? c.negative : n.leagueId ? c.league : isChallenge(n) ? c.accent : c.mutedForeground;
          const go = () => {
            markRead([n.id]);
            if (n.bet) {
              setBreakdown({
                id: n.bet.betId,
                gameId: n.bet.gameId,
                sport: n.bet.sport,
                teamName: n.bet.teamName,
                teamAbbr: n.bet.teamAbbr,
                teamColor: n.bet.teamColor,
                opponentAbbr: n.bet.opponentAbbr,
                side: n.bet.side,
                market: n.type.startsWith("challenge_") ? "challenge" : "ml",
                odds: n.bet.odds,
                stake: n.bet.stake,
                payout: n.bet.payout,
                status: isWin(n) ? "won" : isLoss(n) ? "lost" : n.type.includes("push") ? "push" : "cancelled",
                finalHomeScore: n.bet.finalHomeScore,
                finalAwayScore: n.bet.finalAwayScore,
                wallet: n.wallet,
                leagueId: n.leagueId,
                leagueName: n.leagueName,
                friendName: n.data?.friendName ?? null,
                settledAtMs: n.createdAtMs,
              });
              return;
            }
            // Every row goes somewhere: the most specific screen for its type, else its league, else the closest list.
            const gameId = n.data?.gameId;
            if ((n.type === "league_invite" && n.data?.code) || n.type === "friend_request" || n.type === "friend_accepted" || n.type === "referral_bonus" || n.type === "level_up" || isChallenge(n)) openSocialNotification(n);
            else if (n.type === "achievement") router.push("/trophies" as never);
            else if ((n.type === "team_reminder" || n.type === "sweat_alert") && gameId) setQuickGame(gameId);
            else if (n.leagueId && (n.type.startsWith("loan") || n.type.startsWith("stimulus"))) router.push({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "bank" } });
            else if (n.leagueId && (n.type === "bet_tailed" || n.type === "bet_faded" || n.type === "bet_refunded")) router.push({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } });
            else if (n.leagueId && n.type === "reaction") router.push({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "feed" } });
            else if (n.leagueId) router.push({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "standings" } });
            else if (n.type === "team_reminder" || n.type === "sweat_alert") router.push("/(tabs)/games");
            else if (n.type === "reaction") router.push("/feed" as never);
            else if (n.type.startsWith("loan") || n.type.startsWith("stimulus") || n.type === "league_ended" || n.type === "league_payout" || n.type === "league_invite") router.push("/(tabs)/leagues");
            else router.push("/bets");
          };
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}`} onPress={go} style={({ pressed }) => [styles.row, { backgroundColor: !fresh.has(n.id) ? c.card : c.elevated, borderColor: !fresh.has(n.id) ? c.border : c.alpha(tone, 0.4), opacity: pressed ? 0.85 : 1 }]}>
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
                {n.bet && <Text style={[styles.cta, { color: c.primary }]}>Tap for Full Bet Breakdown</Text>}
                {n.type === "league_invite" && <Text style={[styles.cta, { color: c.accent }]}>Tap to Join</Text>}
                {n.type === "friend_request" && <Text style={[styles.cta, { color: c.accent }]}>Tap to Respond</Text>}
                {n.type === "challenge_received" && <Text style={[styles.cta, { color: c.accent }]}>Tap to Accept or Decline</Text>}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={[styles.time, { color: c.subtleForeground }]}>{ago(n.createdAtMs, now)}</Text>
                {n.delta !== 0 && (n.bet || n.type === "league_payout" || n.type === "loan_repaid" || n.type === "level_up" || n.type === "referral_bonus") ? (
                  <Amount value={isWin(n) && n.bet ? n.bet.payout - n.bet.stake : n.delta} currency={n.wallet === "league" ? "league" : "credits"} size="sm" signed tone={n.delta > 0 ? "positive" : "negative"} />
                ) : null}
                {!n.read && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState icon="bell-sleep-outline" title="All Quiet" body="Bet results, league payouts, loan updates and invites will show up here." />}
      />
      <BetBreakdownModal
        item={breakdown}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => setQuickGame(gId)}
      />
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
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

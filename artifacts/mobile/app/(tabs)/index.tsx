import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useIsFocused } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import AvatarHero from "@/components/avatar/AvatarHero";
import BetTicket from "@/components/BetTicket";
import GameQuickView from "@/components/GameQuickView";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { Amount, Button, Card, EmptyState, IconButton, Pill, SectionHeader, useBottomPad, useTopPad } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { BOX_TIERS } from "@/constants/prizeTypes";
import { useApp } from "@/context/AppContext";
import { useLeague, useLeagueSummaries } from "@/context/LeagueContext";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";
import { useNow } from "@/hooks/useNow";
import { untilKickoff } from "@/lib/odds";

/**
 * Home: "where do I stand?" answered in one screen.
 *
 * Before, the app opened on the games board, and a player had to visit four
 * tabs to learn their balance, what was riding, how their leagues were going
 * and what they owed. This is the overview those tabs were missing — each card
 * is a summary with a single way into the full screen.
 */
export default function HomeScreen() {
  const c = useColors();
  const top = useTopPad();
  const bottom = useBottomPad();
  const now = useNow(30_000);

  const { profile, balance, bets, prizeBoxes, totalWon } = useApp();
  const { myLeagueBets, leagues } = useLeague();
  const { summaries, totalDebt } = useLeagueSummaries();
  const { notifications, unreadCount } = useNotifications();
  const { byId } = useCatalog();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const openCredit = bets.filter((b) => b.status === "pending");
  const openLeague = leagues.flatMap((l) => (myLeagueBets[l.id] ?? []).filter((b) => b.status === "pending").map((b) => ({ b, league: l.name })));
  const openTotal = openCredit.length + openLeague.length;
  const atRisk = openCredit.reduce((s, b) => s + b.stake, 0);
  const couldReturn = openCredit.reduce((s, b) => s + b.potentialPayout, 0);

  const results = notifications.filter((n) => n.bet).slice(0, 4);
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b) => b.status === "won").length;

  const readyBoxes = BOX_TIERS.filter((t) => {
    const b = prizeBoxes[t];
    return b.state === "ready" || (b.state === "waiting" && (b.readyAt ?? Infinity) <= now);
  });
  const idleBoxes = BOX_TIERS.filter((t) => prizeBoxes[t].state === "idle");
  const nextBox = BOX_TIERS.map((t) => prizeBoxes[t])
    .filter((b) => b.state === "waiting" && (b.readyAt ?? 0) > now)
    .sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0))[0];

  const name = profile?.displayName?.trim() || profile?.username || "there";
  const focused = useIsFocused();
  const [avatarGesture, setAvatarGesture] = useState(false);
  const [quickGame, setQuickGame] = useState<string | null>(null);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        scrollEnabled={!avatarGesture}
        contentContainerStyle={[styles.content, { paddingTop: top + 12, paddingBottom: bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Your character, live and head to toe, first thing on screen. Tap it for a celebration. */}
        <AvatarHero
          avatar={profile?.avatar ?? DEFAULT_AVATAR}
          equipped={profile?.equipped ?? {}}
          catalog={byId}
          active={focused}
          onGesture={setAvatarGesture}
          header={
            <>
              <Text accessibilityRole="header" style={[styles.h1, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                Hello {name}
              </Text>
              <IconButton icon="bell-outline" label="Activity" badge={unreadCount} onPress={() => router.push("/activity")} />
            </>
          }
        />

        {/* Wallet */}
        <Card style={[styles.wallet, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.28) }]}>
          {/* Sportsbook-style wallet: a soft glow of the action colour behind the balance. */}
          <LinearGradient
            pointerEvents="none"
            colors={[c.alpha(c.primary, c.isDark ? 0.2 : 0.12), c.alpha(c.accent, 0.05), "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[styles.label, { color: c.mutedForeground }]}>CREDITS</Text>
          <Amount value={balance} size="xl" animate />
          <View style={styles.walletStats}>
            <WalletStat label="In play" value={atRisk.toLocaleString()} hint={`${openCredit.length} open`} />
            <WalletStat label="Could return" value={couldReturn.toLocaleString()} color={c.positive} />
            <WalletStat
              label="League debt"
              value={totalDebt.toLocaleString()}
              color={totalDebt > 0 ? c.debt : undefined}
              hint={totalDebt > 0 ? "flat interest" : "none"}
            />
          </View>
          <View style={styles.actions}>
            <Button label="Games" icon="scoreboard-outline" style={{ flex: 1 }} onPress={() => router.navigate("/(tabs)/games")} />
            <Button label="My bets" variant="secondary" style={{ flex: 1 }} onPress={() => router.push("/bets")} />
          </View>
        </Card>

        {/* Prize boxes — informational, never a countdown nag */}
        {readyBoxes.length > 0 || idleBoxes.length > 0 ? (
          <Card tone="money" onPress={() => router.push("/prizes")} style={styles.rowCard} accessibilityLabel="Prize boxes">
            <MaterialCommunityIcons name="gift-open-outline" size={22} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.foreground }]}>
                {readyBoxes.length > 0 ? `${readyBoxes.length} prize box${readyBoxes.length > 1 ? "es" : ""} ready` : "Start a prize box timer"}
              </Text>
              <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Free credits on a cooldown</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} />
          </Card>
        ) : nextBox ? (
          <Card onPress={() => router.push("/prizes")} style={styles.rowCard} accessibilityLabel="Prize boxes">
            <MaterialCommunityIcons name="gift-outline" size={22} color={c.mutedForeground} />
            <Text style={[styles.rowSub, { color: c.mutedForeground, flex: 1 }]}>
              Next free box {untilKickoff(nextBox.readyAt ?? now, now)}
            </Text>
          </Card>
        ) : null}

        {/* Leagues */}
        <SectionHeader title="Your leagues" action={leagues.length ? "All leagues" : undefined} onAction={() => router.navigate("/(tabs)/leagues")} />
        {summaries.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="Compete with friends"
            body="A league gives everyone the same stack of tokens for a season. Best net worth at the end takes the pot."
            action="Start a league"
            onAction={() => router.navigate({ pathname: "/(tabs)/leagues", params: { create: "1" } })}
            secondary="Join with a code"
            onSecondary={() => router.navigate({ pathname: "/(tabs)/leagues", params: { join: "1" } })}
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leagueRow}>
            {summaries.slice(0, 6).map((s) => (
              <Card
                key={s.league.id}
                onPress={() => router.push({ pathname: "/league/[id]", params: { id: s.league.id } })}
                accessibilityLabel={`${s.league.name}, rank ${s.me?.rank ?? "unranked"} of ${s.memberCount}`}
                style={styles.leagueCard}
                tone={s.me?.rank === 1 ? "money" : undefined}
              >
                <Text style={[styles.leagueName, { color: c.foreground }]} numberOfLines={1}>
                  {s.league.name}
                </Text>
                <View style={styles.rankLine}>
                  <Text style={[styles.rank, { color: s.me?.rank === 1 ? c.primary : c.foreground }]}>#{s.me?.rank ?? "–"}</Text>
                  <Text style={[styles.rankOf, { color: c.mutedForeground }]}>of {s.memberCount}</Text>
                </View>
                <Amount value={s.me?.netWorth ?? 0} currency="league" size="sm" />
                <Text style={[styles.rowSub, { color: c.subtleForeground }]}>
                  {s.closed ? "Closed" : `${s.daysLeft}d left`}
                  {s.me && s.me.debt > 0 ? ` · owes ${s.me.debt.toLocaleString()}` : ""}
                </Text>
              </Card>
            ))}
          </ScrollView>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <SectionHeader title="Recent results" action="Activity" onAction={() => router.push("/activity")} />
            <Card style={{ padding: 0 }}>
              {results.map((n, i) => (
                <ResultRow key={n.id} n={n} last={i === results.length - 1} />
              ))}
            </Card>
          </>
        )}

        <SponsoredCard />

        {/* Open bets */}
        <SectionHeader
          title="Riding now"
          action={openTotal > 0 ? `All ${openTotal}` : undefined}
          onAction={() => router.push("/bets")}
          prominent
        />
        {openTotal === 0 ? (
          <EmptyState icon="ticket-outline" title="Nothing riding" body="Back a team on the board — results pop up here the moment the game's final." action="Browse games" onAction={() => router.navigate("/(tabs)/games")} />
        ) : (
          <>
            {openCredit.slice(0, 3).map((b) => (
              <BetTicket key={b.id} bet={b} game={gameById.get(b.gameId) ?? null} onOpen={() => setQuickGame(b.gameId)} />
            ))}
            {openLeague.slice(0, Math.max(0, 3 - openCredit.length)).map(({ b, league }) => (
              <BetTicket key={b.id} bet={b} walletLabel={league} game={gameById.get(b.gameId) ?? null} onOpen={() => setQuickGame(b.gameId)} />
            ))}
            {openTotal > 3 ? (
              <Button
                label={`See all ${openTotal} open bets`}
                icon="ticket-confirmation-outline"
                variant="secondary"
                onPress={() => router.push("/bets")}
                style={{ borderColor: c.primary, borderWidth: 1.5 }}
              />
            ) : null}
          </>
        )}

        {settled.length > 0 && (
          <View style={styles.record}>
            <Pill label={`${wins}–${settled.length - wins} record`} icon="chart-line" />
            <Pill label={`${Math.round((wins / settled.length) * 100)}% hit rate`} tone="accent" />
            <Pill label={`${totalWon >= 0 ? "+" : ""}${totalWon.toLocaleString()} from wins`} tone={totalWon > 0 ? "positive" : "neutral"} />
          </View>
        )}
      </ScrollView>
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
    </View>
  );
}

function WalletStat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[styles.label, { color: c.subtleForeground }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.walletValue, { color: color ?? c.foreground }]}>{value}</Text>
      {hint ? <Text style={[styles.rowSub, { color: c.subtleForeground }]}>{hint}</Text> : null}
    </View>
  );
}

function ResultRow({ n, last }: { n: AppNotification; last: boolean }) {
  const c = useColors();
  const won = n.type === "bet_won";
  const lost = n.type === "bet_lost";
  const tone = won ? c.positive : lost ? c.negative : c.mutedForeground;
  return (
    <View style={[styles.result, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <View style={[styles.resultIcon, { backgroundColor: c.alpha(tone, 0.14) }]}>
        <MaterialCommunityIcons name={won ? "arrow-up-bold" : lost ? "arrow-down-bold" : "minus"} size={16} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]} numberOfLines={1}>
          {n.bet?.teamAbbr} v {n.bet?.opponentAbbr}
          {n.leagueName ? <Text style={{ color: c.league }}>  · {n.leagueName}</Text> : null}
        </Text>
        <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
          {won ? "Won" : lost ? "Lost" : "Push"} · {n.bet?.odds.toFixed(2)}x
        </Text>
      </View>
      <Amount value={won && n.bet ? n.bet.payout - n.bet.stake : n.delta} currency={n.wallet === "league" ? "league" : "credits"} signed size="sm" tone={won ? "positive" : lost ? "negative" : "neutral"} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  h1: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_900Black", letterSpacing: -1 },
  wallet: { gap: 8, padding: 18, borderRadius: 22, overflow: "hidden" },
  label: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  walletStats: { flexDirection: "row", gap: 8, marginTop: 4 },
  walletValue: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  leagueRow: { gap: 10, paddingRight: 16 },
  leagueCard: { width: 168, gap: 4 },
  leagueName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rankLine: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  rank: { fontSize: 28, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  rankOf: { fontSize: 12, fontFamily: "Inter_500Medium" },
  result: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  resultIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  record: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 },
});

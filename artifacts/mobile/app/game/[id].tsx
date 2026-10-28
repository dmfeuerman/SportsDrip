import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import type { TicketBet } from "@/components/BetTicket";
import {
  InsightsSkeleton,
  KeyPlayersBlock,
  Linescore,
  LiveDot,
  MatchupInsights,
  Note,
  ScoringTimeline,
  SituationCard,
  TeamStatsBlock,
  WinProbability,
} from "@/components/insights";
import { EmptyState, IconButton, Pill, ScreenHeader, SegmentedControl, useBottomPad, type Tone } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors, type Colors } from "@/hooks/useColors";
import { useGame } from "@/hooks/useGame";
import { useGameInsights } from "@/hooks/useGameInsights";
import { useNow } from "@/hooks/useNow";
import { formatPercent, impliedProbability, kickoffLabel, livePosition, untilKickoff } from "@/lib/odds";
import type { Game, TeamSide } from "@/types/game";

type Tab = "live" | "matchup";
type Position = { key: string; bet: TicketBet; wallet: string | null };

/**
 * Game center: one fixture, live.
 *
 * Opened by tapping any bet (My bets, Home, a league's bets tab) or from the
 * board's game sheet. The score and clock come from games/{id}, which the
 * server refreshes every two minutes and the app listens to; the period
 * breakdown, scoring timeline, win probability and leaders come from
 * getGameInsights, re-polled every 30 seconds while the game is live.
 *
 * Every bet the user has on the game, in either wallet, sits under the
 * scoreboard with where it stands right now — the reason they tapped in.
 */
export default function GameCenterScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const gameId = typeof params.id === "string" && params.id ? params.id : null;

  const { game, loading, missing } = useGame(gameId);
  const insights = useGameInsights(gameId, game?.status);
  const { bets } = useApp();
  const { leagues, myLeagueBets } = useLeague();
  const live = game?.status === "live";
  const now = useNow(live ? 5_000 : 60_000);

  const [tab, setTab] = useState<Tab>(params.tab === "matchup" ? "matchup" : "live");
  const [refreshing, setRefreshing] = useState(false);

  const positions: Position[] = useMemo(() => {
    const out: Position[] = [];
    for (const b of bets) if (b.gameId === gameId && b.status !== "cancelled") out.push({ key: b.id, bet: b, wallet: null });
    for (const lg of leagues) {
      for (const b of myLeagueBets[lg.id] ?? []) {
        if (b.gameId === gameId && b.status !== "cancelled") out.push({ key: `${lg.id}:${b.id}`, bet: b, wallet: lg.name });
      }
    }
    return out;
  }, [bets, leagues, myLeagueBets, gameId]);

  // A small tap when the score moves on a game you have money on.
  const scoreKey = game ? `${game.awayScore}-${game.homeScore}` : "";
  const lastScore = useRef(scoreKey);
  useEffect(() => {
    if (lastScore.current && scoreKey && lastScore.current !== scoreKey && live && positions.length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    lastScore.current = scoreKey;
  }, [scoreKey, live, positions.length]);

  const started = !!game && game.status !== "upcoming";
  const shown: Tab = started ? tab : "matchup";

  const onRefresh = async () => {
    setRefreshing(true);
    await insights.reload();
    setRefreshing(false);
  };

  const title = game ? `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}` : "Game";
  const subtitle = game ? [game.sport, game.seasonLabel].filter(Boolean).join(" · ") : undefined;

  if (!game) {
    const settled = positions.find((p) => p.bet.finalHomeScore !== undefined && p.bet.finalAwayScore !== undefined);
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScreenHeader back title={title} />
        <View style={styles.body}>
          {loading ? (
            <InsightsSkeleton rows={2} />
          ) : (
            <EmptyState
              icon="calendar-remove"
              title={missing ? "This game has been archived" : "Can't load this game"}
              body={
                settled
                  ? `Final: ${settled.bet.teamAbbr} ${settled.bet.side === "home" ? settled.bet.finalHomeScore : settled.bet.finalAwayScore}, ${settled.bet.opponentAbbr} ${settled.bet.side === "home" ? settled.bet.finalAwayScore : settled.bet.finalHomeScore}. Your bet history keeps the result.`
                  : "Finished games drop off the board after two days. Your bet history keeps the result."
              }
              action="My bets"
              onAction={() => router.replace("/bets")}
            />
          )}
        </View>
      </View>
    );
  }

  const updated = insights.data ? Math.max(0, Math.round((now - insights.data.fetchedAt) / 1000)) : null;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title={title}
        subtitle={subtitle}
        right={<IconButton icon="refresh" label="Refresh stats" onPress={() => void onRefresh()} />}
      >
        {started ? (
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: "live", label: live ? "Live" : "Recap" },
              { value: "matchup", label: "Matchup" },
            ]}
          />
        ) : null}
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
      >
        <Scoreboard game={game} now={now} c={c} />

        {positions.length > 0 && <Positions game={game} positions={positions} c={c} />}

        {shown === "live" ? (
          <Animated.View key="live" entering={FadeIn.duration(200)} style={styles.stack}>
            <SituationCard game={game} />
            <WinProbability game={game} insights={insights.data} />
            <Linescore game={game} insights={insights.data} />
            <ScoringTimeline game={game} insights={insights.data} />
            <KeyPlayersBlock game={game} insights={insights.data} />
            <TeamStatsBlock game={game} insights={insights.data} limit={14} />
            {!insights.data && insights.loading ? <InsightsSkeleton /> : null}
            {!insights.data && insights.error ? (
              <Note icon="wifi-off" text={`Live details aren't loading. ${insights.error}`} action="Retry" onAction={() => void insights.reload()} />
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View key="matchup" entering={FadeIn.duration(200)} style={styles.stack}>
            <MatchupInsights game={game} insights={insights.data} loading={insights.loading} error={insights.error} onRetry={() => void insights.reload()} />
          </Animated.View>
        )}

        <Text style={[styles.footer, { color: c.subtleForeground }]}>
          {[
            game.venue ? `${game.venue}${game.city ? `, ${game.city}` : ""}` : null,
            game.broadcast ? `Watch on ${game.broadcast}` : null,
            updated !== null && live ? `${updated < 5 ? "Stats just updated" : `Stats updated ${updated}s ago`} · refreshes every 30s` : null,
          ]
            .filter(Boolean)
            .join("\n")}
        </Text>
      </ScrollView>
    </View>
  );
}

function Scoreboard({ game, now, c }: { game: Game; now: number; c: Colors }) {
  const live = game.status === "live";
  const final = game.status === "final";
  const leader = game.homeScore !== null && game.awayScore !== null && game.homeScore !== game.awayScore ? (game.homeScore > game.awayScore ? "home" : "away") : null;

  return (
    <View style={[styles.hero, { backgroundColor: c.card, borderColor: live ? c.alpha(c.live, 0.45) : c.border }]}>
      <HeroTeam team={game.awayTeam} score={game.awayScore} dim={final && leader === "home"} c={c} />
      <View style={styles.heroMid}>
        {live ? (
          <View style={[styles.livePill, { backgroundColor: c.alpha(c.live, 0.14) }]}>
            <LiveDot size={7} />
            <Text style={[styles.livePillText, { color: c.live }]}>LIVE</Text>
          </View>
        ) : null}
        <Text style={[styles.heroClock, { color: live ? c.foreground : c.mutedForeground }]} numberOfLines={2}>
          {live ? game.clock ?? "In progress" : final ? "Final" : kickoffLabel(game.startsAt, now)}
        </Text>
        {game.status === "upcoming" ? <Text style={[styles.heroSub, { color: c.subtleForeground }]}>{untilKickoff(game.startsAt, now)}</Text> : null}
      </View>
      <HeroTeam team={game.homeTeam} score={game.homeScore} dim={final && leader === "away"} c={c} />
    </View>
  );
}

function HeroTeam({ team, score, dim, c }: { team: TeamSide; score: number | null; dim: boolean; c: Colors }) {
  return (
    <View style={styles.heroTeam}>
      {team.logoUrl ? (
        <Image source={{ uri: team.logoUrl }} style={styles.heroLogo} contentFit="contain" transition={120} />
      ) : (
        <View style={[styles.heroLogo, styles.heroFallback, { backgroundColor: c.alpha(team.color, 0.2), borderColor: team.color }]}>
          <Text style={[styles.heroAbbr, { color: c.foreground }]}>{team.abbreviation}</Text>
        </View>
      )}
      <Text style={[styles.heroName, { color: c.foreground }]} numberOfLines={1}>
        {team.location && team.name.startsWith(team.location) ? team.name.slice(team.location.length).trim() || team.name : team.name}
      </Text>
      {team.record ? <Text style={[styles.heroSub, { color: c.subtleForeground }]}>{team.record}</Text> : null}
      {score !== null ? (
        // Keyed on the value so a new score re-mounts and pops in.
        <Animated.Text key={score} entering={ZoomIn.duration(260)} style={[styles.heroScore, { color: dim ? c.mutedForeground : c.foreground }]}>
          {score}
        </Animated.Text>
      ) : (
        <Text style={[styles.heroOdds, { color: c.mutedForeground }]}>
          {team.odds.toFixed(2)}x · {formatPercent(impliedProbability(team.odds))}
        </Text>
      )}
    </View>
  );
}

const STATUS_TONE: Record<string, { label: string; tone: Tone }> = {
  won: { label: "Won", tone: "positive" },
  lost: { label: "Lost", tone: "negative" },
  push: { label: "Push", tone: "neutral" },
};

function Positions({ game, positions, c }: { game: Game; positions: Position[]; c: Colors }) {
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>
        Your {positions.length === 1 ? "bet" : `bets (${positions.length})`}
      </Text>
      {positions.map(({ key, bet, wallet }) => {
        const pos = bet.status === "pending" ? livePosition(game, bet.side) : null;
        const settled = STATUS_TONE[bet.status];
        // What it pays if the game stopped now: the same rule the server settles on.
        const nowValue = pos === "ahead" ? bet.potentialPayout : pos === "level" ? bet.stake : pos === "behind" ? 0 : null;
        const tone: Tone = settled ? settled.tone : pos === "ahead" ? "positive" : pos === "behind" ? "negative" : pos === "level" ? "warning" : "accent";
        const label = settled ? settled.label : pos ? pos[0]!.toUpperCase() + pos.slice(1) : "Open";
        const currency = wallet ? "tokens" : "credits";
        return (
          <View key={key} style={[styles.position, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: bet.teamColor }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.posTitle, { color: c.foreground }]} numberOfLines={1}>
                {bet.teamName} to win
              </Text>
              <Text style={[styles.posMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                {bet.stake.toLocaleString()} at {bet.odds.toFixed(2)}x → {bet.potentialPayout.toLocaleString()} {currency}
              </Text>
              {wallet ? (
                <View style={styles.wallet}>
                  <MaterialCommunityIcons name="shield-star" size={11} color={c.league} />
                  <Text style={[styles.walletText, { color: c.league }]} numberOfLines={1}>
                    {wallet}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Pill label={label} tone={tone} />
              {nowValue !== null ? (
                <Text style={[styles.posNow, { color: nowValue > bet.stake ? c.positive : nowValue === 0 ? c.negative : c.mutedForeground }]}>
                  {nowValue > 0 ? `Pays ${nowValue.toLocaleString()} if it ends now` : "Loses if it ends now"}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 16, gap: 18 },
  stack: { gap: 18 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: -8 },

  hero: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 10 },
  heroTeam: { flex: 1, alignItems: "center", gap: 4 },
  heroLogo: { width: 56, height: 56, borderRadius: 14 },
  heroFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  heroAbbr: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  heroName: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 4 },
  heroSub: { fontSize: 11, fontFamily: "Inter_500Medium" },
  heroScore: { fontSize: 40, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -1, marginTop: 4 },
  heroOdds: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"], marginTop: 6 },
  heroMid: { width: 96, alignItems: "center", gap: 6, paddingTop: 16 },
  heroClock: { fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  livePillText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },

  position: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  posTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  posMeta: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  posNow: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  wallet: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  walletText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  footer: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 17 },
});

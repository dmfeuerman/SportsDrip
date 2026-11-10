import FlashPickCard from "@/components/FlashPickCard";
import { useExitBreakpoint } from "@/context/AdsContext";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ONLINE_MS, setWatchingGame, usePresence } from "@/lib/presence";
import { useFriends } from "@/hooks/useFriends";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import type { TicketBet } from "@/components/BetTicket";
import ScrollHint, { useScrollHint } from "@/components/ScrollHint";
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
import { EmptyState, IconButton, Pill, ScreenHeader, TabStrip, useBottomPad, type Tone } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useChallenges, viewOf, type ChallengeView } from "@/context/ChallengeContext";
import { useGameLeagueSweat, useLeague } from "@/context/LeagueContext";
import { useColors, type Colors } from "@/hooks/useColors";
import { useGame } from "@/hooks/useGame";
import { useGameInsights } from "@/hooks/useGameInsights";
import { useNow } from "@/hooks/useNow";
import { formatOdds, formatPercent, impliedProbability, kickoffLabel, livePosition, NO_LINE, untilKickoff, type OddsFormat } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import type { Game, TeamSide } from "@/types/game";

type Tab = "live" | "matchup";
type Position = { key: string; bet: TicketBet; wallet: string | null };

export default function GameCenterScreen() {
  useExitBreakpoint("game_detail_exit");
  const c = useColors();
  const fmt = useOddsFormat();
  const bottom = useBottomPad(false);
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const gameId = typeof params.id === "string" && params.id ? params.id : null;

  const { game, loading, missing } = useGame(gameId);
  const insights = useGameInsights(gameId, game?.status);
  const { bets } = useApp();
  const { leagues, myLeagueBets, uid } = useLeague();
  const { byLeague: leagueSweats } = useGameLeagueSweat(gameId ?? undefined);
  const live = game?.status === "live";
  const now = useNow(live ? 5_000 : 60_000);

  const [tab, setTab] = useState<Tab>(params.tab === "matchup" ? "matchup" : "live");
  // Who else is on this game right now (friends with the game open).
  const { profile } = useApp();
  const { friends } = useFriends(profile?.uid ?? null);
  const presence = usePresence(friends.map((f) => f.uid));
  const watching = friends.filter((f) => presence[f.uid]?.gameId === gameId && (presence[f.uid]?.at ?? 0) > now - ONLINE_MS);
  useEffect(() => {
    if (!gameId) return;
    setWatchingGame(gameId);
    return () => setWatchingGame(null);
  }, [gameId]);
  const challenges = useChallenges();
  const duels: ChallengeView[] = useMemo(() => {
    const me = challenges.uid;
    if (!me || !gameId) return [];
    return challenges.challenges
      .filter((ch) => ch.gameId === gameId && (ch.status === "pending" || ch.status === "accepted" || ch.status === "settled"))
      .map((ch) => viewOf(ch, me));
  }, [challenges.challenges, challenges.uid, gameId]);
  const [refreshing, setRefreshing] = useState(false);
  const hint = useScrollHint();

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

  const scoreKey = game ? `${game.awayScore}-${game.homeScore}` : "";
  const lastScore = useRef(scoreKey);
  useEffect(() => {
    if (lastScore.current && scoreKey && lastScore.current !== scoreKey && live && positions.length) {
      buzz.light();
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
  const watchingText = watching.length
    ? `👀 ${watching.slice(0, 2).map((f) => f.displayName).join(", ")}${watching.length > 2 ? ` +${watching.length - 2}` : ""} watching`
    : null;
  const subtitle = game ? [game.sport, game.seasonLabel, watchingText].filter(Boolean).join(" · ") : undefined;

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
              action="My Bets"
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
        right={<IconButton icon="refresh" label="Refresh Stats" onPress={() => void onRefresh()} />}
      >
        {started ? (
          <TabStrip
            value={tab}
            onChange={setTab}
            options={[
              { value: "live", label: live ? "Live" : "Recap" },
              { value: "matchup", label: "Matchup" },
            ]}
          />
        ) : null}
      </ScreenHeader>

      <View style={{ flex: 1 }}>
      <ScrollView
        {...hint.scrollProps}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
        showsVerticalScrollIndicator
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
      >
        <Scoreboard game={game} now={now} c={c} fmt={fmt} />
        <FlashPickCard game={game} />

        {positions.length > 0 && <Positions game={game} positions={positions} c={c} fmt={fmt} />}
        {duels.length > 0 && <Duels game={game} duels={duels} c={c} fmt={fmt} />}
        {leagueSweats.length > 0 && <LeagueSweat game={game} sweats={leagueSweats} uid={uid} c={c} fmt={fmt} />}

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

        <SponsoredCard style={{ marginTop: 12 }} />

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
      <ScrollHint visible={hint.visible} bg={c.background} label="Scroll For Full Matchup" />
      </View>
    </View>
  );
}

function Scoreboard({ game, now, c, fmt }: { game: Game; now: number; c: Colors; fmt: OddsFormat }) {
  const live = game.status === "live";
  const final = game.status === "final";
  const leader = game.homeScore !== null && game.awayScore !== null && game.homeScore !== game.awayScore ? (game.homeScore > game.awayScore ? "home" : "away") : null;

  return (
    <View style={[styles.hero, { backgroundColor: c.card, borderColor: live ? c.alpha(c.live, 0.45) : c.border }]}>
      <HeroTeam team={game.awayTeam} score={game.awayScore} dim={final && leader === "home"} c={c} fmt={fmt} />
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
      <HeroTeam team={game.homeTeam} score={game.homeScore} dim={final && leader === "away"} c={c} fmt={fmt} />
    </View>
  );
}

function HeroTeam({ team, score, dim, c, fmt }: { team: TeamSide; score: number | null; dim: boolean; c: Colors; fmt: OddsFormat }) {
  return (
    <View style={styles.heroTeam}>
      <View style={[styles.heroLogo, styles.heroFallback, { backgroundColor: c.alpha(team.color, 0.2), borderColor: team.color }]}>
        <Text style={[styles.heroAbbr, { color: c.foreground }]}>{team.abbreviation}</Text>
      </View>
      <Text style={[styles.heroName, { color: c.foreground }]} numberOfLines={1}>
        {team.location && team.name.startsWith(team.location) ? team.name.slice(team.location.length).trim() || team.name : team.name}
      </Text>
      {team.record ? <Text style={[styles.heroSub, { color: c.subtleForeground }]}>{team.record}</Text> : null}
      {score !== null ? (
        <Animated.Text key={score} entering={ZoomIn.duration(260)} style={[styles.heroScore, { color: dim ? c.mutedForeground : c.foreground }]}>
          {score}
        </Animated.Text>
      ) : (
        <Text style={[styles.heroOdds, { color: c.mutedForeground }]}>
          {team.odds != null && team.odds > 1 ? `${formatOdds(team.odds, fmt)} · ${formatPercent(impliedProbability(team.odds))}` : NO_LINE}
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

function Positions({ game, positions, c, fmt }: { game: Game; positions: Position[]; c: Colors; fmt: OddsFormat }) {
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>
        Your {positions.length === 1 ? "bet" : `bets (${positions.length})`}
      </Text>
      {positions.map(({ key, bet, wallet }) => {
        const pos = bet.status === "pending" ? livePosition(game, bet) : null;
        const settled = STATUS_TONE[bet.status];
        const nowValue = pos === "ahead" ? bet.potentialPayout : pos === "level" ? bet.stake : pos === "behind" ? 0 : null;
        const tone: Tone = settled ? settled.tone : pos === "ahead" ? "positive" : pos === "behind" ? "negative" : pos === "level" ? "warning" : "accent";
        const label = settled ? settled.label : pos ? pos[0]!.toUpperCase() + pos.slice(1) : "Open";
        const currency = wallet ? "tokens" : "credits";
        return (
          <View key={key} style={[styles.position, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: bet.teamColor }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.posTitle, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
                  {bet.label ?? `${bet.teamName} to win`}
                </Text>
                {bet.lockWeek ? <Pill label="LOCK 1.5x" tone="accent" icon="lock" /> : null}
              </View>
              <Text style={[styles.posMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                {bet.stake.toLocaleString()} at {formatOdds(bet.odds, fmt)} → {bet.potentialPayout.toLocaleString()} {currency}
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

function LeagueSweat({
  game,
  sweats,
  uid,
  c,
  fmt,
}: {
  game: Game;
  sweats: ReturnType<typeof useGameLeagueSweat>["byLeague"];
  uid: string | null;
  c: Colors;
  fmt: OddsFormat;
}) {
  const totalCount = sweats.reduce((n, s) => n + (s.sides.entries?.length ?? 0), 0);
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>
        League sweat ({totalCount})
      </Text>
      {sweats.map(({ league, sides, rivalries }) => {
        const entries = sides.entries ?? [];
        const awayBets = sides.away?.length ? sides.away : entries.filter((b) => (b.selection ?? b.side) === "away" || b.selection === "over");
        const homeBets = sides.home?.length ? sides.home : entries.filter((b) => (b.selection ?? b.side) === "home" || b.selection === "under");
        const totalStake = entries.reduce((s, b) => s + b.stake, 0);
        const myRivalry = uid
          ? rivalries.find((r) => (r.aUid === uid || r.bUid === uid) && r.aWins + r.bWins + r.pushes > 0)
          : undefined;
        return (
          <View key={league.id} style={[styles.sweatCard, { backgroundColor: c.card, borderColor: c.alpha(c.league, 0.45) }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/league/[id]", params: { id: league.id, tab: "bets" } })}
              style={styles.sweatHead}
            >
              <MaterialCommunityIcons name="shield-star" size={15} color={c.league} />
              <Text style={[styles.posTitle, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                {league.name}
              </Text>
              <Text style={[styles.posMeta, { color: c.mutedForeground }]}>
                {totalStake.toLocaleString()} tokens in play
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={c.subtleForeground} />
            </Pressable>
            {myRivalry && uid ? (
              <Text style={[styles.posMeta, { color: c.accent }]}>
                ⚔️ H2H vs {myRivalry.aUid === uid ? myRivalry.bName : myRivalry.aName}:{" "}
                {myRivalry.aUid === uid ? `${myRivalry.aWins}–${myRivalry.bWins}` : `${myRivalry.bWins}–${myRivalry.aWins}`}
              </Text>
            ) : null}
            <View style={styles.sweatSplit}>
              <View style={[styles.sweatCol, { backgroundColor: c.secondary, borderColor: c.border }]}>
                <Text style={[styles.sweatColHeader, { color: game.awayTeam.color }]}>
                  {game.awayTeam.abbreviation} / OVER ({awayBets.length})
                </Text>
                {awayBets.length === 0 ? (
                  <Text style={[styles.posMeta, { color: c.subtleForeground }]}>No Action</Text>
                ) : (
                  awayBets.map((b) => {
                    const pos = livePosition(game, { side: b.side ?? "away", market: b.market, selection: b.selection, line: b.line });
                    return (
                      <View key={b.betId} style={styles.sweatBetRow}>
                        <Text style={[styles.sweatMember, { color: b.uid === uid ? c.league : c.foreground }]} numberOfLines={1}>
                          {b.uid === uid ? "You" : b.displayName || b.name}
                          {b.lock ? " 🔒" : ""}
                        </Text>
                        <Text style={[styles.sweatBetMeta, { color: pos === "ahead" ? c.positive : pos === "behind" ? c.negative : c.mutedForeground }]} numberOfLines={1}>
                          {b.label || b.teamAbbr} · {b.stake.toLocaleString()} ({formatOdds(b.odds, fmt)})
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
              <View style={[styles.sweatCol, { backgroundColor: c.secondary, borderColor: c.border }]}>
                <Text style={[styles.sweatColHeader, { color: game.homeTeam.color }]}>
                  {game.homeTeam.abbreviation} / UNDER ({homeBets.length})
                </Text>
                {homeBets.length === 0 ? (
                  <Text style={[styles.posMeta, { color: c.subtleForeground }]}>No Action</Text>
                ) : (
                  homeBets.map((b) => {
                    const pos = livePosition(game, { side: b.side ?? "home", market: b.market, selection: b.selection, line: b.line });
                    return (
                      <View key={b.betId} style={styles.sweatBetRow}>
                        <Text style={[styles.sweatMember, { color: b.uid === uid ? c.league : c.foreground }]} numberOfLines={1}>
                          {b.uid === uid ? "You" : b.displayName || b.name}
                          {b.lock ? " 🔒" : ""}
                        </Text>
                        <Text style={[styles.sweatBetMeta, { color: pos === "ahead" ? c.positive : pos === "behind" ? c.negative : c.mutedForeground }]} numberOfLines={1}>
                          {b.label || b.teamAbbr} · {b.stake.toLocaleString()} ({formatOdds(b.odds, fmt)})
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Duels({ game, duels, c, fmt }: { game: Game; duels: ChallengeView[]; c: Colors; fmt: OddsFormat }) {
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>
        Vs friends {duels.length > 1 ? `(${duels.length})` : ""}
      </Text>
      {duels.map((v) => {
        const { ch } = v;
        const pos = ch.status === "accepted" ? livePosition(game, v.mySide) : null;
        const settled = v.result ? STATUS_TONE[v.result] : null;
        const tone: Tone = settled
          ? settled.tone
          : ch.status === "pending"
            ? "neutral"
            : pos === "ahead"
              ? "positive"
              : pos === "behind"
                ? "negative"
                : pos === "level"
                  ? "warning"
                  : "accent";
        const label = settled ? settled.label : ch.status === "pending" ? (v.isCreator ? "Sent" : "Your call") : pos ? pos[0]!.toUpperCase() + pos.slice(1) : "Locked";
        return (
          <Pressable
            key={ch.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/challenges", params: { tab: ch.status === "pending" ? "inbox" : ch.status === "accepted" ? "live" : "history" } })}
            style={[styles.position, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: v.myTeam.color }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.posTitle, { color: c.foreground }]} numberOfLines={1}>
                {v.myTeam.abbreviation} vs {v.friendName} on {v.theirTeam.abbreviation}
              </Text>
              <Text style={[styles.posMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                {v.myStake.toLocaleString()} in · {ch.pot.toLocaleString()} pot · {ch.mode === "pot" ? "winner takes all" : formatOdds(v.myOdds, fmt)}
              </Text>
              <View style={styles.wallet}>
                <MaterialCommunityIcons name="sword-cross" size={11} color={c.accent} />
                <Text style={[styles.walletText, { color: c.accent }]}>Head to Head</Text>
              </View>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Pill label={label} tone={tone} />
              {pos ? (
                <Text style={[styles.posNow, { color: pos === "ahead" ? c.positive : pos === "behind" ? c.negative : c.mutedForeground }]}>
                  {pos === "ahead" ? `Takes ${ch.pot.toLocaleString()} if it ends now` : pos === "behind" ? `${v.friendName} takes it now` : "Stakes back if level"}
                </Text>
              ) : null}
            </View>
          </Pressable>
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
  livePillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },

  position: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  posTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  posMeta: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  posNow: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  wallet: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  walletText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  sweatCard: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  sweatHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sweatSplit: { flexDirection: "row", gap: 8 },
  sweatCol: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, gap: 6 },
  sweatColHeader: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  sweatBetRow: { gap: 1, paddingVertical: 2 },
  sweatMember: { fontSize: 12, fontFamily: "Inter_700Bold" },
  sweatBetMeta: { fontSize: 11, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },

  footer: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 17 },
});

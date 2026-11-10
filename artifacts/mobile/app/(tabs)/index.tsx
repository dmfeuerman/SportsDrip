import { LinearGradient } from "expo-linear-gradient";
import { NO_CASH_VALUE } from "@/constants/legal";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import AvatarHero from "@/components/avatar/AvatarHero";
import { isSceneBackdrop } from "@/components/avatar/AvatarBackdrop";
import LevelBar from "@/components/LevelBar";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import BetTicket from "@/components/BetTicket";
import DailyPickCard from "@/components/DailyPickCard";
import FeaturedGameCard, { pickFeatured } from "@/components/FeaturedGameCard";
import { betNet } from "@/components/BetRecordPanel";
import FirstWeekChecklist from "@/components/FirstWeekChecklist";
import LadderPromotionHost from "@/components/LadderPromotionHost";
import QuestsCard from "@/components/QuestsCard";
import StreakWagerCard from "@/components/StreakWagerCard";
import RewardsCard from "@/components/RewardsCard";
import WinBackCard from "@/components/WinBackCard";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import NextActionCard from "@/components/NextActionCard";
import LiveSweatCard, { type SweatBet } from "@/components/LiveSweatCard";
import WeeklyRecapCard from "@/components/WeeklyRecapCard";
import CrewFeedModule from "@/components/CrewFeed";
import GameQuickView from "@/components/GameQuickView";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { Amount, Button, Card, EmptyState, IconButton, Pill, SectionHeader, useBottomPad, useTopPad } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { useApp } from "@/context/AppContext";
import { useChallenges } from "@/context/ChallengeContext";
import { useLeague, useLeagueSummaries } from "@/context/LeagueContext";
import { useChat } from "@/context/ChatContext";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";
import { useLevelRewards } from "@/hooks/useLevelRewards";
import { useNow } from "@/hooks/useNow";
import { untilKickoff } from "@/lib/odds";
import { openTourMenu } from "@/lib/tour/store";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";

/**
 * Home in three zones. Now: what is live, what is next, what you have riding.
 * Claim: the free bet, prize boxes and quests. Crew: challenges, leagues, the feed.
 * Results history, record and league detail live on their own screens.
 */
const NO_SIDES: never[] = [];
const NO_SIDE_MAP = new Map<string, never[]>();

/** Zone divider: Home reads as three bands, not a stack of twenty cards. */
function Zone({ title, sub }: { title: string; sub: string }) {
  const c = useColors();
  return (
    <View style={styles.zone} accessibilityRole="header">
      <Text style={[styles.zoneTitle, { color: c.primary }]}>{title.toUpperCase()}</Text>
      <Text style={[styles.zoneSub, { color: c.subtleForeground }]} numberOfLines={1}>{sub}</Text>
      <View style={[styles.zoneRule, { backgroundColor: c.border }]} />
    </View>
  );
}

export default function HomeScreen() {
  const c = useColors();
  const top = useTopPad();
  const bottom = useBottomPad();
  const now = useNow(30_000);

  const { profile, balance, bets, totalWon, progress, background } = useApp();
  const hasPlayed = bets.length > 0;
  const [showCard, setShowCard] = useState(false);
  const { nextAfter } = useLevelRewards();
  const onScene = isSceneBackdrop(background);
  const { myLeagueBets, leagues } = useLeague();
  const { summaries, totalDebt } = useLeagueSummaries();
  const { notifications } = useNotifications();
  const { unreadChatCount } = useChat();
  const { byId } = useCatalog();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const openCredit = bets.filter((b) => b.status === "pending");
  const openLeague = leagues.flatMap((l) => (myLeagueBets[l.id] ?? []).filter((b) => b.status === "pending").map((b) => ({ b, league: l.name })));
  const openTotal = openCredit.length + openLeague.length;
  const { incoming: challengeInbox, live: challengesLive, outgoing: challengesSent, escrowed } = useChallenges();
  // Credits in friend pots are in play too.
  const atRisk = openCredit.reduce((s, b) => s + b.stake, 0) + escrowed;
  const couldReturn = openCredit.reduce((s, b) => s + b.potentialPayout, 0);

  const results = notifications.filter((n) => n.bet).slice(0, 4);
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b) => b.status === "won").length;
  // Net, not just gross winnings: payouts back minus every settled stake. Pushes count as 0.
  const net = settled.reduce((s, b) => s + betNet(b), 0);

  const name = profile?.displayName?.trim() || profile?.username || "there";
  const focused = useIsFocused();
  const [avatarGesture, setAvatarGesture] = useState(false);
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  // "Run It Back" from a result popup lands here with the game to open.
  const params = useLocalSearchParams<{ game?: string }>();
  useEffect(() => {
    if (!params.game) return;
    setQuickGame(params.game);
    router.setParams({ game: undefined } as never);
  }, [params.game]);

  // A favorite team on today's board (live first, then the next kickoff within 18h).
  const teamTonight = useMemo(() => {
    const fav = new Set((profile?.favoriteTeams ?? []).map((t) => `${t.sport}:${t.abbr}`));
    if (!fav.size) return null;
    const hit = (g: (typeof games)[number]) =>
      fav.has(`${g.sport}:${g.homeTeam.abbreviation}`) ? g.homeTeam.abbreviation : fav.has(`${g.sport}:${g.awayTeam.abbreviation}`) ? g.awayTeam.abbreviation : null;
    const pool = games
      .filter((g) => g.status === "live" || (g.status === "upcoming" && g.startsAt - now < 18 * 3600_000))
      .sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) || a.startsAt - b.startsAt);
    for (const g of pool) {
      const abbr = hit(g);
      if (abbr) return { game: g, abbr };
    }
    return null;
  }, [profile?.favoriteTeams, games, now]);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef);
  const sectionY = useRef<{ prizes: number; daily: number }>({ prizes: 0, daily: 0 });
  const scrollTo = (section: "prizes" | "daily") =>
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[section] - 12), animated: true });
  const openGameIds = useMemo(
    () => new Set([...openCredit.map((b) => b.gameId), ...openLeague.map(({ b }) => b.gameId)]),
    [openCredit, openLeague]
  );
  const sweat: SweatBet[] = [
    ...openCredit.map((b) => ({ ...b, key: b.id, wallet: null })),
    ...openLeague.map(({ b, league }) => ({ ...b, key: `lg_${b.id}`, wallet: league })),
  ];
  // The biggest upcoming game you aren't on yet.
  const featured = useMemo(() => {
    const favs = new Set((profile?.favoriteTeams ?? []).map((t) => `${t.sport}:${t.abbr}`));
    const g = pickFeatured(games.filter((x) => !openGameIds.has(x.id)), NO_SIDE_MAP, favs, now);
    return g;
  }, [games, openGameIds, profile?.favoriteTeams, now]);
  const bestLeague = summaries
    .filter((s) => s.me?.rank)
    .sort((a, b) => (a.me!.rank ?? 99) - (b.me!.rank ?? 99))[0];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        ref={scrollRef}
        onScroll={tourScroll.onScroll}
        scrollEventThrottle={tourScroll.scrollEventThrottle}
        scrollEnabled={!avatarGesture}
        contentContainerStyle={[styles.content, { paddingTop: top + 12, paddingBottom: bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <tourScroll.Provider>
        {/* Your character, live and head to toe, first thing on screen. Tap it for a celebration. */}
        <TourTarget id="home.hero">
        <AvatarHero
          avatar={profile?.avatar ?? DEFAULT_AVATAR}
          equipped={profile?.equipped ?? {}}
          catalog={byId}
          moves={profile?.moves}
          onEditMoves={() => router.push("/moves")}
          active={focused}
          onGesture={setAvatarGesture}
          background={background}
          footer={<TourTarget id="home.level" style={{ flex: 1 }}><LevelBar progress={progress} nextReward={nextAfter(progress.level)} onPress={() => router.push("/levels" as never)} /></TourTarget>}
          header={
            <>
              <Text accessibilityRole="header" style={[styles.h1, { color: onScene ? "#FFFFFF" : c.foreground, flex: 1 }, onScene && styles.onScene]} numberOfLines={1}>
                Hello {name}
              </Text>
              <TourTarget id="home.help"><IconButton icon="help-circle-outline" label="Tutorials" onPress={openTourMenu} /></TourTarget>
              <TourTarget id="home.chat"><IconButton icon="chat-processing-outline" label="Chat" badge={unreadChatCount} onPress={() => router.push("/messages" as never)} /></TourTarget>
            </>
          }
        />

        </TourTarget>

        <Zone title="Now" sub="Live, next up and what you have riding" />
        {/* The one thing worth doing right now */}
        <TourTarget id="home.next">
        <NextActionCard
          now={now}
          games={games}
          openGameIds={openGameIds}
          teamTonight={teamTonight}
          onOpenGame={setQuickGame}
          onScrollTo={scrollTo}
        />
        </TourTarget>

        {/* Live games you have money on */}
        <LiveSweatCard bets={sweat} gameById={gameById} onOpen={setQuickGame} />

        {/* Game of the Night: one tap opens the bet slip without leaving Home */}
        {featured ? <FeaturedGameCard game={featured} sides={NO_SIDES} onOpen={(g) => setQuickGame(g.id)} /> : null}

        {/* Wallet */}
        <TourTarget id="home.wallet">
        <Pressable accessibilityRole="button" accessibilityLabel="Open your player card" onPress={() => { buzz.tick(); setShowCard(true); }}>
        <Card style={[styles.wallet, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.28) }]}>
          <LinearGradient
            pointerEvents="none"
            colors={[c.alpha(c.primary, c.isDark ? 0.2 : 0.12), c.alpha(c.accent, 0.05), "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[styles.label, { color: c.mutedForeground }]}>CREDITS</Text>
          <Amount value={balance} size="xl" animate />
          <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: c.subtleForeground }}>{NO_CASH_VALUE}</Text>
          <View style={styles.walletStats}>
            <WalletStat
              label="In Play"
              value={atRisk.toLocaleString()}
              hint={escrowed > 0 ? `${openCredit.length} bets · ${escrowed.toLocaleString()} in pots` : `${openCredit.length} open`}
            />
            <WalletStat label="Could Return" value={couldReturn.toLocaleString()} color={c.positive} />
            <WalletStat
              label="League Debt"
              value={totalDebt.toLocaleString()}
              color={totalDebt > 0 ? c.debt : undefined}
              hint={totalDebt > 0 ? "flat fee" : "none"}
            />
          </View>
        </Card>
        </Pressable>
        </TourTarget>

        {/* Open bets */}
        <TourTarget id="home.bets">
        <SectionHeader
          title="My Bets"
          action={openTotal > 0 ? "See All" : undefined}
          onAction={() => router.push("/bets")}
        />
        </TourTarget>
        {openTotal === 0 ? (
          <EmptyState icon="ticket-outline" title="Nothing Riding" body="Back a team on the board — results pop up here the moment the game's final." action="Browse Games" onAction={() => router.navigate("/(tabs)/games")} />
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


        {results.length > 0 ? (
          <Button label="Results & History" icon="history" variant="ghost" size="sm" onPress={() => router.push("/activity")} />
        ) : null}

        <Zone title="Claim" sub="Free bet, boxes and quests" />
        {/* Daily reasons to open the app: free bet, then prize boxes */}
        <View onLayout={(e) => (sectionY.current.daily = e.nativeEvent.layout.y)}>
          <TourTarget id="home.daily">
            <DailyPickCard />
          </TourTarget>
        </View>

        {/* Prize boxes: start, open and reset right here */}
        <View onLayout={(e) => (sectionY.current.prizes = e.nativeEvent.layout.y)} style={{ gap: 12 }}>
          <TourTarget id="home.prizes" style={{ gap: 12 }}>
            <SectionHeader title="Prizes" icon="gift-outline" />
            <WinBackCard />
            <RewardsCard />
          </TourTarget>
        </View>

        {hasPlayed ? <StreakWagerCard /> : null}

        {/* First-week checklist: compact row, full list opens over the screen */}
        <FirstWeekChecklist />

        {hasPlayed ? (
          <>
            <LadderPromotionHost />
            <QuestsCard />
          </>
        ) : null}

        <WeeklyRecapCard
          bets={bets}
          now={now}
          leagueLine={bestLeague ? `#${bestLeague.me!.rank} of ${bestLeague.memberCount} in ${bestLeague.league.name}` : null}
        />

        {/* Leagues */}
        <SponsoredCard compact style={{ marginVertical: 12 }} />

        <Zone title="Crew" sub="Challenges, leagues and what your friends did" />
        {/* Friend challenges: anything waiting on an answer, or riding on a game */}
        {challengeInbox.length + challengesLive.length + challengesSent.length > 0 ? (
          <>
          <SectionHeader title="Challenges" icon="sword-cross" action="See All" onAction={() => router.push("/challenges")} />
          <Card
            tone={challengeInbox.length ? "accent" : undefined}
            onPress={() => router.push("/challenges")}
            style={styles.rowCard}
            accessibilityLabel="Friend challenges"
          >
            <MaterialCommunityIcons name="sword-cross" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.foreground }]}>
                {challengeInbox.length
                  ? `${challengeInbox.length} challenge${challengeInbox.length > 1 ? "s" : ""} waiting on you`
                  : challengesLive.length
                    ? `${challengesLive.length} challenge${challengesLive.length > 1 ? "s" : ""} locked in`
                    : `${challengesSent.length} challenge${challengesSent.length > 1 ? "s" : ""} sent`}
              </Text>
              <Text style={[styles.rowSub, { color: c.mutedForeground }]}>
                {challengeInbox.length
                  ? `${challengeInbox[0]!.creatorName} wants ${challengeInbox[0]!.away.abbreviation} @ ${challengeInbox[0]!.home.abbreviation}`
                  : `${escrowed.toLocaleString()} credits in friend pots`}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} />
          </Card>
          </>
        ) : null}

        <TourTarget id="home.leagues">
        <SectionHeader title="Your Leagues" action={leagues.length ? "See All" : undefined} onAction={() => router.navigate("/(tabs)/leagues")} />
        </TourTarget>
        {summaries.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="Compete With Friends"
            body="A league gives everyone the same stack of tokens for a season. Best net worth at the end takes the pot."
            action="Start a League"
            onAction={() => router.navigate({ pathname: "/(tabs)/leagues", params: { create: "1" } })}
            secondary="Join With a Code"
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

        <CrewFeedModule />

        </tourScroll.Provider>
        <SponsoredCard style={{ marginTop: 12 }} />
      </ScrollView>
      <BetBreakdownModal
        item={breakdown}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => setQuickGame(gId)}
      />
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
      <PlayerProfileSheet
        uid={showCard ? profile?.uid ?? null : null}
        onClose={() => setShowCard(false)}
        seed={profile ? { displayName: profile.displayName, username: profile.username, avatar: profile.avatar, equipped: profile.equipped, moves: profile.moves, favoriteTeams: profile.favoriteTeams } : undefined}
      />
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

function ResultRow({ n, last, onPress }: { n: AppNotification; last: boolean; onPress: () => void }) {
  const c = useColors();
  const won = n.type === "bet_won" || n.type === "challenge_won";
  const lost = n.type === "bet_lost" || n.type === "challenge_lost";
  const friend = n.type.startsWith("challenge_") ? n.data?.friendName : null;
  const tone = won ? c.positive : lost ? c.negative : c.mutedForeground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${n.bet?.teamAbbr} vs ${n.bet?.opponentAbbr}, ${won ? "Won" : lost ? "Lost" : "Push"}. Tap for bet breakdown`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.result,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        pressed && { backgroundColor: c.secondary },
      ]}
    >
      <View style={[styles.resultIcon, { backgroundColor: c.alpha(tone, 0.14) }]}>
        <MaterialCommunityIcons name={won ? "arrow-up-bold" : lost ? "arrow-down-bold" : "minus"} size={16} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]} numberOfLines={1}>
          {n.bet?.teamAbbr} v {n.bet?.opponentAbbr}
          {n.leagueName ? <Text style={{ color: c.league }}>  · {n.leagueName}</Text> : null}
          {friend ? <Text style={{ color: c.accent }}>  · vs {friend}</Text> : null}
        </Text>
        <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
          {won ? "Won" : lost ? "Lost" : "Push"} · {n.bet?.odds.toFixed(2)}x · Stake {n.bet?.stake.toLocaleString()}
        </Text>
      </View>
      <Amount
        value={won && n.bet ? n.bet.payout - n.bet.stake : n.delta}
        currency={n.wallet === "league" ? "league" : "credits"}
        signed
        size="sm"
        tone={won ? "positive" : lost ? "negative" : "neutral"}
      />
      <MaterialCommunityIcons name="information-outline" size={18} color={c.subtleForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zone: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  zoneTitle: { fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 1.6 },
  zoneSub: { fontSize: 11, fontFamily: "Inter_500Medium", flexShrink: 1 },
  zoneRule: { flex: 1, height: StyleSheet.hairlineWidth, minWidth: 12 },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  h1: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_900Black", letterSpacing: -1 },
  onScene: { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
  wallet: { gap: 8, padding: 18, borderRadius: 22, overflow: "hidden" },
  label: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
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

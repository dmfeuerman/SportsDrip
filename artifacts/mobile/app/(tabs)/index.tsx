import { BOX_TIERS } from "@/constants/prizeTypes";
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
import LevelChallengesCard from "@/components/LevelChallengesCard";
import RewardsCard from "@/components/RewardsCard";
import WinBackCard from "@/components/WinBackCard";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import NextActionCard from "@/components/NextActionCard";
import LiveSweatCard, { type SweatBet } from "@/components/LiveSweatCard";
import WeeklyRecapCard from "@/components/WeeklyRecapCard";
import CrewFeedModule from "@/components/CrewFeed";
import GameQuickView from "@/components/GameQuickView";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { Amount, Button, Card, EmptyState, IconButton, LoadingState, Pill, SectionHeader, useBottomPad, useTopPad } from "@/components/ui";
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

  const { profile, balance, bets, betsLoaded, progress, background, prizeBoxes } = useApp();
  const hasPlayed = bets.length > 0;
  const [showCard, setShowCard] = useState(false);
  const [feedTab, setFeedTab] = useState<"prizes" | "bets" | "leagues">("prizes");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const freeBetReady = !bets.some((b) => b.freeBet && b.freeDay === today && b.status !== "cancelled");
  const readyBoxes = BOX_TIERS.filter((t) => {
    const b = prizeBoxes[t];
    return b.state === "ready" || (b.state === "waiting" && (b.readyAt ?? 0) <= now);
  }).length;
  const streakCount = profile?.streak?.count ?? 0;
  const { nextAfter } = useLevelRewards();
  const onScene = isSceneBackdrop(background);
  const { myLeagueBets, leagues, ready: leaguesReady } = useLeague();
  const { summaries, totalDebt } = useLeagueSummaries();
  const { notifications, unreadCount } = useNotifications();
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
  const sectionRef = { prizes: useRef<React.ComponentRef<typeof View>>(null), daily: useRef<React.ComponentRef<typeof View>>(null) };
  // Measured at tap time against the scroll content: the onLayout y can be stale
  // (cards above it — live sweats, the featured game — load in after it's measured).
  const scrollTo = (section: "prizes" | "daily") => {
    setFeedTab("prizes");
    setTimeout(() => {
      const scroll = scrollRef.current;
      const target = sectionRef[section].current;
      const inner = (scroll as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
      const go = (y: number) => scroll?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      if (target && inner) {
        target.measureLayout(inner as never, (_x: number, y: number) => go(y), () => go(sectionY.current[section]));
      } else go(sectionY.current[section]);
    }, 50);
  };
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
        {/* Game-Lobby Large 3D Avatar Hero with floating claim chips & docked Bankroll HUD */}
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
          footerHeight={142}
          floatingRight={
            freeBetReady || readyBoxes > 0 || challengeInbox.length > 0 ? (
              <>
                {freeBetReady ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Daily free bet ready"
                    onPress={() => {
                      buzz.tick();
                      scrollTo("daily");
                    }}
                    style={({ pressed }) => [styles.lobbyChip, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={[styles.lobbyDot, { backgroundColor: c.positive }]} />
                    <Text style={styles.lobbyChipText}>Free Bet</Text>
                  </Pressable>
                ) : null}
                {readyBoxes > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${readyBoxes} prize box ready`}
                    onPress={() => {
                      buzz.tick();
                      scrollTo("prizes");
                    }}
                    style={({ pressed }) => [styles.lobbyChip, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={[styles.lobbyDot, { backgroundColor: "#FFD54A" }]} />
                    <Text style={styles.lobbyChipText}>{readyBoxes > 1 ? `${readyBoxes} Boxes!` : "Box Ready!"}</Text>
                  </Pressable>
                ) : null}
                {challengeInbox.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${challengeInbox.length} incoming 1v1 challenge`}
                    onPress={() => {
                      buzz.tick();
                      router.push("/challenges");
                    }}
                    style={({ pressed }) => [styles.lobbyChip, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={[styles.lobbyDot, { backgroundColor: c.accent }]} />
                    <Text style={styles.lobbyChipText}>{`1v1 (${challengeInbox.length})`}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null
          }
          footer={
            <View style={styles.hudDock}>
              <View style={styles.hudTopRow}>
                <TourTarget id="home.wallet" style={{ flex: 1 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${balance.toLocaleString()} credits. Open your player card`}
                    onPress={() => {
                      buzz.tick();
                      setShowCard(true);
                    }}
                    style={({ pressed }) => [styles.hudCreditsTap, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={styles.hudCreditsLine}>
                      <MaterialCommunityIcons name="lightning-bolt" size={18} color="#FFD54A" />
                      <Text style={styles.hudCreditsNum} numberOfLines={1} adjustsFontSizeToFit>
                        {balance.toLocaleString()}
                      </Text>
                      <Text style={styles.hudCreditsTag}>CREDITS</Text>
                    </View>
                    <Text style={styles.hudSubLine} numberOfLines={1}>
                      {totalDebt > 0
                        ? `Owes ${totalDebt.toLocaleString()} in leagues`
                        : streakCount > 0
                          ? `🔥 ${streakCount}d streak · Tap for Player Card`
                          : "Tap for Player Card"}
                    </Text>
                  </Pressable>
                </TourTarget>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={openTotal > 0 ? `See your ${openTotal} open bets` : "See your settled bets"}
                  onPress={() => {
                    buzz.tick();
                    router.push(openTotal > 0 ? "/bets" : { pathname: "/bets", params: { tab: "settled" } });
                  }}
                  style={({ pressed }) => [
                    styles.quickBetsBtn,
                    {
                      backgroundColor: openTotal > 0 ? c.alpha(c.primary, 0.22) : "rgba(255,255,255,0.10)",
                      borderColor: openTotal > 0 ? c.alpha(c.primary, 0.65) : "rgba(255,255,255,0.22)",
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="ticket-confirmation-outline" size={15} color={openTotal > 0 ? c.primary : "#FFFFFF"} />
                  <Text style={[styles.quickBetsText, { color: openTotal > 0 ? c.primary : "#FFFFFF" }]}>
                    {openTotal > 0 ? `${openTotal} Bets` : "My Bets"}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={14} color={openTotal > 0 ? c.primary : "rgba(255,255,255,0.7)"} />
                </Pressable>
              </View>
              <View style={styles.hudDivider} />
              <TourTarget id="home.level">
                <LevelBar
                  progress={progress}
                  nextReward={nextAfter(progress.level)}
                  onPress={() => router.push("/levels" as never)}
                  style={styles.embeddedLevelBar}
                />
              </TourTarget>
            </View>
          }
          header={
            <>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={[styles.h1, { color: onScene ? "#FFFFFF" : c.foreground }, onScene && styles.onScene]} numberOfLines={1}>
                  Hello {name}
                </Text>
                {profile?.username ? (
                  <Text style={[styles.handle, { color: onScene ? "rgba(255,255,255,0.85)" : c.mutedForeground }, onScene && styles.onScene]} numberOfLines={1}>
                    @{profile.username}
                  </Text>
                ) : null}
              </View>
              <TourTarget id="home.help"><IconButton icon="help-circle-outline" label="Tutorials" onPress={openTourMenu} /></TourTarget>
              <TourTarget id="home.chat"><IconButton icon="chat-processing-outline" label="Chat" badge={unreadChatCount} onPress={() => router.push("/messages" as never)} /></TourTarget>
              <TourTarget id="home.activity"><IconButton icon="bell-outline" label="Notifications" badge={unreadCount} onPress={() => router.push("/activity")} /></TourTarget>
            </>
          }
        />
        </TourTarget>

        {/* Live games you have money on — directly below the hero */}
        <LiveSweatCard bets={sweat} gameById={gameById} onOpen={setQuickGame} />

        {/* 3-button nav: Prizes | Bets | Leagues (opens to Prizes first) */}
        <View style={[styles.segTrack, { backgroundColor: c.card, borderColor: c.border }]}>
          {(
            [
              { value: "prizes" as const, label: readyBoxes > 0 ? `Prizes (${readyBoxes})` : "Prizes" },
              { value: "bets" as const, label: openTotal > 0 ? `Bets (${openTotal})` : "Bets" },
              { value: "leagues" as const, label: leagues.length > 0 ? `Leagues (${leagues.length})` : "Leagues" },
            ] as const
          ).map((opt) => {
            const selected = feedTab === opt.value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  buzz.tick();
                  setFeedTab(opt.value);
                }}
                style={[styles.segPill, selected && { backgroundColor: c.foreground }]}
              >
                <Text style={[styles.segText, { color: selected ? c.background : c.mutedForeground }]} numberOfLines={1}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {feedTab === "prizes" ? (
          <>
            <View ref={sectionRef.daily} collapsable={false} onLayout={(e) => (sectionY.current.daily = e.nativeEvent.layout.y)}>
              <TourTarget id="home.daily">
                <DailyPickCard />
              </TourTarget>
            </View>
            <View ref={sectionRef.prizes} collapsable={false} onLayout={(e) => (sectionY.current.prizes = e.nativeEvent.layout.y)} style={{ gap: 12 }}>
              <TourTarget id="home.prizes" style={{ gap: 12 }}>
                <SectionHeader title="Prizes" icon="gift-outline" />
                <WinBackCard />
                <RewardsCard />
              </TourTarget>
            </View>
          </>
        ) : feedTab === "bets" ? (
          <>
            <TourTarget id="home.bets">
            <SectionHeader
              title="My Bets"
              action="See All"
              onAction={() => router.push(openTotal > 0 ? "/bets" : { pathname: "/bets", params: { tab: "settled" } })}
            />
            </TourTarget>
            {openTotal === 0 && !betsLoaded ? (
              <LoadingState label="Loading your bets…" />
            ) : openTotal === 0 ? (
              <EmptyState icon="ticket-outline" title="Nothing Riding" body="Back a team on the board — results pop up here the moment the game's final." action="Browse Games" onAction={() => router.navigate("/(tabs)/games")} />
            ) : (
              <>
                {openCredit.slice(0, 3).map((b) => (
                  <BetTicket key={b.id} spacing={0} bet={b} game={gameById.get(b.gameId) ?? null} onOpen={() => setQuickGame(b.gameId)} />
                ))}
                {openLeague.slice(0, Math.max(0, 3 - openCredit.length)).map(({ b, league }) => (
                  <BetTicket key={b.id} spacing={0} bet={b} walletLabel={league} game={gameById.get(b.gameId) ?? null} onOpen={() => setQuickGame(b.gameId)} />
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
            {featured ? <FeaturedGameCard game={featured} sides={NO_SIDES} onOpen={(g) => setQuickGame(g.id)} /> : null}
            {results.length > 0 ? (
              <Button label="Results & History" icon="history" variant="ghost" size="sm" onPress={() => router.push("/activity")} />
            ) : null}
          </>
        ) : (
          <>
            <TourTarget id="home.leagues">
            <SectionHeader title="Your Leagues" action={leagues.length ? "See All" : undefined} onAction={() => router.navigate("/(tabs)/leagues")} />
            </TourTarget>
            {summaries.length === 0 && !leaguesReady ? (
              <LoadingState label="Loading your leagues…" />
            ) : summaries.length === 0 ? (
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
          </>
        )}

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

        {/* First-week checklist: compact row, full list opens over the screen */}
        <FirstWeekChecklist />

        <Zone title="XP Challenges" sub="Bonus XP & weekly recap" />
        {/* XP challenges show from day one: level 1 is "explore the app". */}
        <LevelChallengesCard />
        {hasPlayed ? <LadderPromotionHost /> : null}

        <WeeklyRecapCard
          bets={bets}
          now={now}
          leagueLine={bestLeague ? `#${bestLeague.me!.rank} of ${bestLeague.memberCount} in ${bestLeague.league.name}` : null}
        />

        <Zone title="Crew" sub="Challenges and what your friends did" />
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
        <CrewFeedModule />



        </tourScroll.Provider>
        {/* The one ad on Home: below everything, after the player has seen their own stuff. */}
        <SponsoredCard compact style={{ marginTop: 12 }} />
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
  handle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 1 },
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
  lobbyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(10, 11, 14, 0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  lobbyDot: { width: 8, height: 8, borderRadius: 4 },
  lobbyChipText: { color: "#FFFFFF", fontSize: 12, fontFamily: "Inter_700Bold" },
  hudDock: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "rgba(10, 12, 16, 0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  hudTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  hudCreditsTap: { gap: 1 },
  hudCreditsLine: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  hudCreditsNum: { color: "#FFFFFF", fontSize: 22, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.6 },
  hudCreditsTag: { color: "#FFD54A", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1 },
  hudSubLine: { color: "rgba(255,255,255,0.68)", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  quickBetsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickBetsText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  hudDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" },
  embeddedLevelBar: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 2,
    paddingLeft: 0,
    paddingRight: 0,
    borderRadius: 0,
  },
  segTrack: { flexDirection: "row", borderRadius: 999, borderWidth: 1, padding: 4, gap: 4 },
  segPill: { flex: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

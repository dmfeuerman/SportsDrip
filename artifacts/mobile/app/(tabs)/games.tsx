import BackToLevels from "@/components/BackToLevels";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { tourEvent, tourPractice, tourStake, useTourState } from "@/lib/tour/store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import BetModal, { type BetWallet, type SlipExtras } from "@/components/BetModal";
import GameCard, { type MyPosition } from "@/components/GameCard";
import FeaturedGameCard, { pickFeatured } from "@/components/FeaturedGameCard";
import GameQuickView, { type FollowIntent } from "@/components/GameQuickView";
import TailSheet from "@/components/TailSheet";
import GameDetailSheet, { type DetailBet } from "@/components/GameDetailSheet";
import SponsoredCard from "@/components/ads/SponsoredCard";
import BannerSlot from "@/components/ads/BannerSlot";
import { useFriends } from "@/hooks/useFriends";
import TokenBalance from "@/components/TokenBalance";
import { FilterPills } from "@/components/ui";
import { SPORT_COLORS } from "@/constants/colors";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { AD_POLICY } from "@/constants/ads";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { holdsMyStake, useChallenges, viewOf } from "@/context/ChallengeContext";
import { useBoardLeagueSides, useLeague } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";
import { useParlay } from "@/context/ParlayContext";
import { prefetchGameInsights } from "@/hooks/useGameInsights";
import { openGameCenter } from "@/lib/gameCenter";
import * as api from "@/lib/api";
import { newIdempotencyKey } from "@/lib/api";
import { quoteMarket, weekKey, type Market, type Selection } from "@/lib/markets";
import { SPORTS, sideOdds, type Game, type Side } from "@/types/game";

const ALL = "ALL";

type Row =
  | { kind: "section"; id: string; title: string; live?: boolean }
  | { kind: "game"; id: string; game: Game }
  | { kind: "ad"; id: string }
  | { kind: "thin"; id: string };

export default function GamesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { balance, bets, error, clearError, profile, placeBet } = useApp();
  const { leagues, activeLeagues, uid, placeLeagueBet, myLeagueBets } = useLeague();
  const { friends } = useFriends(uid ?? null);
  const { betLocked } = useToast();
  const { live, upcoming, loading, error: gamesError } = useGames();
  const boardSides = useBoardLeagueSides(uid);
  const { enabled: adsOn } = useAds();
  const params = useLocalSearchParams<{ wallet?: string; challenge?: string; challengeName?: string }>();
  const challenges = useChallenges();
  const { show } = useToast();
  const [target, setTarget] = useState<{ uid: string; name: string } | null>(null);
  useEffect(() => {
    if (params.challenge) {
      setTarget({ uid: params.challenge, name: params.challengeName || "your friend" });
      router.setParams({ challenge: undefined, challengeName: undefined });
    }
  }, [params.challenge, params.challengeName]);
  const [slipError, setSlipError] = useState<string | null>(null);

  const [sport, setSport] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pending, setPending] = useState<{
    game: Game;
    side: Side;
    market?: Market;
    selection?: Selection;
    key: string;
    friend?: boolean;
  } | null>(null);
  const [detail, setDetail] = useState<Game | null>(null);
  const [tailGame, setTailGame] = useState<Game | null>(null);
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [follow, setFollow] = useState<FollowIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 84;

  const openBets =
    bets.filter((b) => b.status === "pending").length +
    Object.values(myLeagueBets).reduce((n, list) => n + list.filter((b) => b.status === "pending").length, 0);

  const positions = useMemo(() => {
    const map = new Map<string, MyPosition>();
    for (const b of bets) {
      if (b.status !== "pending" || map.has(b.gameId)) continue;
      map.set(b.gameId, {
        side: b.side,
        label: b.label,
        stake: b.stake,
        potentialPayout: b.potentialPayout,
      });
    }
    for (const lg of leagues) {
      for (const b of myLeagueBets[lg.id] ?? []) {
        if (b.status !== "pending" || map.has(b.gameId)) continue;
        map.set(b.gameId, {
          side: b.side,
          label: b.label,
          stake: b.stake,
          potentialPayout: b.potentialPayout,
        });
      }
    }
    const me = challenges.uid;
    if (me) {
      for (const [gameId, list] of challenges.byGame) {
        if (map.has(gameId)) continue;
        const ch = list.find((x) => holdsMyStake(x, me));
        if (!ch) continue;
        const v = viewOf(ch, me);
        map.set(gameId, { side: v.mySide, stake: v.myStake, potentialPayout: ch.pot });
      }
    }
    return map;
  }, [bets, leagues, myLeagueBets, challenges.byGame, challenges.uid]);

  // Thin banners only for players with a real social graph (10+ friends or leagues).
  const thinOn = friends.length > 10 || leagues.length > 10;
  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const teamHit = (t: { name: string; abbreviation: string }) => t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q);
    const match = (g: Game) => (sport === ALL || g.sport === sport) && (!q || teamHit(g.homeTeam) || teamHit(g.awayTeam));
    const l = live.filter(match);
    const u = upcoming.filter(match);
    const out: Row[] = [];
    let seen = 0;
    let ads = 0;
    let pendingBig = false;
    let pendingThin = false;
    // An ad is placed lazily, just before the next row that follows it, so it never
    // trails the list and never sits next to another ad.
    const flush = () => {
      if (!pendingBig && !pendingThin) return;
      const last = out[out.length - 1];
      if (last && last.kind !== "ad" && last.kind !== "thin") {
        if (pendingBig && adsOn && sport === ALL && ads < AD_POLICY.boardMax) {
          out.push({ kind: "ad", id: `ad-${ads}` });
          ads += 1;
        } else if (pendingThin && thinOn) out.push({ kind: "thin", id: `thin-${seen}` });
      }
      pendingBig = false;
      pendingThin = false;
    };
    const pushGame = (g: Game) => {
      flush();
      out.push({ kind: "game", id: g.id, game: g });
      seen += 1;
      const slot = seen - AD_POLICY.boardFirstAfter;
      if (adsOn && sport === ALL && slot >= 0 && slot % AD_POLICY.boardEvery === 0) pendingBig = true;
      // Thin banner after games 3, 7, 10, 14, 17… (every 3 or 4 games).
      if (thinOn && (seen % 7 === 3 || seen % 7 === 0)) pendingThin = true;
    };
    if (l.length) {
      flush();
      out.push({ kind: "section", id: "sec-live", title: "Live Now", live: true });
      l.forEach(pushGame);
    }
    let lastDay = "";
    for (const g of u) {
      const day = dayKey(g.startsAt);
      if (day !== lastDay) {
        flush();
        lastDay = day;
        out.push({ kind: "section", id: `sec-${day}`, title: dayTitle(g.startsAt) });
      }
      pushGame(g);
    }
    return out;
  }, [live, upcoming, sport, adsOn, thinOn, query]);
  // The tutorials point at the first two games you can actually bet on (the second is a parlay's other leg).
  const listRef = useRef<FlatList<Row>>(null);
  const tourScroll = useTourScroll(listRef);
  const parlay = useParlay();
  const touring = !!useTourState().tour;
  const [firstGameId, secondGameId] = useMemo(() => {
    const games = rows.filter((r): r is Extract<Row, { kind: "game" }> => r.kind === "game").map((r) => r.game);
    const open = games.filter((g) => g.status === "upcoming" && g.priced && !g.disrupted);
    return [open[0]?.id, open[1]?.id];
  }, [rows]);

  const featured = useMemo(() => {
    const favs = new Set((profile?.favoriteTeams ?? []).map((t) => `${t.sport}:${t.abbr}`));
    const pool = upcoming.filter((g) => sport === ALL || g.sport === sport);
    return pickFeatured(pool, boardSides, favs, Date.now());
  }, [upcoming, sport, boardSides, profile?.favoriteTeams]);

  // The game of the day steps aside while searching.
  const featuredShown = !!featured && !query.trim();

  const openBetSheet = useCallback(
    (game: Game, side: Side, friend?: boolean, market?: Market, selection?: Selection) => {
      prefetchGameInsights(game.id);
      setSlipError(null);
      setPending({ game, side, market, selection, key: newIdempotencyKey(), friend: friend || !!target });
      tourEvent("slip:open");
    },
    [target]
  );

  // Stable handlers so the memoised GameCards don't all re-render on every screen update.
  const onCardBet = useCallback(
    (g: Game, s: Side, m?: Market, sel?: Selection) => openBetSheet(g, s, false, m, sel),
    [openBetSheet]
  );
  const onCardChallenge = useCallback((g: Game, s: Side) => openBetSheet(g, s, true), [openBetSheet]);

  const onChallengeSent = useCallback(
    (sent: { friendName: string; teamAbbr: string; teamColor: string; stake: number; pot: number }) => {
      setPending(null);
      setTarget(null);
      show({
        id: `chsent_${Date.now()}`,
        kind: "social",
        icon: "sword-cross",
        color: sent.teamColor,
        title: `Challenge sent to ${sent.friendName}`,
        body: `${sent.stake.toLocaleString()} on ${sent.teamAbbr} is in the pot. Winner takes ${sent.pot.toLocaleString()} once they accept.`,
        cta: "View",
        href: "/challenges",
      });
    },
    [show]
  );

  const wallets: BetWallet[] = useMemo(() => {
    const out: BetWallet[] = [{ id: "credits", label: "Credits", balance, kind: "credits" }];
    if (!pending || !uid) return out;
    for (const lg of activeLeagues) {
      if (!lg.allowedSports.includes(pending.game.sport)) continue;
      if (pending.game.startsAt >= lg.endsAt) continue;
      const me = lg.members[uid];
      if (!me) continue;
      out.push({ id: lg.id, label: lg.name, balance: me.leagueTokens, kind: "league" });
    }
    return out;
  }, [pending, activeLeagues, uid, balance]);

  const lockUsedMap: Record<string, boolean> = useMemo(() => {
    const wk = weekKey();
    const out: Record<string, boolean> = {};
    for (const lg of activeLeagues) {
      const me = uid ? lg.members[uid] : undefined;
      out[lg.id] =
        me?.lastLockWeek === wk ||
        (myLeagueBets[lg.id] ?? []).some((b) => b.lockWeek === wk && b.status !== "cancelled");
    }
    return out;
  }, [activeLeagues, uid, myLeagueBets]);

  const confirmBet = useCallback(
    async (stake: number, walletId: string, extras?: SlipExtras) => {
      if (!pending) return;
      const m: Market = pending.market ?? "ml";
      const sel: Selection = pending.selection ?? pending.side;
      const q = quoteMarket(pending.game, m, sel);
      if (!q || !q.odds) {
        setSlipError("No line yet for this game. Check back closer to kickoff.");
        return;
      }
      // Tutorials: a practice bet goes nowhere; the first-bet tutorial wants its exact stake.
      if (tourPractice()) {
        const pt = (q.side ?? pending.side) === "home" ? pending.game.homeTeam : pending.game.awayTeam;
        setPending(null);
        buzz.success();
        betLocked({
          test: true,
          teamName: q.label || pt.name,
          teamAbbr: pt.abbreviation,
          teamColor: pt.color,
          odds: q.odds,
          stake,
          payout: Math.round(stake * q.odds),
          currency: "credits",
          walletLabel: "Test — nothing staked",
        });
        tourEvent("bet:placed");
        return;
      }
      const required = tourStake();
      if (required != null && stake !== required) {
        setSlipError(`For this tutorial bet, stake exactly ${required} credits.`);
        return;
      }
      const oddsVal = q.odds;
      const Q = q;
      // Instant: the slip closes and the bet shows now; the server confirms behind it.
      setSlipError(null);
      if (walletId === "credits") {
        const t = (q.side ?? pending.side) === "home" ? pending.game.homeTeam : pending.game.awayTeam;
        const o = (q.side ?? pending.side) === "home" ? pending.game.awayTeam : pending.game.homeTeam;
        const ok = await placeBet({
          gameId: pending.game.id,
          side: q.side ?? undefined,
          market: m,
          selection: sel,
          expectedLine: q.line ?? undefined,
          stake,
          idempotencyKey: pending.key,
          expectedOdds: oddsVal,

          preview: {
            gameId: pending.game.id,
            sport: pending.game.sport,
            side: (q.side ?? pending.side),
            market: Q.market,
            selection: Q.selection,
            line: Q.line ?? null,
            label: q.label,
            startsAt: pending.game.startsAt,
            voidReason: null,
            teamName: Q.teamName || t.name,
            teamAbbr: Q.teamAbbr || t.abbreviation,
            teamColor: Q.teamColor || t.color,
            opponentAbbr: Q.opponentAbbr || o.abbreviation,
            odds: Q.odds!,
            potentialPayout: Math.round(stake * Q.odds!),
            opponentUid: null,
          },
        });
        if (!ok) {
          buzz.error();
          setSlipError("Not enough credits.");
          return;
        }
        tourEvent("bet:placed");
      } else {
        const key = pending.key;
        placeLeagueBet({
          leagueId: walletId,
          gameId: pending.game.id,
          side: q.side ?? undefined,
          market: m,
          selection: sel,
          expectedLine: q.line ?? undefined,
          lock: extras?.lock,
          hidden: extras?.hidden,
          stake,
          idempotencyKey: `${pending.key}${walletId.slice(-4)}`,
          expectedOdds: oddsVal,

        }).then((why) => {
          if (why) show({ id: `lbet_fail_${key}`, kind: "warning", title: "Bet didn't go through", body: `${why} Your league balance wasn't charged.` });
        });
      }
      buzz.success();
      {
        const t = (q.side ?? pending.side) === "home" ? pending.game.homeTeam : pending.game.awayTeam;
        const w = wallets.find((x) => x.id === walletId);
        betLocked({
          teamName: q.label || t.name,
          teamAbbr: t.abbreviation,
          teamColor: t.color,
          odds: oddsVal,
          stake,
          payout: Math.round(stake * oddsVal),
          currency: walletId === "credits" ? "credits" : "league",
          walletLabel: w?.label,
          leagueId: walletId === "credits" ? undefined : walletId,
          gameId: pending.game.id,
          hidden: !!extras?.hidden,
        });
      }
      setPending(null);
    },
    [pending, placeLeagueBet, placeBet, show, wallets, betLocked]
  );


  const detailBets: DetailBet[] = useMemo(() => {
    if (!detail) return [];
    const out: DetailBet[] = bets.filter((b) => b.gameId === detail.id);
    for (const lg of leagues) {
      for (const b of myLeagueBets[lg.id] ?? []) {
        if (b.gameId === detail.id) out.push({ ...b, id: `${lg.id}:${b.id}`, wallet: lg.name });
      }
    }
    return out;
  }, [detail, bets, leagues, myLeagueBets]);

  const betFromDetail = useCallback(
    (game: Game, side: Side, friend?: boolean, market?: Market, selection?: Selection) => {
      setDetail(null);
      if (Platform.OS === "ios") setTimeout(() => openBetSheet(game, side, friend, market, selection), 350);
      else openBetSheet(game, side, friend, market, selection);
    },
    [openBetSheet]
  );

  const team = pending
    ? pending.side === "home"
      ? pending.game.homeTeam
      : pending.game.awayTeam
    : null;
  const pendingQuote = pending
    ? quoteMarket(pending.game, pending.market ?? "ml", pending.selection ?? pending.side)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <BackToLevels />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Games</Text>
          <View style={styles.headerRight}>
            {openBets > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${openBets} open bets. Open My bets`}
                onPress={() => router.push("/bets")}
                style={[styles.pendingBadge, { backgroundColor: colors.alpha(colors.accent, 0.16), borderColor: colors.alpha(colors.accent, 0.5) }]}
              >
                <Text style={[styles.pendingText, { color: colors.accent }]}>{openBets} open</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                if (searchOpen) setQuery("");
                setSearchOpen((o) => !o);
              }}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? "Close search" : "Search teams"}
              hitSlop={8}
              style={[styles.searchToggle, { backgroundColor: searchOpen ? colors.alpha(colors.primary, 0.16) : colors.secondary, borderColor: searchOpen ? colors.alpha(colors.primary, 0.5) : colors.border }]}
            >
              <MaterialCommunityIcons name={searchOpen ? "close" : "magnify"} size={18} color={searchOpen ? colors.primary : colors.foreground} />
            </Pressable>
            <TourTarget id="games.balance"><TokenBalance tokens={balance} earn /></TourTarget>
          </View>
        </View>

        <TourTarget id="games.filters">
        <FilterPills
          gap={14}
          value={sport}
          onChange={setSport}
          options={[
            { value: ALL, label: "All", icon: "trophy-outline" as const },
            ...SPORTS.map((sp) => ({ value: sp, label: sp, icon: SPORT_ICONS[sp] as never, color: SPORT_COLORS[sp] })),
          ]}
        />
        </TourTarget>
        {searchOpen ? (
        <View style={[styles.searchBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search teams"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                setQuery("");
                setSearchOpen(false);
                Keyboard.dismiss();
              }}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <MaterialCommunityIcons name="close-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        ) : null}
      </View>

      {target && (
        <View style={[styles.banner, { backgroundColor: colors.alpha(colors.accent, 0.12), borderColor: colors.alpha(colors.accent, 0.6) }]}>
          <MaterialCommunityIcons name="sword-cross" size={16} color={colors.accent} />
          <Text style={[styles.bannerText, { color: colors.foreground }]} numberOfLines={2}>
            Tap a team on any upcoming game to challenge {target.name}.
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel challenge" hitSlop={10} onPress={() => setTarget(null)}>
            <MaterialCommunityIcons name="close" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {error && (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onPress={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error}</Text>
          <MaterialCommunityIcons name="close" size={15} color={colors.destructive} />
        </Pressable>
      )}

      {loading ? (
        <SkeletonList colors={colors} />
      ) : (
        <tourScroll.Provider>
        <FlatList
          ref={listRef}
          onScroll={tourScroll.onScroll}
          scrollEventThrottle={tourScroll.scrollEventThrottle}
          data={rows}
          keyExtractor={(r) => r.id}
          ListFooterComponent={sport !== ALL && rows.length ? <SponsoredCard style={{ marginVertical: 12 }} /> : undefined}
          // Child 0 is the featured header when there is one, so section rows sit one further down.
          stickyHeaderIndices={rows
            .map((r, i) => (r.kind === "section" ? i + (featuredShown ? 1 : 0) : -1))
            .filter((i) => i >= 0)}
          ListHeaderComponent={
            featuredShown ? (
              <TourTarget id="games.featured"><FeaturedGameCard game={featured} sides={boardSides.get(featured.id) ?? []} onOpen={setDetail} /></TourTarget>
            ) : undefined
          }
          renderItem={({ item }) =>
            item.kind === "ad" ? (
              <SponsoredCard compact style={styles.adRow} />
            ) : item.kind === "thin" ? (
              <BannerSlot thin style={styles.adRow} />
            ) : item.kind === "section" ? (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                {item.live ? (
                  <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
                ) : (
                  <MaterialCommunityIcons name="calendar-clock" size={15} color={colors.mutedForeground} />
                )}
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{item.title}</Text>
              </View>
            ) : (
              <GameCard
                tourKey={item.game.id === firstGameId ? "first" : item.game.id === secondGameId ? "second" : undefined}
                game={item.game}
                onBet={onCardBet}
                onChallenge={onCardChallenge}
                onOpenDetail={touring ? undefined : setDetail}
                position={positions.get(item.game.id) ?? null}
                leagueMembers={boardSides.get(item.game.id)}
                onLeaguePress={setTailGame}
              />
            )
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          ListEmptyComponent={
            <EmptyState
              colors={colors}
              error={gamesError}
              sport={sport}
              query={query.trim()}
              onClearFilter={() => setSport(ALL)}
            />
          }
        />
        </tourScroll.Provider>
      )}

      <GameDetailSheet
        game={detail}
        onClose={() => setDetail(null)}
        onBet={(g, side, market, selection) => betFromDetail(g, side, false, market, selection)}
        onChallenge={(g, side) => betFromDetail(g, side, true)}
        bets={detailBets}
        onOpenCenter={(game) => {
          setDetail(null);
          openGameCenter(game.id, game.status === "upcoming" ? "matchup" : "live");
        }}
      />

      {pending && team && (
        <BetModal
          visible
          onClose={() => setPending(null)}
          onConfirm={confirmBet}
          teamName={team.name}
          teamAbbr={team.abbreviation}
          teamColor={team.color}
          pickTitle={pendingQuote?.label}
          lockUsed={lockUsedMap}
          odds={pendingQuote ? pendingQuote.odds : sideOdds(pending.game, pending.side)}
          game={pending.game}
          side={pending.side}
          wallets={wallets}
          defaultWallet={params.wallet}
          error={slipError}
          submitting={submitting}
          onAddToParlay={
            parlay.legs.length === 0 && pendingQuote?.odds
              ? () => {
                  const g = pending.game;
                  parlay.add({
                    gameId: g.id,
                    market: pendingQuote.market,
                    selection: pendingQuote.selection,
                    label: pendingQuote.label,
                    odds: pendingQuote.odds!,
                    sport: g.sport,
                    matchup: `${g.awayTeam.abbreviation} @ ${g.homeTeam.abbreviation}`,
                    startsAt: g.startsAt,
                  });
                  setPending(null);
                  tourEvent("parlay:add");
                }
              : undefined
          }
          challenge={{
            initial: pending.friend,
            friendUid: target?.uid,
            onSent: onChallengeSent,
            onFindFriends: () => {
              setPending(null);
              router.navigate({ pathname: "/(tabs)/leagues", params: { seg: "friends" } });
            },
          }}
          gameSummary={`${pending.game.awayTeam.abbreviation} @ ${pending.game.homeTeam.abbreviation} · ${pending.game.sport}`}
        />
      )}

      <TailSheet
        game={tailGame}
        members={tailGame ? boardSides.get(tailGame.id) ?? [] : []}
        onClose={() => setTailGame(null)}
        onFollow={(gameId, intent) => {
          setTailGame(null);
          setFollow(intent);
          setQuickGame(gameId);
        }}
      />
      <GameQuickView
        gameId={quickGame}
        onClose={() => {
          setQuickGame(null);
          setFollow(null);
        }}
        defaultWallet={follow?.leagueId}
        follow={follow}
      />
    </View>
  );
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayTitle(ms: number): string {
  const d = new Date(ms);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function SkeletonList({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.listContent}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[styles.skeleton, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.skelBar, { backgroundColor: colors.secondary, width: "35%" }]} />
          <View style={styles.skelRow}>
            <View style={[styles.skelBar, { backgroundColor: colors.secondary, flex: 1, height: 46 }]} />
            <View style={[styles.skelBar, { backgroundColor: colors.secondary, flex: 1, height: 46 }]} />
          </View>
        </View>
      ))}
      <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 12 }} />
    </View>
  );
}

function EmptyState({
  colors,
  error,
  sport,
  query,
  onClearFilter,
}: {
  colors: ReturnType<typeof useColors>;
  error: string | null;
  sport: string;
  query: string;
  onClearFilter: () => void;
}) {
  const filtered = sport !== ALL;
  return (
    <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <MaterialCommunityIcons
        name={error ? "wifi-off" : "calendar-blank-outline"}
        size={34}
        color={colors.mutedForeground}
      />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {error
          ? "Can't reach the board"
          : query
            ? `No games matching "${query}"`
            : filtered
              ? `No ${sport} games right now`
              : "No games on the board"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {error
          ? "You're offline, or the scores service is down. The board will fill in on its own once you're back."
          : "Fixtures land here as soon as they're scheduled. Check back closer to game day."}
      </Text>
      {filtered && !error && (
        <Pressable
          style={[styles.emptyBtn, { borderColor: colors.alpha(colors.primary, 0.6), backgroundColor: colors.alpha(colors.primary, 0.12) }]}
          onPress={onClearFilter}
        >
          <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Show All Sports</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 6 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  searchToggle: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  header: { borderBottomWidth: 1, paddingBottom: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  pendingBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pendingText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  filterList: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  listContent: { padding: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  adRow: { marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  skeleton: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  skelBar: { height: 12, borderRadius: 6 },
  skelRow: { flexDirection: "row", gap: 10 },
  empty: {
    alignItems: "center",
    gap: 10,
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 24,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  emptyBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, minHeight: 38, justifyContent: "center", marginTop: 4 },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});


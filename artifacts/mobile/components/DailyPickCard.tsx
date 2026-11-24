import { FREE_PER_DAY } from "@/components/StreakBanner";
import { nyDayOf } from "@/lib/streakGrid";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { trackEvent } from "@/lib/analytics";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import PressableScale from "@/components/fx/PressableScale";
import { TourTarget } from "@/components/tour/TourTarget";
import { tourEvent } from "@/lib/tour/store";
import Shimmer from "@/components/fx/Shimmer";
import { Pressable } from "@/components/fx/Tap";
import StreakMilestoneCard from "@/components/StreakMilestoneCard";
import TeamCrest from "@/components/TeamCrest";
import { ActionChip, Button, ChoiceDialog, Pill } from "@/components/ui";
import { LiquidGlass } from "@/components/ui/LiquidGlass";
import { useLeague } from "@/context/LeagueContext";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { formatOdds, untilKickoff } from "@/lib/odds";
import { hasSpreadLine, hasTotalLine, quoteMarket, type Market, type Selection } from "@/lib/markets";
import { router } from "expo-router";
import KeyboardSheet from "@/components/KeyboardSheet";
import { useGames } from "@/hooks/useGames";
import { useOddsFormat } from "@/lib/settings";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { SPORTS, type Game, type Sport } from "@/types/game";

const SPORT_SHORT_LABEL: Record<Sport, string> = {
  NFL: "NFL",
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  NCAAF: "NCAAF",
  NCAAB: "NCAAB",
  Soccer: "SOC",
};
import { weekDays, weekGrid, weekRecord, type DailyResult } from "@/lib/streakGrid";

interface Team {
  abbreviation: string;
  name?: string;
  color?: string;
}
interface Featured {
  day: string;
  gameId: string;
  sport: string | null;
  startsAt: number;
  homeTeam: Team | null;
  awayTeam: Team | null;
}
interface MyPick {
  side: "home" | "away";
  teamAbbr: string | null;
  result: "won" | "lost" | "push" | null;
}

/** Today's date in America/New_York, matching the server's nyDay. */
function nyDay(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Games the free bet can go on: upcoming, a few minutes out, soonest first. */
function bettable(games: Game[], now: number): Game[] {
  return games
    .filter((g) => g.status === "upcoming" && g.startsAt > now + 2 * 60_000 && !g.disrupted)
    .sort((a, b) => a.startsAt - b.startsAt);
}

type Choice = { market: Market; selection: Selection };
const sideOf = (ch: Choice): "home" | "away" => (ch.market === "total" ? (ch.selection === "over" ? "home" : "away") : (ch.selection as "home" | "away"));
const winningsAt = (odds: number, stake: number) => Math.max(1, Math.round(stake * odds) - stake);
const same = (a: Choice | null, b: Choice | null) => !!a && !!b && a.market === b.market && a.selection === b.selection;

/**
 * Golden VIP Ticket — 2026 Liquid Glass Daily Free Bet card.
 * Every day you get a zero-risk free bet (1,000 + 100 per active streak day, max 7).
 * Uses existing TeamCrest badges, warm gold dome glow, side ticket notches,
 * horizontal game pills, and a full-width shimmering gold lock-in button.
 */
export default function DailyPickCard({ onLeave }: { onLeave?: () => void } = {}) {
  const c = useColors();
  const now = useNow(30_000);
  const fmt = useOddsFormat();
  const { profile, bets, placeFreeBet, switchFreeBet } = useApp();
  const { show } = useToast();
  const { games } = useGames(["upcoming", "live"]);
  const uid = profile?.uid ?? null;
  const day = nyDay(now);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [token, setToken] = useState<{ betId: string } | null>(null);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [details, setDetails] = useState(false);
  const [milestone, setMilestone] = useState<number | null>(null);
  const [weekText, setWeekText] = useState<string | null>(null);
  const [mine, setMine] = useState<MyPick | null>(null);
  const { activeLeagues, sendMessage } = useLeague();

  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    const a = onSnapshot(doc(db, "dailyPick", day), (s) => setFeatured(s.exists() ? (s.data() as Featured) : null), () => {});
    const b = onSnapshot(doc(db, "users", uid, "dailyPicks", day), (s) => setMine(s.exists() ? (s.data() as MyPick) : null), () => {});
    const t = onSnapshot(doc(db, "users", uid, "freeBets", day), (s) => setToken(s.exists() ? (s.data() as { betId: string }) : null), () => {});
    return () => {
      a();
      b();
      t();
    };
  }, [uid, day]);

  const placed = useMemo(
    () => bets.find((b) => b.freeBet && b.freeDay === day && b.status !== "cancelled") ?? (token ? bets.find((b) => b.id === token.betId && b.status !== "cancelled") : undefined),
    [bets, day, token]
  );
  const used = !!placed || !!token;
  const placedChoice: Choice | null = placed ? { market: placed.market ?? "ml", selection: placed.selection ?? placed.side } : null;

  const options = useMemo(() => bettable(games, now), [games, now]);
  const sportCounts = useMemo(() => {
    const counts: Record<Sport, number> = { NFL: 0, NBA: 0, MLB: 0, NHL: 0, NCAAF: 0, NCAAB: 0, Soccer: 0 };
    for (const g of options) counts[g.sport] = (counts[g.sport] ?? 0) + 1;
    return counts;
  }, [options]);
  const orderedSports = useMemo(() => {
    const rank = (s: Sport) => {
      const open = (sportCounts[s] ?? 0) > 0;
      if (open) return s === "Soccer" ? 1 : 0;
      return s === "Soccer" ? 3 : 2;
    };
    return [...SPORTS].sort((a, b) => rank(a) - rank(b));
  }, [sportCounts]);
  const byId = (id: string | null | undefined) => (id ? games.find((g) => g.id === id) : undefined);
  const placedGame = useMemo(() => (placed ? byId(placed.gameId) : undefined), [games, placed?.gameId]);
  const leftmostSport: Sport | null = useMemo(
    () => orderedSports.find((s) => sportCounts[s] > 0) ?? null,
    [orderedSports, sportCounts]
  );
  const activeSport: Sport | null = useMemo(() => {
    if (selectedSport && sportCounts[selectedSport] > 0) return selectedSport;
    if (placedGame && sportCounts[placedGame.sport] > 0) return placedGame.sport;
    return leftmostSport ?? placedGame?.sport ?? null;
  }, [selectedSport, sportCounts, placedGame, leftmostSport]);
  const sportOptions = useMemo(
    () => (activeSport ? options.filter((g) => g.sport === activeSport) : options),
    [options, activeSport]
  );
  const game = useMemo(
    () =>
      (gameId ? sportOptions.find((g) => g.id === gameId) ?? byId(gameId) : undefined) ??
      (!selectedSport ? placedGame : undefined) ??
      sportOptions[0] ??
      placedGame ??
      null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, gameId, selectedSport, placedGame, sportOptions]
  );
  const open = !!game && game.status === "upcoming" && game.startsAt > now + 60_000;
  const onPlacedGame = !!placed && game?.id === placed.gameId;
  const current: Choice | null = choice ?? (onPlacedGame ? placedChoice : null);
  const changed = !!placed && !(onPlacedGame && same(current, placedChoice));
  const canSwitch = !!placed && placed.status === "pending" && !!placed.startsAt && placed.startsAt > now && open;

  const streak = profile?.streak;
  const alive = !!streak?.count;
  const activeDays =
    streak?.count && (streak.lastDay === nyDayOf(Date.now()) || streak.lastDay === nyDayOf(Date.now() - 86_400_000))
      ? Math.min(7, streak.count)
      : 0;
  const freeStake = 1000 + activeDays * FREE_PER_DAY;

  const lockIn = async () => {
    if (!game || !current || !open) return;
    const q = quoteMarket(game, current.market, current.selection);
    if (!q.odds) {
      show({ kind: "warning", title: "No price on that yet", body: "Pick another option or game for your free bet." });
      return;
    }
    const sd = sideOf(current);
    const t = sd === "home" ? game.homeTeam : game.awayTeam;
    const o = sd === "home" ? game.awayTeam : game.homeTeam;
    const args = {
      gameId: game.id,
      side: sd,
      market: current.market,
      selection: current.selection,
      day,
      preview: {
        gameId: game.id,
        sport: game.sport,
        side: sd,
        market: current.market,
        selection: current.selection,
        line: q.line ?? null,
        label: q.label || t.abbreviation,
        startsAt: game.startsAt,
        voidReason: null,
        teamName: q.teamName || t.name,
        teamAbbr: q.teamAbbr || t.abbreviation,
        teamColor: q.teamColor || t.color,
        opponentAbbr: q.opponentAbbr || o.abbreviation,
        odds: q.odds,
        potentialPayout: winningsAt(q.odds, freeStake),
        opponentUid: null,
      },
    };
    const ok = placed ? await switchFreeBet(placed.id, args) : await placeFreeBet(args);
    if (!ok) return;
    haptic.success();
    show({
      id: `lockin_${Date.now()}`,
      kind: "live",
      icon: placed ? "swap-horizontal" : "lock-check",
      title: placed ? "Free bet updated" : "Free bet locked in",
      body: `${q.label || t.abbreviation} · ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
      durationMs: 6000,
    });
    trackEvent("daily_pick_made", { side: sd });
    setChoice(null);
    setGameId(null);
    setDetails(false);
  };

  const shareWeek = async () => {
    const db = getDb();
    if (!db || !uid) return;
    haptic.tick();
    const days = weekDays(now);
    try {
      const snap = await getDocs(query(collection(db, "users", uid, "dailyPicks"), where("day", ">=", days[0]!), where("day", "<=", days[6]!)));
      const results: Record<string, DailyResult> = {};
      snap.forEach((d) => {
        results[d.id] = (d.get("result") as DailyResult) ?? null;
      });
      const rec = weekRecord(results, now);
      const text = `Daily Pick this week ${rec.w}-${rec.l}\n${weekGrid(results, now)}`;
      if (activeLeagues.length === 1) {
        void sendMessage(activeLeagues[0]!.id, text);
        show({ kind: "league", title: "Posted to the League", body: weekGrid(results, now) });
      } else setWeekText(text);
    } catch (e) {
      show({ kind: "warning", title: "Couldn't load your week", body: api.friendlyError(e) });
    }
  };

  const repair = streak?.repairPending && streak.repairPending.day === day && streak.repairPending.done < streak.repairPending.needed ? streak.repairPending : null;

  const status = placed
    ? placed.status === "won"
      ? { label: `Won +${placed.potentialPayout.toLocaleString()}`, tone: "positive" as const }
      : placed.status === "lost"
        ? { label: "Missed", tone: "negative" as const }
        : placed.status === "push"
          ? { label: "Push", tone: "neutral" as const }
          : { label: placed.startsAt && placed.startsAt <= now ? "Riding" : "Locked In", tone: "accent" as const }
    : { label: "Ready", tone: "accent" as const };

  const pageable = sportOptions.slice(0, 12);
  const gameIndex = game ? pageable.findIndex((g) => g.id === game.id) : -1;
  const step = (dir: 1 | -1) => {
    if (!pageable.length) return;
    const next = pageable[(Math.max(0, gameIndex) + dir + pageable.length) % pageable.length]!;
    haptic.tick();
    setGameId(next.id);
    setChoice(null);
  };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onTouchStart: (e: GestureResponderEvent) => {
      touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      const t = touch.current;
      touch.current = null;
      if (!t) return;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    },
  };

  const pick = (ch: Choice) => {
    haptic.tick();
    setChoice(ch);
    tourEvent("daily:pick");
  };
  const quote = game && current ? quoteMarket(game, current.market, current.selection) : null;
  const sportIcon = (game ? SPORT_ICONS[game.sport] : placed ? SPORT_ICONS[placed.sport as keyof typeof SPORT_ICONS] : null) ?? "ticket-confirmation";
  const actionLabel = !placed
    ? current && game
      ? `Lock In Free Bet · ${quote?.label ?? ""}`
      : "Pick a Team to Lock In"
    : `Switch Free Bet · ${quote?.label ?? ""}`;
  const showAction = open && (!placed ? true : changed && canSwitch);
  // The button never disappears: when it can't act it stays, greyed, saying why.
  const ctaEnabled = showAction && !!current;
  const ctaLabel = showAction
    ? actionLabel
    : placed
      ? canSwitch || (placed.startsAt && placed.startsAt > now)
        ? "Switch Free Bet · Pick a different side"
        : "Free Bet Locked · Game Started"
      : "No Open Game to Lock In";

  if (!used && !game) {
    return (
      <LiquidGlass variant="card" radius={24} borderColor="rgba(245, 196, 81, 0.45)" contentStyle={styles.ticket}>
        <View style={styles.head}>
          <MaterialCommunityIcons name="ticket-confirmation" size={20} color="#F5C451" />
          <Text style={styles.title}>DAILY FREE BET</Text>
          <View style={styles.freePill}>
            <Text style={styles.freePillText}>{freeStake.toLocaleString()} FREE</Text>
          </View>
        </View>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          Your free {freeStake.toLocaleString()}-credit bet is ready. No games are open right now — check back when the next slate is up.
        </Text>
      </LiquidGlass>
    );
  }

  return (
    <View style={styles.ticketOuter} accessibilityLabel="Daily free bet">
      <LiquidGlass
        variant="card"
        radius={24}
        borderColor="rgba(245, 196, 81, 0.52)"
        borderWidth={1.25}
        contentStyle={styles.ticket}
      >
        {/* Golden VIP radial dome sheen + specular top rim */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id="vip_gold" cx="50%" cy="6%" rx="78%" ry="60%">
                <Stop offset="0" stopColor="#F5C451" stopOpacity="0.28" />
                <Stop offset="0.52" stopColor="#EAB308" stopOpacity="0.10" />
                <Stop offset="1" stopColor="#EAB308" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#vip_gold)" />
          </Svg>
          <LinearGradient
            colors={["transparent", "rgba(254, 240, 138, 0.85)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topRim}
          />
        </View>

        {/* Subtle VIP ticket edge notches */}
        <View pointerEvents="none" style={[styles.notch, styles.notchLeft, { backgroundColor: c.background }]} />
        <View pointerEvents="none" style={[styles.notch, styles.notchRight, { backgroundColor: c.background }]} />

        {/* Header Row: Ticket icon + DAILY FREE BET | Glowing Gold Free Stake Pill */}
        <Pressable accessibilityRole="button" accessibilityLabel="Free bet details" onPress={() => setDetails(true)} style={{ gap: 6 }}>
          <View style={styles.head}>
            <MaterialCommunityIcons name="ticket-confirmation" size={20} color="#F5C451" />
            <Text style={styles.title} numberOfLines={1}>DAILY FREE BET</Text>
            <View style={styles.freePill}>
              <Text style={styles.freePillText} numberOfLines={1}>
                {placed
                  ? status.label
                  : `${freeStake.toLocaleString()} FREE${activeDays > 0 ? ` · ${activeDays}d` : ""}`}
              </Text>
            </View>
          </View>

          {placed ? (
            <Text style={styles.matchupMeta} numberOfLines={1}>
              🔒 {placed.label} vs {placed.opponentAbbr} · {formatOdds(placed.odds, fmt)} ·{" "}
              {placed.status === "won"
                ? `paid +${placed.potentialPayout.toLocaleString()}`
                : placed.status === "pending"
                  ? `win +${placed.potentialPayout.toLocaleString()}`
                  : "zero risk"}
            </Text>
          ) : game ? (
            <Text style={styles.matchupMeta} numberOfLines={1}>
              {game.sport} · {open ? untilKickoff(game.startsAt, now).toUpperCase() : game.status === "live" ? "LIVE" : "LOCKED"} · {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
            </Text>
          ) : null}
        </Pressable>

        {/* Available Sports Today Status Strip */}
        {options.length > 0 ? (
          <View style={styles.sportsStrip}>
            <Text style={styles.sportsStripLabel}>AVAILABLE SPORTS TODAY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sportsRow}>
              {orderedSports.map((sport) => {
                const count = sportCounts[sport] ?? 0;
                const available = count > 0;
                const selected = activeSport === sport;
                const iconName = SPORT_ICONS[sport] ?? "trophy-outline";
                return (
                  <PressableScale
                    key={sport}
                    scaleTo={0.93}
                    disabled={!available}
                    onPress={() => {
                      haptic.tick();
                      setSelectedSport(sport);
                      const first = options.find((g) => g.sport === sport);
                      if (first) {
                        setGameId(first.id);
                        setChoice(null);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !available }}
                    accessibilityLabel={`${sport}, ${count} ${count === 1 ? "game" : "games"} available`}
                    style={[styles.sportBadge, !available && styles.sportBadgeDisabled]}
                  >
                    <View
                      style={[
                        styles.sportCircle,
                        selected
                          ? styles.sportCircleSelected
                          : available
                            ? styles.sportCircleOpen
                            : styles.sportCircleClosed,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={iconName as never}
                        size={20}
                        color={selected ? "#F5C451" : available ? "#F8FAFC" : "rgba(148, 163, 184, 0.55)"}
                      />
                      <View
                        style={[
                          styles.sportDot,
                          {
                            backgroundColor: selected
                              ? "#F5C451"
                              : available
                                ? c.positive
                                : "rgba(148, 163, 184, 0.35)",
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.sportBadgeLabel,
                        selected
                          ? styles.sportBadgeLabelSelected
                          : available
                            ? styles.sportBadgeLabelOpen
                            : styles.sportBadgeLabelClosed,
                      ]}
                      numberOfLines={1}
                    >
                      {SPORT_SHORT_LABEL[sport]} ({count})
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Side-by-side Team Pick Cards using existing TeamCrest */}
        {game ? (
          <View style={styles.row}>
            {(["away", "home"] as const).map((sd) => {
              const t = sd === "home" ? game.homeTeam : game.awayTeam;
              const q = quoteMarket(game, "ml", sd);
              const ch: Choice = { market: "ml", selection: sd };
              const on = same(current, ch);
              const isBet = onPlacedGame && same(placedChoice, ch);
              const tint = t.color || "#F5C451";
              return (
                <TourTarget key={sd} id={`vault.freeBet.${sd}`} style={{ flex: 1 }}>
                <PressableScale
                  style={{ flex: 1 }}
                  scaleTo={0.96}
                  disabled={!open}
                  onPress={() => pick(ch)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !open }}
                  accessibilityLabel={`${t.name ?? t.abbreviation}${q.odds ? `, profit ${winningsAt(q.odds, freeStake)}` : ""}${isBet ? ", your free bet" : ""}`}
                >
                  <View
                    style={[
                      styles.teamCard,
                      {
                        borderColor: on ? tint : "rgba(255, 255, 255, 0.14)",
                        borderWidth: on ? 2 : 1,
                        backgroundColor: on ? c.alpha(tint, 0.20) : "rgba(255, 255, 255, 0.05)",
                        opacity: !open && !isBet ? 0.5 : current && !on ? 0.65 : 1,
                      },
                    ]}
                  >
                    {on ? (
                      <View style={[styles.checkDot, { backgroundColor: tint }]}>
                        <MaterialCommunityIcons name={isBet ? "lock" : "check"} size={11} color="#FFFFFF" />
                      </View>
                    ) : null}
                    <TeamCrest abbr={t.abbreviation} name={t.name} color={t.color} altColor={t.altColor} size={38} sport={game.sport} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.teamAbbr} numberOfLines={1}>{t.abbreviation}</Text>
                      <Text style={styles.teamOdds} numberOfLines={1}>
                        {q.odds ? formatOdds(q.odds, fmt) : sd === "home" ? "Home" : "Away"}
                      </Text>
                      {q.odds ? (
                        <Text style={styles.teamProfit} numberOfLines={1}>
                          +{winningsAt(q.odds, freeStake).toLocaleString()} profit
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </PressableScale>
                </TourTarget>
              );
            })}
          </View>
        ) : null}

        {/* Compact Horizontal Game Switcher Bar (Selected Sport Only) */}
        {open && sportOptions.length > 0 ? (
          <View style={styles.switcherTrack}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {sportOptions.slice(0, 12).map((g) => {
                const on = g.id === game?.id;
                const pillIcon = SPORT_ICONS[g.sport] ?? "ticket-confirmation";
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Use it on ${g.sport} ${g.awayTeam.abbreviation} at ${g.homeTeam.abbreviation}`}
                    onPress={() => {
                      haptic.tick();
                      setGameId(g.id);
                      setChoice(null);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: on ? "rgba(254, 240, 138, 0.55)" : "transparent",
                        backgroundColor: on ? "rgba(255, 255, 255, 0.92)" : "transparent",
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={pillIcon as never}
                      size={13}
                      color={on ? "#141006" : "rgba(245, 196, 81, 0.85)"}
                    />
                    <Text style={[styles.chipText, { color: on ? "#141006" : "rgba(226, 232, 240, 0.72)" }]}>
                      {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {placed && !onPlacedGame && game ? (
          <Text style={[styles.sub, { color: c.mutedForeground, textAlign: "center" }]}>
            Your free bet is on another game. Lock in here to move it.
          </Text>
        ) : null}

        {/* Full-Width Shimmering Solid Gold Lock-In CTA */}
        <TourTarget id="vault.freeBet.lock">
          <PressableScale
            scaleTo={0.97}
            disabled={!ctaEnabled}
            onPress={() => void lockIn()}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: !ctaEnabled }}
            style={[
              styles.goldBtn,
              {
                backgroundColor: ctaEnabled ? "#F5C451" : "rgba(255, 255, 255, 0.10)",
                opacity: ctaEnabled ? 1 : 0.65,
              },
            ]}
          >
            {ctaEnabled ? <Shimmer intensity={0.40} every={2200} /> : null}
            <MaterialCommunityIcons
              name={placed ? (showAction || canSwitch || (placed.startsAt && placed.startsAt > now) ? "swap-horizontal" : "lock") : "lock"}
              size={16}
              color={ctaEnabled ? "#141006" : "rgba(255, 255, 255, 0.65)"}
            />
            <Text
              style={[
                styles.goldBtnText,
                { color: ctaEnabled ? "#141006" : "rgba(255, 255, 255, 0.65)" },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {ctaLabel}
            </Text>
          </PressableScale>
        </TourTarget>

        {/* Footer: Streak & Bet Types */}
        <View style={styles.streakRow}>
          <Text style={[styles.sub, { color: "rgba(255, 238, 206, 0.72)", flex: 1 }]} numberOfLines={1}>
            {alive
              ? `🔥 ${streak!.count}-day streak${used ? "" : " · bet to keep it"}`
              : streak?.longest
                ? `Best streak ${streak.longest}d · start a new one`
                : "Bet daily to grow your free stake"}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Bet types" hitSlop={8} onPress={() => setDetails(true)}>
            <Text style={styles.betTypes}>Spread & Totals ›</Text>
          </Pressable>
        </View>

        {repair ? (
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {`One more pick today restores your ${repair.from}-day streak.`}
          </Text>
        ) : null}
        {mine?.result && activeLeagues.length > 0 ? (
          <ActionChip label="Share My Week" icon="grid" chevron={false} tone="league" accessibilityLabel="Share this week's Daily Pick grid to league chat" onPress={shareWeek} />
        ) : null}
      </LiquidGlass>

      {/* Details Sheet: Moneyline / Spread / Total */}
      <KeyboardSheet visible={details} onClose={() => setDetails(false)} maxHeight="80%" glowColor="#F5C451">
        <View style={styles.sheet} {...swipe}>
          {open && sportOptions.length > 1 ? (
            <View style={styles.pager}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous game" hitSlop={8} onPress={() => step(-1)}>
                <MaterialCommunityIcons name="chevron-left" size={22} color={c.mutedForeground} />
              </Pressable>
              <Text style={[styles.sub, { color: c.mutedForeground, flex: 1, textAlign: "center" }]}>
                {activeSport ? `${activeSport} · ` : ""}Game {Math.max(1, gameIndex + 1)} of {Math.min(sportOptions.length, 12)} · swipe for more
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next game" hitSlop={8} onPress={() => step(1)}>
                <MaterialCommunityIcons name="chevron-right" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.head}>
            <MaterialCommunityIcons name={sportIcon as never} size={20} color="#F5C451" />
            <Text style={[styles.sheetTitle, { color: c.foreground, flex: 1 }]}>
              {game ? `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}` : "Daily Free Bet"}
            </Text>
            <Pill label={status.label} tone={status.tone} />
          </View>
          {placed ? (
            <View style={[styles.placed, { borderColor: "rgba(245, 196, 81, 0.55)", backgroundColor: "rgba(245, 196, 81, 0.10)" }]}>
              <MaterialCommunityIcons name="lock" size={18} color="#F5C451" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.placedTitle, { color: c.foreground }]} numberOfLines={1}>
                  {placed.label} vs {placed.opponentAbbr}
                </Text>
                <Text style={[styles.sub, { color: c.mutedForeground }]}>
                  Free {freeStake.toLocaleString()} · {formatOdds(placed.odds, fmt)} · win +{placed.potentialPayout.toLocaleString()} credits
                  {placed.startsAt && placed.startsAt > now ? ` · ${untilKickoff(placed.startsAt, now)}` : ""}
                </Text>
              </View>
            </View>
          ) : null}
          {game && open ? (
            <>
              {(
                [
                  ["MONEYLINE · WHO WINS", "ml", ["away", "home"]],
                  ...(hasSpreadLine(game) && typeof game.line?.spreadHome === "number" ? [["SPREAD · WIN OR LOSE BY", "spread", ["away", "home"]]] : []),
                  ...(hasTotalLine(game) && typeof game.line?.overUnder === "number" ? [["TOTAL POINTS · OVER / UNDER", "total", ["over", "under"]]] : []),
                ] as [string, Market, Selection[]][]
              ).map(([title, market, sels]) => (
                <View key={market} style={{ gap: 6 }}>
                  <Text style={styles.group}>{title}</Text>
                  <View style={styles.row}>
                    {sels.map((sel) => {
                      const ch: Choice = { market, selection: sel };
                      const q = quoteMarket(game, market, sel);
                      const on = same(current, ch);
                      const isBet = onPlacedGame && same(placedChoice, ch);
                      return (
                        <Pressable
                          key={sel}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => pick(ch)}
                          style={[styles.option, { borderColor: on ? "#F5C451" : "rgba(255, 255, 255, 0.14)", borderWidth: on ? 2 : 1, backgroundColor: on ? "rgba(245, 196, 81, 0.20)" : "rgba(255, 255, 255, 0.06)" }]}
                        >
                          <Text style={[styles.optionLabel, { color: on ? "#FCE092" : c.foreground }]} numberOfLines={1}>
                            {on ? "✓ " : ""}{q.label} {isBet ? "🔒" : ""}
                          </Text>
                          <Text style={[styles.sub, { color: on ? "#FFFFFF" : c.mutedForeground }]}>
                            {q.odds ? `${formatOdds(q.odds, fmt)} · +${winningsAt(q.odds, freeStake).toLocaleString()}` : "no price"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              {!placed || (changed && canSwitch) ? (
                <PressableScale
                  scaleTo={0.97}
                  disabled={!current}
                  onPress={() => void lockIn()}
                  accessibilityRole="button"
                  accessibilityLabel={actionLabel}
                  style={[styles.goldBtn, { backgroundColor: current ? "#F5C451" : "rgba(255, 255, 255, 0.10)", opacity: current ? 1 : 0.65 }]}
                >
                  {current ? <Shimmer intensity={0.4} every={2200} /> : null}
                  <MaterialCommunityIcons name={placed ? "swap-horizontal" : "lock"} size={16} color={current ? "#141006" : "rgba(255, 255, 255, 0.65)"} />
                  <Text style={[styles.goldBtnText, { color: current ? "#141006" : "rgba(255, 255, 255, 0.65)" }]} numberOfLines={1} adjustsFontSizeToFit>
                    {actionLabel}
                  </Text>
                </PressableScale>
              ) : (
                <Text style={[styles.sub, { color: c.mutedForeground }]}>Pick something else above to switch your free bet before kickoff.</Text>
              )}
            </>
          ) : (
            <Text style={[styles.sub, { color: c.mutedForeground }]}>{placed ? "This game has started — your free bet is locked." : "No open game to bet on right now."}</Text>
          )}
          <Button
            label="See All Bets"
            icon="ticket-outline"
            variant="secondary"
            onPress={() => {
              // Close this sheet, then the Prize Vault around it, then navigate. iOS can't dismiss two
              // stacked Modals in the same frame: the second leaves an invisible layer that eats every
              // touch on the next screen. One at a time, each after the last has animated away.
              setDetails(false);
              setTimeout(() => {
                onLeave?.();
                setTimeout(() => router.push("/bets"), 400);
              }, 400);
            }}
          />
        </View>
      </KeyboardSheet>

      <StreakMilestoneCard days={milestone} name={profile?.displayName} onClose={() => setMilestone(null)} />
      <ChoiceDialog
        visible={!!weekText}
        title="Share Your Week"
        body="Post your Daily Pick grid to a league chat."
        actions={activeLeagues.map((l) => ({
          label: l.name,
          onPress: () => {
            if (weekText) void sendMessage(l.id, weekText);
            setWeekText(null);
          },
        }))}
        onCancel={() => setWeekText(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ticketOuter: { position: "relative" },
  ticket: { padding: 15, gap: 11, overflow: "hidden" },
  topRim: { position: "absolute", top: 0, left: 20, right: 20, height: 1.5 },
  notch: {
    position: "absolute",
    top: "47%",
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#0D1118",
    borderWidth: 1,
    borderColor: "rgba(245, 196, 81, 0.35)",
  },
  notchLeft: { left: -9 },
  notchRight: { right: -9 },

  head: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_900Black", letterSpacing: 0.4, flex: 1 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_900Black", letterSpacing: -0.2 },
  freePill: {
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 999,
    backgroundColor: "#F5C451",
  },
  freePillText: { color: "#141006", fontSize: 11, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  matchupMeta: {
    color: "rgba(226, 232, 240, 0.72)",
    fontSize: 11.5,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textAlign: "center",
  },

  sportsStrip: {
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.11)",
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 8,
  },
  sportsStripLabel: {
    color: "rgba(226, 232, 240, 0.72)",
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.9,
    textAlign: "center",
  },
  sportsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 2,
  },
  sportBadge: {
    alignItems: "center",
    gap: 5,
    minWidth: 50,
  },
  sportBadgeDisabled: {
    opacity: 0.42,
  },
  sportCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  sportCircleSelected: {
    backgroundColor: "rgba(245, 196, 81, 0.18)",
    borderWidth: 1.75,
    borderColor: "#F5C451",
  },
  sportCircleOpen: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  sportCircleClosed: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  sportDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: "#141821",
  },
  sportBadgeLabel: {
    fontSize: 10.5,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  sportBadgeLabelSelected: { color: "#F5C451" },
  sportBadgeLabelOpen: { color: "rgba(241, 245, 249, 0.88)" },
  sportBadgeLabelClosed: { color: "rgba(148, 163, 184, 0.65)" },

  row: { flexDirection: "row", gap: 10 },
  teamCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 11,
    position: "relative",
  },
  checkDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  teamAbbr: { color: "#FFFFFF", fontSize: 16, fontFamily: "Inter_900Black", letterSpacing: -0.3 },
  teamOdds: { color: "rgba(241, 245, 249, 0.88)", fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  teamProfit: { color: "#FCE092", fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },

  switcherTrack: {
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 3,
  },
  chips: { gap: 4, paddingRight: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5.5,
  },
  chipText: { fontSize: 11.5, fontFamily: "Inter_800ExtraBold" },

  goldBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 46,
    borderRadius: 14,
    overflow: "hidden",
  },
  goldBtnText: { fontSize: 14.5, fontFamily: "Inter_900Black", letterSpacing: -0.1 },

  streakRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  betTypes: { color: "#FCE092", fontSize: 12, fontFamily: "Inter_700Bold" },

  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  placed: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 20, padding: 14 },
  placedTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  pager: { flexDirection: "row", alignItems: "center", gap: 6 },
  sheet: { gap: 14, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 18 },
  group: { fontSize: 10.5, letterSpacing: 1.6, fontFamily: "Inter_800ExtraBold", color: "rgba(245, 196, 81, 0.85)" },
  option: { flex: 1, borderWidth: 1, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center", gap: 3 },
  optionLabel: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});

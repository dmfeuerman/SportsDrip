import { BOX_DISPLAY, BOX_TIERS } from "@/constants/prizeTypes";
import { AD_REWARD_DISPLAY } from "@/constants/ads";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import TeamCrest from "@/components/TeamCrest";
import { LinearGradient } from "expo-linear-gradient";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import AvatarHero from "@/components/avatar/AvatarHero";
import { isSceneBackdrop } from "@/components/avatar/AvatarBackdrop";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import { betNet } from "@/components/BetRecordPanel";
import CrewFeedModule, { useCrewFeed } from "@/components/CrewFeed";
import { pickFeatured } from "@/components/FeaturedGameCard";
import FirstWeekChecklist from "@/components/FirstWeekChecklist";
import GameQuickView from "@/components/GameQuickView";
import LadderPromotionHost from "@/components/LadderPromotionHost";
import LevelChallengesCard from "@/components/LevelChallengesCard";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import PrizeVaultModal from "@/components/PrizeVaultModal";
import { STREAK_BONUS_MAX_DAYS, STREAK_BONUS_PER_DAY } from "@/components/StreakBanner";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { Card, SectionHeader, useBottomPad, useTopPad } from "@/components/ui";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { useApp } from "@/context/AppContext";
import { useChallenges } from "@/context/ChallengeContext";
import { useChat } from "@/context/ChatContext";
import { useLeague, useLeagueSummaries } from "@/context/LeagueContext";
import { useNotifications } from "@/context/NotificationContext";
import { useBonusVideo } from "@/hooks/useBonusVideo";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors, type Colors } from "@/hooks/useColors";
import { useReduceTransparency } from "@/hooks/useReduceTransparency";
import TokenBalance from "@/components/TokenBalance";
import { useGames } from "@/hooks/useGames";
import { openGameCenter } from "@/lib/gameCenter";
import { useNow } from "@/hooks/useNow";
import { hasSpreadLine, quoteMarket } from "@/lib/markets";
import { formatOdds, untilKickoff } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { nyDayOf } from "@/lib/streakGrid";

const NO_SIDE_MAP = new Map<string, never[]>();

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatSpread(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/* ── theme: Home follows light/dark, the Settings colour scheme and Reduce Transparency ── */

type Tone = "gold" | "blue" | "orange" | "green" | "slate" | "teal" | "red";
const TONE: Record<Tone, string> = {
  gold: "#EAB308",
  blue: "#60A5FA",
  orange: "#FB923C",
  green: "#34D399",
  slate: "#93C5FD",
  teal: "#2DD4BF",
  red: "#FF4D63",
};

function rgbOf(color: string): [number, number, number] {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1]!.split(",").map((x) => Number.parseFloat(x));
    return [r ?? 0, g ?? 0, b ?? 0];
  }
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex.slice(0, 6);
  const n = Number.parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Solid colour a fraction `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const h = (i: number) => Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16).padStart(2, "0");
  return `#${h(0)}${h(1)}${h(2)}`;
}

type HomeTheme = ReturnType<typeof homeTheme>;
/** Tile and ink colours for Home, derived from the active scheme instead of fixed hexes. */
function homeTheme(c: Colors, solid: boolean) {
  const dark = c.isDark;
  return {
    dark,
    solid,
    tile: (tone: Tone, strong = false) => ({
      backgroundColor: mix(c.card, TONE[tone], dark ? (tone === "slate" ? 0.07 : 0.14) : 0.09),
      borderColor: c.alpha(TONE[tone], dark ? (strong ? 0.66 : 0.5) : strong ? 0.6 : 0.4),
    }),
    /** Text on a tone: brightened on dark, deepened on light (>= 4.5:1 either way). */
    accent: (tone: Tone) => (dark ? mix(TONE[tone], "#FFFFFF", 0.45) : mix(TONE[tone], "#000000", 0.42)),
    strong: dark ? "#FFFFFF" : c.foreground,
    body: dark ? "rgba(241, 245, 249, 0.92)" : c.foreground,
    muted: dark ? "rgba(226, 232, 240, 0.86)" : c.mutedForeground,
    track: dark ? "rgba(255, 255, 255, 0.18)" : c.alpha(c.foreground, 0.12),
    chip: {
      backgroundColor: dark ? (solid ? mix(c.card, "#FFFFFF", 0.1) : "rgba(255, 255, 255, 0.10)") : solid ? mix(c.card, c.foreground, 0.06) : c.alpha(c.foreground, 0.06),
      borderColor: dark ? "rgba(255, 255, 255, 0.22)" : c.alpha(c.foreground, 0.16),
    },
    positive: dark ? "#4ADE80" : c.positive,
    negative: dark ? "#FB7185" : c.negative,
  };
}

/** Light mode tones the sheen down; Reduce Transparency turns it off. */
const SheenContext = React.createContext<{ off: boolean; scale: number }>({ off: false, scale: 1 });

/** Restyles the screen's text for light mode (colour only; layout stays in `styles`). */
function themedStyles(t: HomeTheme): typeof styles {
  if (t.dark) return styles;
  const ink = (color: string) => ({ color });
  const over: Partial<Record<keyof typeof styles, object>> = {
    liveSpotMeta: ink(t.muted),
    liveFlashSub: ink(t.muted),
    livePillText: ink(t.accent("green")),
    upNextMetaText: ink(t.muted),
    spotlightScore: ink(t.muted),
    scoreStrong: ink(t.strong),
    payoutPill: t.chip,
    payoutText: ink(t.strong),
    oddsPill: t.chip,
    oddsTeam: ink(t.muted),
    oddsVal: ink(t.strong),
    nextStepKicker: ink(t.accent("gold")),
    nextStepTitle: ink(t.strong),
    nextStepSub: ink(t.muted),
    freeBetTitle: ink(t.strong),
    freeBetSub: ink(t.muted),
    tileLabel: ink(t.muted),
    vaultLabel: ink(t.accent("gold")),
    vaultBigGold: ink(t.accent("gold")),
    miniTrack: { backgroundColor: t.track },
    vaultFoot: ink(t.muted),
    actionBig: ink(t.strong),
    tileFoot: ink(t.muted),
    leagueStripTitle: ink(t.strong),
    leagueStripSub: ink(t.muted),
    leagueDays: ink(t.muted),
    joinCreatePill: t.chip,
    joinCreateText: ink(t.strong),
    streakTileTitle: ink(t.strong),
    streakBonusFoot: ink(t.muted),
    weeklyLabel: ink(t.body),
    weeklyFoot: ink(t.muted),
    weeklyBestHit: ink(t.positive),
  };
  const out = { ...styles } as Record<string, object>;
  for (const [k, v] of Object.entries(over)) out[k] = { ...(styles as Record<string, object>)[k], ...v };
  return out as typeof styles;
}

/** Exact multi-layer radial dome Liquid Glass sheen + specular top rim matching the 2026 mockup. */
function GlassSheen({
  id,
  color,
  highlight = "#FFFFFF",
  rim = "rgba(255,255,255,0.60)",
  intensity = 0.50,
  highlightOpacity = 0.24,
  cx = "54%",
  cy = "4%",
}: {
  id: string;
  color: string;
  highlight?: string;
  rim?: string;
  intensity?: number;
  highlightOpacity?: number;
  cx?: string;
  cy?: string;
}) {
  const sheen = React.useContext(SheenContext);
  if (sheen.off) return null;
  intensity *= sheen.scale;
  highlightOpacity *= sheen.scale;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`gs_${id}`} cx={cx} cy={cy} rx="82%" ry="80%">
            <Stop offset="0" stopColor={color} stopOpacity={String(intensity)} />
            <Stop offset="0.48" stopColor={color} stopOpacity={String(intensity * 0.42)} />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`gsh_${id}`} cx={cx} cy="0%" rx="58%" ry="42%">
            <Stop offset="0" stopColor={highlight} stopOpacity={String(highlightOpacity)} />
            <Stop offset="0.6" stopColor={highlight} stopOpacity={String(highlightOpacity * 0.22)} />
            <Stop offset="1" stopColor={highlight} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#gs_${id})`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#gsh_${id})`} />
      </Svg>
      <LinearGradient
        colors={["transparent", sheen.scale < 1 ? "rgba(255,255,255,0.5)" : rim, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topRimSheen}
      />
    </View>
  );
}

/** Custom metallic gold SVG prize box icon (replaces OS gift emoji). */
function PrizeBoxIcon({ size = 24, id = "pb" }: { size?: number; id?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Defs>
        <SvgGradient id={`${id}Gold`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFE58F" />
          <Stop offset="0.5" stopColor="#F5B82E" />
          <Stop offset="1" stopColor="#B8760B" />
        </SvgGradient>
        <SvgGradient id={`${id}Lid`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFF3C4" />
          <Stop offset="1" stopColor="#E09F1F" />
        </SvgGradient>
        <SvgGradient id={`${id}Ribbon`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFDF5" />
          <Stop offset="1" stopColor="#FDE68A" />
        </SvgGradient>
      </Defs>
      <Path d="M14 8.5 C11 3.5, 6 5, 8.5 8.5 Z" fill={`url(#${id}Ribbon)`} />
      <Path d="M14 8.5 C17 3.5, 22 5, 19.5 8.5 Z" fill={`url(#${id}Ribbon)`} />
      <Rect x="4.5" y="12.5" width="19" height="12" rx="3" fill={`url(#${id}Gold)`} />
      <Rect x="3" y="8" width="22" height="5.2" rx="2" fill={`url(#${id}Lid)`} />
      <Rect x="12.2" y="8" width="3.6" height="16.5" rx="1" fill={`url(#${id}Ribbon)`} opacity="0.92" />
      <Rect x="5" y="9" width="7" height="1.2" rx="0.6" fill="#FFFFFF" opacity="0.65" />
    </Svg>
  );
}

/** Circular XP ring badge wrapping the player's current level. */
function LevelRing({ level, pct, onPress }: { level: number; pct: number; onPress: () => void }) {
  const size = 36;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0.06, Math.min(1, pct));
  const dashOffset = circ * (1 - clamped);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Level ${level}. View level rewards`}
      onPress={() => {
        buzz.tick();
        onPress();
      }}
      hitSlop={6}
      style={({ pressed }) => [styles.levelRing, { opacity: pressed ? 0.8 : 1 }]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.16)" strokeWidth={stroke} fill="rgba(8, 16, 20, 0.65)" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#2FE38A"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={styles.levelRingNum}>{level}</Text>
    </Pressable>
  );
}

/** Bi-colored SVG form sparkline (green on wins, coral red on losses) matching the mockup. */
function FormSparkline({ points }: { points: number[] }) {
  const w = 54;
  const h = 26;
  if (points.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Line x1={2} y1={h / 2} x2={w - 2} y2={h / 2} stroke="rgba(96, 165, 250, 0.45)" strokeWidth={2} strokeLinecap="round" />
      </Svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const pts = points.map((v, i) => ({
    x: 2 + (i / (points.length - 1)) * (w - 4),
    y: h - 3 - ((v - min) / span) * (h - 6),
    v,
  }));
  return (
    <Svg width={w} height={h}>
      {pts.slice(1).map((p, idx) => {
        const prev = pts[idx]!;
        const up = p.v >= prev.v;
        return (
          <Line
            key={idx}
            x1={prev.x}
            y1={prev.y}
            x2={p.x}
            y2={p.y}
            stroke={up ? "#22C55E" : "#EF4444"}
            strokeWidth={2.1}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

/**
 * 2026 Liquid Glass Bento Home:
 *  - Full-bleed unobstructed 3D Avatar Hero with circular XP ring & Liquid Glass credits pill
 *  - Asymmetric Bento Grid: LIVE NOW / UP NEXT spotlight, Prize Vault + My Action tiles, League Pulse strip
 *  - Below the fold: XP Challenges, Streak & Weekly Recap Bento pair, Bonus Credits, and Crew (when active)
 */
export default function HomeScreen() {
  const c = useColors();
  const top = useTopPad();
  const bottom = useBottomPad();
  const { width: winW } = useWindowDimensions();
  const now = useNow(15_000);
  const fmt = useOddsFormat();

  const { profile, balance, bets, progress, background, prizeBoxes } = useApp();
  const hasPlayed = bets.length > 0;
  const [showCard, setShowCard] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultView, setVaultView] = useState<"boxes" | "freeBet">("boxes");
  const openVault = (view: "boxes" | "freeBet" = "boxes") => {
    setVaultView(view);
    setVaultOpen(true);
  };

  const today = nyDayOf(now);
  const todaysFreeBet = bets.find((b) => b.freeBet && b.freeDay === today && b.status !== "cancelled");
  const freeBetReady = !todaysFreeBet;
  // Placed but its game hasn't started: still changeable, so the strip stays to reopen it.
  const freeBetEditable = !!todaysFreeBet && todaysFreeBet.status === "pending" && !!todaysFreeBet.startsAt && todaysFreeBet.startsAt > now;
  const readyBoxes = BOX_TIERS.filter((t) => {
    const b = prizeBoxes[t];
    return b.state === "ready" || (b.state === "waiting" && (b.readyAt ?? 0) <= now);
  }).length;

  const unstartedBoxes = useMemo(
    () => BOX_TIERS.filter((t) => prizeBoxes[t]?.state === "idle"),
    [prizeBoxes]
  );

  const nextWaitingBox = useMemo(() => {
    let best: { tier: (typeof BOX_TIERS)[number]; readyAt: number; openedAt: number } | null = null;
    for (const t of BOX_TIERS) {
      const b = prizeBoxes[t];
      if (b.state === "waiting" && b.readyAt && b.readyAt > now) {
        if (!best || b.readyAt < best.readyAt) {
          best = { tier: t, readyAt: b.readyAt, openedAt: b.openedAt ?? b.readyAt - BOX_DISPLAY[t].waitHours * 3_600_000 };
        }
      }
    }
    return best;
  }, [prizeBoxes, now]);

  const streakAlive =
    (profile?.streak?.count ?? 0) > 0 &&
    (profile?.streak?.lastDay === today || profile?.streak?.lastDay === nyDayOf(now - 86_400_000));
  const streakCount = streakAlive ? (profile?.streak?.count ?? 0) : 0;
  const streakDays = Math.min(STREAK_BONUS_MAX_DAYS, streakCount);

  const onScene = isSceneBackdrop(background);
  const solid = useReduceTransparency();
  const t = useMemo(() => homeTheme(c, solid), [c, solid]);
  // Shadows the module-level sheet with light-mode ink when needed.
  const styles = useMemo(() => themedStyles(t), [t]);
  const sheen = useMemo(() => ({ off: solid, scale: c.isDark ? 1 : 0.45 }), [solid, c.isDark]);
  // Top-bar buttons sit on the hero: white on a scene or in dark mode, theme ink otherwise.
  const heroInk = onScene || c.isDark;
  const circle = [
    styles.glassCircle,
    heroInk
      ? solid
        ? { backgroundColor: "#22262D", borderColor: "rgba(255, 255, 255, 0.28)" }
        : null
      : { backgroundColor: solid ? c.card : c.alpha(c.card, 0.9), borderColor: c.border },
  ];
  const circleIcon = heroInk ? "#FFFFFF" : c.foreground;
  const { myLeagueBets, leagues } = useLeague();
  const { summaries } = useLeagueSummaries();
  const { unreadCount } = useNotifications();
  const { unreadChatCount } = useChat();
  const { byId } = useCatalog();
  const { games, live } = useGames();
  const bonusVideo = useBonusVideo();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const openCredit = bets.filter((b) => b.status === "pending");
  const openLeague = leagues.flatMap((l) =>
    (myLeagueBets[l.id] ?? []).filter((b) => b.status === "pending").map((b) => ({ b, league: l.name }))
  );
  const openTotal = openCredit.length + openLeague.length;

  const { incoming: challengeInbox, live: challengesLive, outgoing: challengesSent, escrowed } = useChallenges();
  const crewItems = useCrewFeed(8);
  const hasChallenges = challengeInbox.length + challengesLive.length + challengesSent.length > 0;
  const hasCrew = hasChallenges || crewItems.length > 0;

  const settled = useMemo(() => bets.filter((b) => b.status === "won" || b.status === "lost"), [bets]);
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.length - wins;
  const hitRate = settled.length ? Math.round((wins / settled.length) * 100) : 0;
  const lifetimeNet = useMemo(() => settled.reduce((s, b) => s + betNet(b), 0), [settled]);

  // Cumulative net sparkline over the last 10 settled bets
  const sparkPoints = useMemo(() => {
    const recent = [...settled].slice(0, 10).reverse();
    let acc = 0;
    const pts = [0];
    for (const b of recent) {
      acc += betNet(b);
      pts.push(acc);
    }
    return pts;
  }, [settled]);

  // Weekly recap numbers (last 7 days)
  const weekly = useMemo(() => {
    const cutoff = now - 7 * 86_400_000;
    const recent = settled.filter((b) => {
      const sec = b.settledAt?.seconds ?? b.placedAt?.seconds ?? 0;
      return sec * 1000 >= cutoff;
    });
    const w = recent.filter((b) => b.status === "won").length;
    const l = recent.length - w;
    const net = recent.reduce((s, b) => s + betNet(b), 0);
    const best = recent.reduce((m, b) => Math.max(m, betNet(b)), 0);
    return { w, l, net, best };
  }, [settled, now]);

  const name = profile?.displayName?.trim() || profile?.username || "there";
  const focused = useIsFocused();
  const [avatarGesture, setAvatarGesture] = useState(false);
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);

  const params = useLocalSearchParams<{ game?: string; vault?: string }>();
  useEffect(() => {
    if (!params.game) return;
    setQuickGame(params.game);
    router.setParams({ game: undefined } as never);
  }, [params.game]);
  useEffect(() => {
    if (params.vault !== "freeBet" && params.vault !== "boxes") return;
    openVault(params.vault);
    router.setParams({ vault: undefined } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.vault]);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef);

  const openGameIds = useMemo(
    () => new Set([...openCredit.map((b) => b.gameId), ...openLeague.map(({ b }) => b.gameId)]),
    [openCredit, openLeague]
  );

  // Live bets you have money on right now
  const liveSweats = useMemo(() => {
    const all = [
      ...openCredit.map((b) => ({ ...b, key: b.id, wallet: null as string | null })),
      ...openLeague.map(({ b, league }) => ({ ...b, key: `lg_${b.id}`, wallet: league as string | null })),
    ];
    return all
      .map((b) => ({ bet: b, game: gameById.get(b.gameId) ?? null }))
      .filter((x): x is { bet: (typeof all)[number]; game: NonNullable<ReturnType<typeof gameById.get>> } => x.game?.status === "live");
  }, [openCredit, openLeague, gameById]);

  // Biggest upcoming game when nothing is live
  const featured = useMemo(() => {
    const favs = new Set((profile?.favoriteTeams ?? []).map((t) => `${t.sport}:${t.abbr}`));
    return pickFeatured(games.filter((x) => !openGameIds.has(x.id)), NO_SIDE_MAP, favs, now) ?? games.find((g) => g.status === "upcoming") ?? null;
  }, [games, openGameIds, profile?.favoriteTeams, now]);

  const bestLeague = useMemo(
    () => summaries.filter((s) => s.me?.rank).sort((a, b) => (a.me!.rank ?? 99) - (b.me!.rank ?? 99))[0] ?? summaries[0] ?? null,
    [summaries]
  );

  const spotlightWidth = Math.max(280, winW - 32);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        ref={scrollRef}
        onScroll={tourScroll.onScroll}
        scrollEventThrottle={tourScroll.scrollEventThrottle}
        scrollEnabled={!avatarGesture}
        contentContainerStyle={[styles.content, { paddingTop: top + 12, paddingBottom: Math.max(16, bottom - 20) }]}
        showsVerticalScrollIndicator={false}
      >
        <SheenContext.Provider value={sheen}>
        <tourScroll.Provider>
          {/* Full-bleed 2026 Liquid Glass Avatar Hero */}
          <TourTarget id="home.hero">
            <AvatarHero
              avatar={profile?.avatar ?? null}
              equipped={profile?.equipped ?? {}}
              catalog={byId}
              moves={profile?.moves}
              onEditMoves={() => router.push("/moves")}
              active={focused}
              onGesture={setAvatarGesture}
              background={background}
              hideFooter
              bleed
              glassDance
              topPad={top}
              style={{ marginHorizontal: -16, marginTop: -(top + 12) }}
              header={
                <View style={styles.topBar}>
                  <TourTarget id="home.level">
                    <LevelRing level={progress.level} pct={progress.pct} onPress={() => router.push("/levels" as never)} />
                  </TourTarget>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${name}. Open your player card`}
                    onPress={() => {
                      buzz.tick();
                      setShowCard(true);
                    }}
                    style={styles.identityWrap}
                  >
                    <Text
                      accessibilityRole="header"
                      style={[styles.name, { color: onScene ? "#FFFFFF" : c.foreground }, onScene && styles.onScene]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Text
                      style={[styles.subHandle, { color: onScene ? "rgba(255,255,255,0.9)" : c.mutedForeground }, onScene && styles.onScene]}
                      numberOfLines={1}
                    >
                      {profile?.username ? `@${profile.username}` : "Player"}
                      {streakCount > 0 ? ` · ${streakCount}d 🔥` : ""}
                    </Text>
                  </Pressable>

                  {/* Same balance pill as Games and the Locker: tap it for your player card. */}
                  <TourTarget id="home.wallet">
                    <TokenBalance
                      tokens={balance}
                      glass
                      onScene={onScene}
                      onPress={() => {
                        setShowCard(true);
                      }}
                    />
                  </TourTarget>

                  {/* Always here, so chat is findable; the dot only means something's unread. */}
                  <TourTarget id="home.chat">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={unreadChatCount > 0 ? `Chat, ${unreadChatCount} unread` : "Chat"}
                      hitSlop={4}
                      onPress={() => {
                        buzz.tick();
                        router.push("/messages" as never);
                      }}
                      style={({ pressed }) => [circle, { opacity: pressed ? 0.78 : 1 }]}
                    >
                      <MaterialCommunityIcons name="chat-processing-outline" size={20} color={circleIcon} />
                      {unreadChatCount > 0 ? <View style={[styles.dotBadge, { backgroundColor: c.primary }]} /> : null}
                    </Pressable>
                  </TourTarget>

                  <TourTarget id="home.activity">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={unreadCount > 0 ? "Notifications, new" : "Notifications"}
                      hitSlop={4}
                      onPress={() => {
                        buzz.tick();
                        router.push("/activity");
                      }}
                      style={({ pressed }) => [circle, { opacity: pressed ? 0.78 : 1 }]}
                    >
                      <MaterialCommunityIcons name="bell-outline" size={20} color={circleIcon} />
                      {unreadCount > 0 ? <View style={[styles.dotBadge, { backgroundColor: "#FF4D63" }]} /> : null}
                    </Pressable>
                  </TourTarget>
                </View>
              }
            />
          </TourTarget>

          {/* ABOVE-THE-FOLD 2026 LIQUID GLASS BENTO GRID */}
          <View style={styles.bentoSection}>
            {/* 1. Spotlight Slot: LIVE NOW (if live bets) or UP NEXT (quiet state) */}
            {liveSweats.length > 0 || live.length > 0 || featured ? (
            <TourTarget id="home.next">
            {liveSweats.length > 0 ? (
              <View style={{ gap: 7 }}>
                <Text style={[styles.kicker, { color: c.mutedForeground }]}>LIVE NOW</Text>
                <ScrollView
                  horizontal
                  pagingEnabled={liveSweats.length > 1}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10 }}
                >
                  {liveSweats.map(({ bet, game }) => {
                    const statusStr = [game.period, game.clock].filter(Boolean).join(" ") || "IN PLAY";
                    return (
                      <Pressable
                        key={bet.key}
                        accessibilityRole="button"
                        accessibilityLabel={`Live bet ${bet.label ?? bet.teamAbbr}`}
                        onPress={() => {
                          buzz.tick();
                          setQuickGame(game.id);
                        }}
                        style={({ pressed }) => [
                          styles.spotlightCard,
                          t.tile("teal", true),
                          {
                            width: spotlightWidth,
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <GlassSheen id="live" color="#2DD4BF" rim="rgba(153, 246, 228, 0.72)" intensity={0.44} />
                        <View style={styles.spotlightRow}>
                          <View style={{ flex: 1, gap: 5 }}>
                            <View style={styles.liveTopRow}>
                              <View style={[styles.sportTag, { backgroundColor: c.alpha(c.sport(game.sport), 0.16) }]}>
                                <MaterialCommunityIcons name={(SPORT_ICONS[game.sport] ?? "trophy-outline") as never} size={12} color={c.sport(game.sport)} />
                                <Text style={[styles.sportTagText, { color: c.sport(game.sport) }]}>{game.sport}</Text>
                              </View>
                              <View style={styles.livePill}>
                                <View style={styles.liveDot} />
                                <Text style={styles.livePillText}>LIVE · {statusStr}</Text>
                              </View>
                            </View>
                            <Text style={[styles.spotlightTitle, { color: t.strong }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.3}>
                              {(() => {
                                const pick = bet.side === "home" ? game.homeTeam : game.awayTeam;
                                const full = pick?.name || bet.teamAbbr;
                                // Totals ("Over 2.5") name no team; spreads keep their line after the full name.
                                if (!bet.label) return full;
                                return bet.label.includes(bet.teamAbbr) ? bet.label.replace(bet.teamAbbr, full) : bet.label;
                              })()}
                            </Text>
                            <View style={styles.liveScoreRow}>
                              <TeamCrest abbr={game.awayTeam.abbreviation} name={game.awayTeam.name} color={game.awayTeam.color} altColor={game.awayTeam.altColor} size={24} sport={game.sport} />
                              <Text style={styles.spotlightScore} numberOfLines={1}>
                                {game.awayTeam.abbreviation}{" "}
                                <Text style={styles.scoreStrong}>{game.awayScore ?? 0}</Text> –{" "}
                                <Text style={styles.scoreStrong}>{game.homeScore ?? 0}</Text> {game.homeTeam.abbreviation}
                              </Text>
                              <TeamCrest abbr={game.homeTeam.abbreviation} name={game.homeTeam.name} color={game.homeTeam.color} altColor={game.homeTeam.altColor} size={24} sport={game.sport} />
                            </View>
                            <Text style={styles.liveMatchup} numberOfLines={1}>
                              {game.awayTeam.name} at {game.homeTeam.name}
                            </Text>
                          </View>
                          <View style={styles.payoutPill}>
                            <Text style={styles.payoutText}>+{bet.potentialPayout.toLocaleString()}</Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : live.length > 0 ? (
              <View style={{ gap: 6 }}>
                <View style={styles.liveKickerRow}>
                  <View style={styles.liveDot} />
                  <Text style={[styles.kicker, { color: c.mutedForeground, paddingLeft: 0 }]}>
                    LIVE BETTING · {live.length} {live.length === 1 ? "GAME" : "GAMES"} LIVE
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  pagingEnabled={live.length > 1}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10 }}
                >
                  {live.map((game) => {
                    const statusStr = [game.period, game.clock].filter(Boolean).join(" ") || "IN PLAY";
                    return (
                      <Pressable
                        key={game.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Live betting open for ${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation}. Tap to play Flash Picks`}
                        onPress={() => {
                          buzz.tick();
                          openGameCenter(game.id, "live");
                        }}
                        style={({ pressed }) => [
                          styles.spotlightCard,
                          t.tile("red", true),
                          {
                            width: spotlightWidth,
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <GlassSheen
                          id={`livebet_${game.id}`}
                          color="#FF4D63"
                          highlight="#FFE4E6"
                          rim="rgba(255, 160, 172, 0.72)"
                          intensity={0.42}
                          highlightOpacity={0.20}
                          cx="56%"
                          cy="2%"
                        />
                        <View style={styles.spotlightRow}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <View style={styles.upNextMeta}>
                              <MaterialCommunityIcons
                                name={(SPORT_ICONS[game.sport] ?? "trophy-outline") as never}
                                size={15}
                                color="#F97316"
                              />
                              <Text style={styles.liveSpotMeta} numberOfLines={1}>
                                {game.sport} · <Text style={styles.liveSpotTag}>LIVE</Text> {statusStr}
                              </Text>
                            </View>
                            <Text style={[styles.spotlightTitle, { color: t.strong, fontVariant: ["tabular-nums"] }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
                              {game.awayTeam.abbreviation} {game.awayScore ?? 0} – {game.homeScore ?? 0} {game.homeTeam.abbreviation}
                            </Text>
                            <View style={styles.liveFlashSubRow}>
                              <MaterialCommunityIcons name="flash" size={13} color={t.accent("red")} />
                              <Text style={styles.liveFlashSub} numberOfLines={2}>
                                Flash Picks open · 3 free (+200)
                              </Text>
                            </View>
                          </View>
                          <View style={styles.betLivePill}>
                            <Text style={styles.betLiveText}>Bet Live</Text>
                            <MaterialCommunityIcons name="chevron-right" size={15} color="#1A070A" />
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : featured ? (
              <View style={{ gap: 5 }}>
                <Text style={[styles.kicker, { color: c.mutedForeground }]}>UP NEXT</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Featured game ${featured.awayTeam.abbreviation} at ${featured.homeTeam.abbreviation}`}
                  onPress={() => {
                    buzz.tick();
                    setQuickGame(featured.id);
                  }}
                  style={({ pressed }) => [
                    styles.spotlightCard,
                    t.tile("teal"),
                    {
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <GlassSheen id="upnext" color="#2DD4BF" highlight="#CCFBF1" rim="rgba(153, 246, 228, 0.72)" intensity={0.46} highlightOpacity={0.22} cx="56%" cy="2%" />
                  <View style={styles.spotlightRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <View style={styles.upNextMeta}>
                        <MaterialCommunityIcons
                          name={(SPORT_ICONS[featured.sport] ?? "trophy-outline") as never}
                          size={16}
                          color="#F97316"
                        />
                        <Text style={styles.upNextMetaText} numberOfLines={1}>
                          {featured.sport} · {untilKickoff(featured.startsAt, now).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[styles.spotlightTitle, { color: t.strong }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.3}>
                        {featured.awayTeam.abbreviation} @ {featured.homeTeam.abbreviation}
                      </Text>
                    </View>
                    <View style={styles.oddsRow}>
                      {hasSpreadLine(featured) && typeof featured.line?.spreadHome === "number" ? (
                        <>
                          <View style={styles.oddsPill}>
                            <Text style={styles.oddsTeam}>{featured.awayTeam.abbreviation}</Text>
                            <Text style={styles.oddsVal}>{formatSpread(-featured.line.spreadHome)}</Text>
                          </View>
                          <View style={styles.oddsPill}>
                            <Text style={styles.oddsTeam}>{featured.homeTeam.abbreviation}</Text>
                            <Text style={styles.oddsVal}>{formatSpread(featured.line.spreadHome)}</Text>
                          </View>
                        </>
                      ) : (
                        <>
                          <View style={styles.oddsPill}>
                            <Text style={styles.oddsTeam}>{featured.awayTeam.abbreviation}</Text>
                            <Text style={styles.oddsVal}>{formatOdds(quoteMarket(featured, "ml", "away").odds ?? 2, fmt)}</Text>
                          </View>
                          <View style={styles.oddsPill}>
                            <Text style={styles.oddsTeam}>{featured.homeTeam.abbreviation}</Text>
                            <Text style={styles.oddsVal}>{formatOdds(quoteMarket(featured, "ml", "home").odds ?? 2, fmt)}</Text>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                </Pressable>
              </View>
            ) : null}
            </TourTarget>
            ) : null}

            {/* 1b. Next Step Box when any prize box has not been started */}
            {unstartedBoxes.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  unstartedBoxes.length === 1
                    ? `Next step: Start your ${BOX_DISPLAY[unstartedBoxes[0]!].label}`
                    : `Next step: ${unstartedBoxes.length} prize boxes not started`
                }
                onPress={() => {
                  buzz.tick();
                  openVault("boxes");
                }}
                style={({ pressed }) => [styles.nextStepCard, t.tile("gold"), { opacity: pressed ? 0.86 : 1 }]}
              >
                <GlassSheen
                  id="nextstep"
                  color="#EAB308"
                  highlight="#FEF3C7"
                  rim="rgba(254, 240, 138, 0.75)"
                  intensity={0.46}
                  highlightOpacity={0.22}
                  cx="52%"
                  cy="4%"
                />
                <View style={styles.nextStepIconWrap}>
                  <PrizeBoxIcon size={24} id="pbNext" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.nextStepKicker}>NEXT STEP</Text>
                  <Text style={styles.nextStepTitle} numberOfLines={2}>
                    {unstartedBoxes.length === 1
                      ? `Start your ${BOX_DISPLAY[unstartedBoxes[0]!].label}`
                      : `${unstartedBoxes.length} prize boxes not started`}
                  </Text>
                  <Text style={styles.nextStepSub} numberOfLines={2}>
                    {unstartedBoxes.length === 1
                      ? `Timer isn't running · ${BOX_DISPLAY[unstartedBoxes[0]!].waitHours}h to unlock`
                      : `${unstartedBoxes.map((t) => BOX_DISPLAY[t].label.replace(" Box", "")).join(", ")} timers aren't running`}
                  </Text>
                </View>
                <View style={styles.claimPill}>
                  <Text style={styles.claimPillText}>Start</Text>
                </View>
              </Pressable>
            ) : null}

            {/* 2. Side-by-Side Liquid Glass Bento Tiles: Prize Vault + My Bets */}
            <View style={styles.bentoPair}>
              {/* Left Tile: Prize Vault */}
              <TourTarget id="home.prizes" style={styles.equalCol}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Prize Vault"
                  onPress={() => {
                    buzz.tick();
                    openVault("boxes");
                  }}
                  style={({ pressed }) => [
                    styles.bentoTile,
                    t.tile("gold", readyBoxes > 0),
                    {
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <GlassSheen id="vault" color="#EAB308" highlight="#FEF3C7" rim="rgba(254, 240, 138, 0.78)" intensity={0.58} highlightOpacity={0.30} cx="66%" cy="6%" />
                  <View style={styles.tileHead}>
                    <Text style={styles.vaultLabel}>Prize Vault</Text>
                    <PrizeBoxIcon size={27} />
                  </View>

                  {readyBoxes > 0 ? (
                    <View style={styles.vaultActiveRow}>
                      <Text style={styles.vaultBigGold} numberOfLines={1} adjustsFontSizeToFit>
                        {readyBoxes} Ready
                      </Text>
                      <View style={styles.claimPill}>
                        <Text style={styles.claimPillText}>Claim</Text>
                      </View>
                    </View>
                  ) : nextWaitingBox ? (
                    <View style={{ gap: 5 }}>
                      <Text style={styles.vaultBigGold} numberOfLines={1}>
                        {formatCountdown(nextWaitingBox.readyAt - now)}
                      </Text>
                      <View style={styles.miniTrack}>
                        <View
                          style={[
                            styles.miniFill,
                            {
                              width: `${Math.min(
                                100,
                                Math.max(
                                  8,
                                  Math.round(
                                    ((now - nextWaitingBox.openedAt) /
                                      Math.max(1, nextWaitingBox.readyAt - nextWaitingBox.openedAt)) *
                                      100
                                  )
                                )
                              )}%`,
                              backgroundColor: TONE.gold,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.vaultBigGold} numberOfLines={1}>
                      Start Box
                    </Text>
                  )}

                  {/* The free bet has one home on this screen: the Daily Free Bet strip. */}
                  <Text style={styles.vaultFoot} numberOfLines={2}>
                    {readyBoxes > 0
                      ? "Tap to open"
                      : nextWaitingBox
                        ? `Next: ${BOX_DISPLAY[nextWaitingBox.tier].label}`
                        : "Start a timer for free credits"}
                  </Text>
                </Pressable>
              </TourTarget>

              {/* Right Tile: My Bets */}
              <TourTarget id="home.bets" style={styles.equalCol}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={openTotal > 0 ? `${openTotal} open bets` : "View bet history"}
                  onPress={() => {
                    buzz.tick();
                    router.push(openTotal > 0 ? "/bets" : { pathname: "/bets", params: { tab: "settled" } });
                  }}
                  style={({ pressed }) => [
                    styles.bentoTile,
                    t.tile("blue"),
                    {
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <GlassSheen id="bets" color="#60A5FA" highlight="#DBEAFE" rim="rgba(191, 219, 254, 0.78)" intensity={0.56} highlightOpacity={0.28} cx="52%" cy="4%" />
                  <View style={styles.tileHead}>
                    <Text style={styles.tileLabel}>My Bets</Text>
                  </View>

                  <View style={styles.actionMainRow}>
                    <Text style={styles.actionBig} numberOfLines={1} adjustsFontSizeToFit>
                      {openTotal > 0 ? `${openTotal} Open` : `${wins}–${losses}`}
                    </Text>
                    <FormSparkline points={sparkPoints} />
                  </View>

                  <View style={{ gap: 1 }}>
                    <Text
                      style={[styles.netMini, { color: lifetimeNet >= 0 ? t.positive : t.negative }]}
                      numberOfLines={2}
                    >
                      {hitRate}% · {lifetimeNet >= 0 ? `+${lifetimeNet.toLocaleString()}` : lifetimeNet.toLocaleString()} Net
                    </Text>
                    <Text style={styles.tileFoot} numberOfLines={2}>
                      {openTotal > 0 ? `${wins}–${losses} · View History` : "0 Open · View History"}
                    </Text>
                  </View>
                </Pressable>
              </TourTarget>
            </View>

            {/* 2b. Daily Free Bet Ready Strip (only shown while today's free bet is unused) */}
            {freeBetReady || freeBetEditable ? (
              <TourTarget id="home.daily">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={freeBetReady ? "Daily Free Bet Ready. Tap to use your zero-risk free bet" : "Daily Free Bet locked in. Tap to change it before kickoff"}
                onPress={() => {
                  buzz.tick();
                  openVault("freeBet");
                }}
                style={({ pressed }) => [styles.freeBetStrip, t.tile("gold", true), { opacity: pressed ? 0.86 : 1 }]}
              >
                <GlassSheen
                  id="freebet_strip"
                  color="#EAB308"
                  highlight="#FEF3C7"
                  rim="rgba(254, 240, 138, 0.80)"
                  intensity={0.52}
                  highlightOpacity={0.24}
                  cx="52%"
                  cy="4%"
                />
                <View style={styles.freeBetIconWrap}>
                  <MaterialCommunityIcons name="ticket-confirmation" size={21} color={t.accent("gold")} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.freeBetTitle} numberOfLines={2}>
                    {freeBetReady ? "Daily Free Bet Ready" : "Daily Free Bet Locked In"}
                  </Text>
                  <Text style={styles.freeBetSub} numberOfLines={2}>
                    {freeBetReady ? "Zero risk · Keep the winnings" : "Change your pick until the game starts"}
                  </Text>
                </View>
                <View style={styles.freeBetPill}>
                  <Text style={styles.freeBetPillText}>{freeBetReady ? "Use Now" : "Change"}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={14} color="#141006" />
                </View>
              </Pressable>
              </TourTarget>
            ) : null}

            {/* 3. Slim League Pulse Strip (or Compete With Friends invite when not in a league) */}
            <TourTarget id="home.leagues">
              {bestLeague ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`League Pulse. Rank ${bestLeague.me?.rank ?? "unranked"} in ${bestLeague.league.name}`}
                  onPress={() => {
                    buzz.tick();
                    router.push({ pathname: "/league/[id]", params: { id: bestLeague.league.id } });
                  }}
                  style={({ pressed }) => [styles.leagueStrip, t.tile("slate"), { opacity: pressed ? 0.85 : 1 }]}
                >
                  <GlassSheen id="league" color="#93C5FD" rim="rgba(255, 255, 255, 0.42)" intensity={0.22} />
                  <View style={styles.avatarStack}>
                    {["#38BDF8", "#F5B82E", "#34D399"].map((col, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.miniAvatar,
                          { backgroundColor: col, marginLeft: idx === 0 ? 0 : -8, borderColor: c.card },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={idx === 0 ? "trophy" : idx === 1 ? "account" : "fire"}
                          size={12}
                          color="#071018"
                        />
                      </View>
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leagueStripTitle} numberOfLines={1}>
                      League Pulse
                    </Text>
                    <Text style={styles.leagueStripSub} numberOfLines={2}>
                      #{bestLeague.me?.rank ?? "–"} in {bestLeague.league.name}
                    </Text>
                  </View>
                  <View style={styles.leagueStripRight}>
                    <Text style={styles.leagueDays}>
                      {bestLeague.closed ? "Closed" : `${bestLeague.daysLeft}d left`}
                    </Text>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={t.muted} />
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Compete with friends. Join or create a league"
                  onPress={() => {
                    buzz.tick();
                    router.navigate("/(tabs)/leagues");
                  }}
                  style={({ pressed }) => [styles.leagueStrip, t.tile("slate"), { opacity: pressed ? 0.85 : 1 }]}
                >
                  <GlassSheen id="compete" color="#93C5FD" rim="rgba(255, 255, 255, 0.42)" intensity={0.22} highlightOpacity={0.14} />
                  <Text style={styles.stripEmoji}>🏆</Text>
                  <Text style={[styles.leagueStripTitle, { flex: 1 }]} numberOfLines={1}>
                    Compete With Friends
                  </Text>
                  <View style={styles.joinCreatePill}>
                    <Text style={styles.joinCreateText}>Join / Create</Text>
                    <MaterialCommunityIcons name="chevron-right" size={14} color={t.muted} />
                  </View>
                </Pressable>
              )}
            </TourTarget>
          </View>

          {/* BELOW THE FOLD */}
          <FirstWeekChecklist />

          {/* XP Challenges (no Claim button — server auto-claims) */}
          <LevelChallengesCard />
          {hasPlayed ? <LadderPromotionHost /> : null}

          {/* Asymmetric Streak + Weekly Recap Bento Pair (exact proportions & sheen of mockup) */}
          <View style={styles.bentoPair}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${streakCount}-day streak. Open Prize Vault`}
              onPress={() => {
                buzz.tick();
                openVault("boxes");
              }}
              style={({ pressed }) => [
                styles.lowerTile,
                t.tile("orange"),
                {
                  flex: 0.78,
                  opacity: pressed ? 0.86 : 1,
                },
              ]}
            >
              <GlassSheen id="streak" color="#FB923C" highlight="#FEF3C7" rim="rgba(253, 186, 116, 0.78)" intensity={0.68} highlightOpacity={0.32} cx="78%" cy="10%" />
              <Text style={styles.streakTileTitle}>
                {streakCount > 0 ? `${streakCount}-Day\nStreak 🔥` : "Start a\nStreak 🔥"}
              </Text>
              <View style={styles.pipsRow}>
                {Array.from({ length: STREAK_BONUS_MAX_DAYS }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pip,
                      { backgroundColor: i < streakDays ? "#F5B82E" : t.track },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.streakBonusFoot}>
                +{Math.max(1, streakDays) * STREAK_BONUS_PER_DAY.bronze} / +{Math.max(1, streakDays) * STREAK_BONUS_PER_DAY.silver} /{"\n"}+{Math.max(1, streakDays) * STREAK_BONUS_PER_DAY.gold} box{"\n"}bonus
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Weekly recap. Open settled bets"
              onPress={() => {
                buzz.tick();
                router.push({ pathname: "/bets", params: { tab: "settled" } });
              }}
              style={({ pressed }) => [
                styles.lowerTile,
                t.tile("green"),
                {
                  flex: 1.22,
                  opacity: pressed ? 0.86 : 1,
                },
              ]}
            >
              <GlassSheen id="weekly" color="#34D399" highlight="#D1FAE5" rim="rgba(167, 243, 208, 0.70)" intensity={0.44} highlightOpacity={0.22} cx="58%" cy="4%" />
              <Text style={styles.weeklyLabel}>Weekly Recap</Text>
              <Text
                style={[styles.weeklyNet, { color: weekly.net >= 0 ? t.positive : t.negative }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                maxFontSizeMultiplier={1.2}
              >
                {weekly.net >= 0 ? `+${weekly.net.toLocaleString()}` : weekly.net.toLocaleString()}
              </Text>
              <Text style={styles.weeklyFoot} numberOfLines={2}>
                {weekly.w}W – {weekly.l}L
                {weekly.best > 0 ? (
                  <>
                    {" · Best Hit "}
                    <Text style={styles.weeklyBestHit}>+{weekly.best.toLocaleString()}</Text>
                  </>
                ) : null}
              </Text>
            </Pressable>
          </View>

          {/* Compact Bonus Credits Liquid Glass Strip (always visible) */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Watch video for plus ${AD_REWARD_DISPLAY.credits} bonus credits`}
            disabled={bonusVideo.done || (bonusVideo.available && bonusVideo.button.disabled)}
            onPress={() => {
              buzz.tick();
              if (bonusVideo.available && bonusVideo.button.onPress) {
                bonusVideo.button.onPress();
              } else {
                Alert.alert("Bonus Credits", "Rewarded bonus videos are available in the App Store build.");
              }
            }}
            style={({ pressed }) => [styles.leagueStrip, t.tile("slate"), { opacity: pressed ? 0.85 : bonusVideo.done ? 0.65 : 1 }]}
          >
            <GlassSheen id="bonus" color="#93C5FD" rim="rgba(255, 255, 255, 0.42)" intensity={0.22} highlightOpacity={0.14} />
            <MaterialCommunityIcons name="play-circle-outline" size={20} color={t.muted} />
            <Text style={[styles.leagueStripTitle, { flex: 1 }]}>Bonus Credits</Text>
            <View style={styles.joinCreatePill}>
              <Text style={styles.joinCreateText}>
                {bonusVideo.done ? "Done Today" : `+${AD_REWARD_DISPLAY.credits} Watch`}
              </Text>
              {!bonusVideo.done ? <MaterialCommunityIcons name="chevron-right" size={14} color={t.muted} /> : null}
            </View>
          </Pressable>

          {/* Crew section — hidden completely when empty */}
          {hasCrew ? (
            <View style={{ gap: 12, marginTop: 4 }}>
              {hasChallenges ? (
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
              <CrewFeedModule items={crewItems} />
            </View>
          ) : null}
        </tourScroll.Provider>
        </SheenContext.Provider>

        <SponsoredCard compact />
      </ScrollView>

      {/* 2026 Liquid Glass Prize Vault Popup (Option 1: Luminous Spotlight) */}
      <PrizeVaultModal visible={vaultOpen} initialView={vaultView} onClose={() => setVaultOpen(false)} />

      <BetBreakdownModal item={breakdown} onClose={() => setBreakdown(null)} onOpenGame={(gId) => setQuickGame(gId)} />
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
      <PlayerProfileSheet
        uid={showCard ? profile?.uid ?? null : null}
        onClose={() => setShowCard(false)}
        seed={
          profile
            ? {
                displayName: profile.displayName,
                username: profile.username,
                avatar: profile.avatar,
                equipped: profile.equipped,
                moves: profile.moves,
                favoriteTeams: profile.favoriteTeams,
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },

  // Minimalist 2026 top bar
  topBar: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  levelRing: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  levelRingNum: { color: "#2FE38A", fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  identityWrap: { flex: 1, minWidth: 64 },
  name: { fontSize: 16, lineHeight: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  subHandle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  onScene: { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
  glassCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
  },
  dotBadge: { position: "absolute", top: 7, right: 8, width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5, borderColor: "rgba(0,0,0,0.35)" },

  // Bento Grid
  bentoSection: { gap: 10, marginTop: -24 },
  kicker: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1.1, paddingLeft: 2 },
  spotlightCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
    justifyContent: "center",
    overflow: "hidden",
  },
  spotlightRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  liveKickerRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2 },
  liveSpotMeta: { color: "rgba(241, 245, 249, 0.92)", fontSize: 12.5, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  liveSpotTag: { color: "#FF5C70", fontFamily: "Inter_800ExtraBold" },
  liveFlashSubRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  liveFlashSub: { color: "rgba(255, 228, 232, 0.9)", fontSize: 12.5, fontFamily: "Inter_500Medium" },
  betLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#FF4D63",
  },
  betLiveText: { color: "#1A070A", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  liveScoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveMatchup: { color: "rgba(255,255,255,0.7)", fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  liveTopRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  sportTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  sportTagText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(47, 227, 138, 0.16)",
  },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#FF4D63" },
  livePillText: { color: "#A7F3D0", fontSize: 12.5, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  upNextMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  upNextMetaText: { color: "rgba(226,242,240,0.9)", fontSize: 13.5, fontFamily: "Inter_600SemiBold", letterSpacing: 0.7 },
  spotlightTitle: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  spotlightScore: { color: "rgba(255,255,255,0.86)", fontSize: 15, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  scoreStrong: { color: "#FFFFFF", fontFamily: "Inter_800ExtraBold" },
  payoutPill: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.24)",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.30)",
  },
  payoutText: { color: "#FFFFFF", fontSize: 17, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  oddsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  oddsPill: {
    paddingHorizontal: 13,
    paddingVertical: 8.5,
    borderRadius: 14,
    backgroundColor: "rgba(148, 163, 184, 0.24)",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.30)",
    alignItems: "center",
    minWidth: 62,
  },
  oddsTeam: { color: "rgba(241, 245, 249, 0.90)", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  oddsVal: { color: "#FFFFFF", fontSize: 15.5, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"], marginTop: 2 },

  topRimSheen: { position: "absolute", top: 0, left: 16, right: 16, height: 1.5 },
  nextStepCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "#241B0F",
    borderColor: "rgba(250, 212, 110, 0.56)",
    paddingHorizontal: 13,
    paddingVertical: 10,
    overflow: "hidden",
  },
  nextStepIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 196, 81, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(250, 212, 110, 0.34)",
  },
  nextStepKicker: { color: "#F5C451", fontSize: 11.5, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1 },
  nextStepTitle: { color: "#FCE3A1", fontSize: 14.5, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },
  nextStepSub: { color: "rgba(255, 238, 206, 0.9)", fontSize: 12.5, fontFamily: "Inter_500Medium" },
  freeBetStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "#241B0F",
    borderColor: "rgba(250, 212, 110, 0.62)",
    paddingHorizontal: 13,
    paddingVertical: 10,
    overflow: "hidden",
  },
  freeBetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 196, 81, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(250, 212, 110, 0.36)",
  },
  freeBetTitle: { color: "#FFFFFF", fontSize: 14.5, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },
  freeBetSub: { color: "rgba(255, 238, 206, 0.9)", fontSize: 12.5, fontFamily: "Inter_500Medium" },
  freeBetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 6.5,
    borderRadius: 999,
    backgroundColor: "#F5C451",
  },
  freeBetPillText: { color: "#141006", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  equalCol: { flex: 1, minWidth: 0 },
  bentoPair: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  bentoTile: {
    width: "100%",
    minHeight: 110,
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  lowerTile: {
    minWidth: 0,
    minHeight: 138,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  tileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 22 },
  tileLabel: { color: "rgba(226,238,255,0.88)", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  vaultLabel: { color: "#E6C98C", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  vaultActiveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  vaultBigGold: { color: "#FCE3A1", fontSize: 25, lineHeight: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, fontVariant: ["tabular-nums"], flexShrink: 1 },
  claimPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#F5C451" },
  claimPillText: { color: "#141006", fontSize: 12.5, fontFamily: "Inter_800ExtraBold" },
  miniTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.16)", overflow: "hidden" },
  miniFill: { height: 4, borderRadius: 2 },
  vaultFoot: { color: "rgba(255, 238, 206, 0.9)", fontSize: 12, fontFamily: "Inter_500Medium" },

  actionMainRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  actionBig: { color: "#FFFFFF", fontSize: 25, lineHeight: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, fontVariant: ["tabular-nums"], flexShrink: 1 },
  netMini: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  tileFoot: { color: "rgba(214, 226, 244, 0.88)", fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },

  leagueStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "#101929",
    borderColor: "rgba(255, 255, 255, 0.20)",
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 48,
    overflow: "hidden",
  },
  stripEmoji: { fontSize: 16 },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  miniAvatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  leagueStripTitle: { color: "#FFFFFF", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  leagueStripSub: { color: "rgba(255,255,255,0.84)", fontSize: 12, fontFamily: "Inter_500Medium" },
  leagueStripRight: { flexDirection: "row", alignItems: "center", gap: 3 },
  leagueDays: { color: "rgba(255,255,255,0.86)", fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  joinCreatePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  joinCreateText: { color: "#FFFFFF", fontSize: 12.5, fontFamily: "Inter_600SemiBold" },

  // Below-the-fold Streak & Weekly Recap Bento
  streakTileTitle: { color: "#F7E4C8", fontSize: 17, lineHeight: 20, fontFamily: "Inter_600SemiBold", letterSpacing: -0.3 },
  pipsRow: { flexDirection: "row", gap: 4 },
  pip: { width: 6.5, height: 11, borderRadius: 3.5 },
  streakBonusFoot: { color: "rgba(245, 224, 198, 0.9)", fontSize: 12, lineHeight: 15.5, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  weeklyLabel: { color: "rgba(232, 245, 240, 0.90)", fontSize: 15, fontFamily: "Inter_500Medium" },
  weeklyNet: { fontSize: 40, lineHeight: 44, fontFamily: "Inter_700Bold", letterSpacing: -1.4, fontVariant: ["tabular-nums"] },
  weeklyFoot: { color: "rgba(220, 234, 230, 0.88)", fontSize: 12.5, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  weeklyBestHit: { color: "#4ADE80", fontFamily: "Inter_600SemiBold" },

  // Crew & Prize Vault Sheet
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  vaultSheet: { padding: 16, gap: 14, paddingBottom: 32 },
  vaultSheetTitle: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: -0.5 },
});

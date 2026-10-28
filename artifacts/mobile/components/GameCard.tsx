import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import { useColors, type Colors } from "@/hooks/useColors";
import { useValueFlash } from "@/hooks/useMotion";
import { SPRING } from "@/lib/motion";
import { fairProbabilities, formatPercent, kickoffLabel, untilKickoff } from "@/lib/odds";
import type { Game, Side, TeamSide } from "@/types/game";

export interface MyPosition {
  side: Side;
  stake: number;
  potentialPayout: number;
}

interface Props {
  game: Game;
  onBet: (game: Game, side: Side) => void;
  /** Opens the detail sheet. Tapping anywhere that isn't an odds button. */
  onOpenDetail?: (game: Game) => void;
  /** The user's existing bet on this game, if any. */
  position?: MyPosition | null;
  /** Betting closes once a game is live or final — the server rejects it too. */
  locked?: boolean;
}

/**
 * The board's unit of information.
 *
 * The previous card showed abbreviation, full name and a decimal multiplier —
 * enough to place a bet, not enough to decide whether to. Everything added
 * here answers a question a user was otherwise leaving the app to answer:
 *
 *  - who is favoured, and by how much (win probability bar, de-vigged)
 *  - are these teams any good (record, last five, rank)
 *  - what is the market line (spread and total, attributed to the book)
 *  - is it on TV, and where is it being played
 *  - what is the actual state of a live game (period and clock, not just LIVE)
 *  - what have I already got riding on it
 *
 * Layout is a stacked scoreboard rather than two columns. Side-by-side columns
 * force team names to truncate at 11 characters on a phone and leave nowhere
 * for a record; stacked rows are how every scoreboard in the world is set, and
 * they scan vertically with the list.
 */
function GameCard({ game, onBet, onOpenDetail, position, locked }: Props) {
  const c = useColors();
  const isLocked = locked ?? game.status !== "upcoming";
  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);

  const leader: Side | null =
    game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore
      ? null
      : game.homeScore > game.awayScore
        ? "home"
        : "away";

  function handleBet(side: Side) {
    if (isLocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onBet(game, side);
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: position ? c.alpha(c.primary, 0.45) : c.border,
          opacity: pressed && onOpenDetail ? 0.92 : 1,
        },
      ]}
      onPress={onOpenDetail ? () => onOpenDetail(game) : undefined}
      // react-native-web renders role="button" as a <button>; the odds buttons inside
      // would then be <button> in <button>, which React rejects. The card stays
      // tappable on web, it just isn't announced as a button there.
      accessibilityRole={onOpenDetail && Platform.OS !== "web" ? "button" : undefined}
      accessibilityLabel={`${game.awayTeam.name} at ${game.homeTeam.name}`}
    >
      <Header game={game} c={c} />

      <View style={styles.teams}>
        <View style={styles.colHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.colLabel, { color: c.subtleForeground }]}>TEAM</Text>
          <Text style={[styles.colLabel, styles.colOdds, { color: c.subtleForeground }]}>MONEYLINE</Text>
        </View>
        <TeamRow
          team={game.awayTeam}
          score={game.awayScore}
          probability={prob.away}
          leading={leader === "away"}
          locked={isLocked}
          backed={position?.side === "away"}
          onPress={() => handleBet("away")}
          c={c}
        />
        <TeamRow
          team={game.homeTeam}
          score={game.homeScore}
          probability={prob.home}
          leading={leader === "home"}
          locked={isLocked}
          backed={position?.side === "home"}
          onPress={() => handleBet("home")}
          c={c}
        />
      </View>

      <ProbabilityBar game={game} prob={prob} c={c} />

      <Footer game={game} c={c} isLocked={isLocked} />

      {position && <PositionStrip game={game} position={position} c={c} />}
    </Pressable>
  );
}

export default memo(GameCard);

/* ── header ──────────────────────────────────────────────────────────────── */

function Header({ game, c }: { game: Game; c: Colors }) {
  const sportColor = c.sport(game.sport);

  return (
    <View style={styles.header}>
      <View style={[styles.sportChip, { backgroundColor: c.alpha(sportColor, 0.16) }]}>
        <MaterialCommunityIcons name={game.sportIcon as never} size={12} color={sportColor} />
        <Text style={[styles.sportText, { color: sportColor }]}>{game.sport}</Text>
      </View>

      {game.seasonLabel ? (
        <Text style={[styles.meta, { color: c.subtleForeground }]} numberOfLines={1}>
          {game.seasonLabel}
        </Text>
      ) : null}

      <View style={styles.headerRight}>
        {game.status === "live" ? (
          <LiveClock game={game} c={c} />
        ) : game.status === "final" ? (
          <Text style={[styles.statusText, { color: c.mutedForeground }]}>Final</Text>
        ) : (
          <Text style={[styles.statusText, { color: c.foreground }]}>
            {kickoffLabel(game.startsAt)}
            <Text style={{ color: c.subtleForeground }}>{`  ${untilKickoff(game.startsAt)}`}</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

/** The one piece of unprompted motion in the app: a live game is actually live. */
function LiveClock({ game, c }: { game: Game; c: Colors }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const detail = game.clock ?? game.situation ?? kickoffLabel(game.startsAt);

  return (
    <View style={styles.headerRight}>
      <View style={[styles.liveBadge, { backgroundColor: c.live }]}>
        <Animated.View style={[styles.liveDot, { backgroundColor: "#fff", opacity: pulse }]} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
      <Text style={[styles.statusText, { color: c.foreground }]} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

/* ── team row ────────────────────────────────────────────────────────────── */

function TeamRow({
  team,
  score,
  probability,
  leading,
  locked,
  backed,
  onPress,
  c,
}: {
  team: TeamSide;
  score: number | null;
  probability: number;
  leading: boolean;
  locked: boolean;
  backed: boolean;
  onPress: () => void;
  c: Colors;
}) {
  return (
    <View style={styles.teamRow}>
      <TeamMark team={team} c={c} />

      <View style={styles.teamText}>
        <View style={styles.nameLine}>
          {team.rank ? (
            <Text style={[styles.rank, { color: c.mutedForeground }]}>{team.rank}</Text>
          ) : null}
          <Text
            style={[styles.teamName, { color: leading ? c.foreground : c.cardForeground }]}
            numberOfLines={1}
          >
            {team.name}
          </Text>
        </View>
        <View style={styles.nameLine}>
          {team.record ? (
            <Text style={[styles.record, { color: c.mutedForeground }]}>{team.record}</Text>
          ) : null}
          {team.form?.length ? <Form form={team.form} c={c} /> : null}
        </View>
      </View>

      {score !== null && (
        <Text
          style={[
            styles.score,
            { color: leading ? c.foreground : c.mutedForeground, fontVariant: ["tabular-nums"] },
          ]}
        >
          {score}
        </Text>
      )}

      <OddsButton team={team} probability={probability} locked={locked} backed={backed} onPress={onPress} c={c} />
    </View>
  );
}

/**
 * Sportsbook odds tile: neutral until it's yours; your side lights up in the
 * action colour with a pop. When the line moves it flashes green ▲ or red ▼
 * for a couple of seconds, the way the books show line movement.
 */
function OddsButton({ team, probability, locked, backed, onPress, c }: { team: TeamSide; probability: number; locked: boolean; backed: boolean; onPress: () => void; c: Colors }) {
  const flash = useValueFlash(team.odds, { up: c.positive, down: c.negative, rest: c.alpha(c.border, 0) });
  const pop = useSharedValue(1);
  const wasBacked = useRef(backed);
  useEffect(() => {
    if (backed && !wasBacked.current) pop.value = withSequence(withTiming(1.12, { duration: 110 }), withSpring(1, SPRING.bouncy));
    wasBacked.current = backed;
  }, [backed, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Reanimated.View style={popStyle}>
      <PressableScale
        style={[
          styles.oddsBtn,
          {
            backgroundColor: backed ? c.primary : c.secondary,
            borderColor: backed ? c.primary : c.border,
            opacity: locked && !backed ? 0.55 : 1,
          },
        ]}
        scaleTo={0.93}
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`Back ${team.name} at ${team.odds.toFixed(2)} times, ${formatPercent(probability)} chance${flash.dir ? `, odds ${flash.dir > 0 ? "up" : "down"}` : ""}`}
      >
        <Reanimated.View pointerEvents="none" style={[styles.oddsFlash, flash.style]} />
        <View style={styles.oddsLine}>
          {flash.dir !== 0 ? (
            <MaterialCommunityIcons name={flash.dir > 0 ? "menu-up" : "menu-down"} size={16} color={flash.dir > 0 ? c.positive : c.negative} style={{ marginHorizontal: -4 }} />
          ) : null}
          <Text style={[styles.oddsValue, { color: backed ? c.primaryForeground : c.foreground }]}>{team.odds.toFixed(2)}x</Text>
        </View>
        <Text style={[styles.oddsProb, { color: backed ? c.alpha(c.primaryForeground, 0.75) : c.mutedForeground }]}>{formatPercent(probability)}</Text>
      </PressableScale>
    </Reanimated.View>
  );
}

/** Logo when the provider has one, colour-blocked initials when it doesn't. */
function TeamMark({ team, c }: { team: TeamSide; c: Colors }) {
  if (team.logoUrl) {
    return (
      <Image
        source={{ uri: team.logoUrl }}
        style={styles.logo}
        contentFit="contain"
        transition={120}
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <View style={[styles.logo, styles.logoFallback, { backgroundColor: c.alpha(team.color, 0.22), borderColor: team.color }]}>
      <Text style={[styles.logoText, { color: team.color }]}>{team.abbreviation.slice(0, 3)}</Text>
    </View>
  );
}

function Form({ form, c }: { form: Array<"W" | "L" | "D">; c: Colors }) {
  return (
    <View style={styles.form}>
      {form.slice(0, 5).map((r, i) => (
        <View
          key={i}
          style={[
            styles.formPip,
            {
              backgroundColor:
                r === "W" ? c.positive : r === "L" ? c.alpha(c.negative, 0.75) : c.push,
              opacity: 1 - i * 0.13,
            },
          ]}
        />
      ))}
    </View>
  );
}

/* ── probability + line ──────────────────────────────────────────────────── */

function ProbabilityBar({
  game,
  prob,
  c,
}: {
  game: Game;
  prob: { home: number; away: number };
  c: Colors;
}) {
  return (
    <View style={[styles.bar, { backgroundColor: c.secondary }]} accessibilityElementsHidden>
      <View style={{ flex: Math.max(0.02, prob.away), backgroundColor: game.awayTeam.color }} />
      <View style={{ width: 2, backgroundColor: c.card }} />
      <View style={{ flex: Math.max(0.02, prob.home), backgroundColor: game.homeTeam.color }} />
    </View>
  );
}

function Footer({ game, c, isLocked }: { game: Game; c: Colors; isLocked: boolean }) {
  const bits: string[] = [];
  if (game.line?.spread) bits.push(game.line.spread);
  if (game.line?.overUnder) bits.push(`O/U ${game.line.overUnder}`);
  if (game.broadcast) bits.push(game.broadcast);
  if (game.venue && game.status === "upcoming") bits.push(game.venue);

  if (bits.length === 0 && !isLocked) return null;

  return (
    <View style={styles.footer}>
      <Text style={[styles.meta, { color: c.subtleForeground, flex: 1 }]} numberOfLines={1}>
        {bits.join("   ")}
      </Text>
      {isLocked && game.status === "live" && (
        <Text style={[styles.meta, { color: c.mutedForeground }]}>Betting closed</Text>
      )}
    </View>
  );
}

function PositionStrip({ game, position, c }: { game: Game; position: MyPosition; c: Colors }) {
  const backed = position.side === "home" ? game.homeTeam : game.awayTeam;
  const mine = position.side === "home" ? game.homeScore : game.awayScore;
  const theirs = position.side === "home" ? game.awayScore : game.homeScore;

  const state =
    mine === null || theirs === null
      ? null
      : mine === theirs
        ? { label: "Level", color: c.push }
        : mine > theirs
          ? { label: game.status === "final" ? "Won" : "Ahead", color: c.positive }
          : { label: game.status === "final" ? "Lost" : "Behind", color: c.negative };

  return (
    <View style={[styles.position, { backgroundColor: c.primarySoft, borderColor: c.alpha(c.primary, 0.3) }]}>
      <MaterialCommunityIcons name="ticket-confirmation-outline" size={14} color={c.primary} />
      <Text style={[styles.positionText, { color: c.foreground }]} numberOfLines={1}>
        {position.stake.toLocaleString()} on {backed.abbreviation} to return{" "}
        <Text style={{ color: c.primary }}>{position.potentialPayout.toLocaleString()}</Text>
      </Text>
      {state && (
        <Text style={[styles.positionState, { color: state.color }]}>{state.label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 10 },

  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  sportText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  liveText: { color: "#fff", fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 0.8 },
  colHead: { flexDirection: "row", alignItems: "center", marginBottom: -4 },
  colLabel: { flex: 1, fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  colOdds: { flex: 0, width: 80, textAlign: "center" },

  teams: { gap: 10 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  logoFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  logoText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  teamText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rank: { fontSize: 11, fontFamily: "Inter_700Bold" },
  teamName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1, letterSpacing: -0.2 },
  record: { fontSize: 11, fontFamily: "Inter_500Medium" },
  form: { flexDirection: "row", gap: 3 },
  formPip: { width: 12, height: 3, borderRadius: 2 },
  score: { fontSize: 22, fontFamily: "Inter_900Black", minWidth: 32, textAlign: "right", letterSpacing: -0.5 },

  oddsBtn: { width: 80, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", gap: 1 },
  oddsFlash: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 10, borderWidth: 2 },
  oddsLine: { flexDirection: "row", alignItems: "center" },
  oddsValue: { fontSize: 15, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.3 },
  oddsProb: { fontSize: 10, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },

  bar: { flexDirection: "row", height: 4, borderRadius: 2, overflow: "hidden" },

  footer: { flexDirection: "row", alignItems: "center", gap: 8 },

  position: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  positionText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  positionState: { fontSize: 11, fontFamily: "Inter_700Bold" },
});

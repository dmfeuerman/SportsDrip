import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { haptic as buzz } from "@/lib/motion";
import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import { useColors, type Colors } from "@/hooks/useColors";
import { useValueFlash } from "@/hooks/useMotion";
import { formatSpread, hasSpreadLine, hasTotalLine, SPREAD_TOTAL_ODDS, type Market, type Selection } from "@/lib/markets";
import { SPRING } from "@/lib/motion";
import { fairProbabilities, formatOdds, formatPercent, kickoffLabel, NO_LINE, untilKickoff } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { isPriced, type Game, type Side, type TeamSide } from "@/types/game";

export interface MyPosition {
  side: Side;
  label?: string;
  stake: number;
  potentialPayout: number;
}

export interface LeagueActionMember {
  uid: string;
  displayName: string;
  avatarColor: string;
}

interface Props {
  game: Game;
  onBet: (game: Game, side: Side, market?: Market, selection?: Selection) => void;
  /** Opens the detail sheet. Tapping anywhere that isn't an odds button. */
  onOpenDetail?: (game: Game) => void;
  /** The user's existing bet on this game, if any. */
  position?: MyPosition | null;
  /** League members on this game ("League is on this" chip). */
  leagueMembers?: LeagueActionMember[];
  /** Betting closes once a game is live or final — the server rejects it too. */
  locked?: boolean;
}

function GameCard({ game, onBet, onOpenDetail, position, leagueMembers, locked }: Props) {
  const c = useColors();
  const oddsFormat = useOddsFormat();
  const isLocked = locked ?? (game.status !== "upcoming" || !!game.disrupted);
  const priced = isPriced(game);
  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const canSpread = !isLocked && hasSpreadLine(game);
  const canTotal = !isLocked && hasTotalLine(game);

  const leader: Side | null =
    game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore
      ? null
      : game.homeScore > game.awayScore
        ? "home"
        : "away";

  function handleBet(side: Side, market: Market = "ml", selection?: Selection) {
    if (isLocked) return;
    if (market === "ml" && !priced) {
      onOpenDetail?.(game);
      return;
    }
    buzz.medium();
    onBet(game, side, market, selection ?? side);
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
          priced={priced}
          leading={leader === "away"}
          locked={isLocked}
          backed={position?.side === "away"}
          oddsFormat={oddsFormat}
          onPress={() => handleBet("away", "ml", "away")}
          c={c}
        />
        <TeamRow
          team={game.homeTeam}
          score={game.homeScore}
          probability={prob.home}
          priced={priced}
          leading={leader === "home"}
          locked={isLocked}
          backed={position?.side === "home"}
          oddsFormat={oddsFormat}
          onPress={() => handleBet("home", "ml", "home")}
          c={c}
        />
      </View>

      {priced ? <ProbabilityBar game={game} prob={prob} c={c} /> : null}

      {(canSpread || canTotal) && (
        <View style={styles.marketStrip}>
          {canSpread && typeof game.line?.spreadHome === "number" ? (
            <>
              <PressableScale
                style={[styles.marketChip, { backgroundColor: c.secondary, borderColor: c.border }]}
                scaleTo={0.95}
                onPress={() => handleBet("away", "spread", "away")}
              >
                <Text style={[styles.marketChipLabel, { color: c.foreground }]}>
                  {game.awayTeam.abbreviation} {formatSpread(-game.line.spreadHome)}
                </Text>
                <Text style={[styles.marketChipOdds, { color: c.mutedForeground }]}>
                  {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                </Text>
              </PressableScale>
              <PressableScale
                style={[styles.marketChip, { backgroundColor: c.secondary, borderColor: c.border }]}
                scaleTo={0.95}
                onPress={() => handleBet("home", "spread", "home")}
              >
                <Text style={[styles.marketChipLabel, { color: c.foreground }]}>
                  {game.homeTeam.abbreviation} {formatSpread(game.line.spreadHome)}
                </Text>
                <Text style={[styles.marketChipOdds, { color: c.mutedForeground }]}>
                  {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                </Text>
              </PressableScale>
            </>
          ) : null}
          {canTotal && typeof game.line?.overUnder === "number" ? (
            <>
              <PressableScale
                style={[styles.marketChip, { backgroundColor: c.secondary, borderColor: c.border }]}
                scaleTo={0.95}
                onPress={() => handleBet("home", "total", "over")}
              >
                <Text style={[styles.marketChipLabel, { color: c.foreground }]}>
                  O {game.line.overUnder}
                </Text>
                <Text style={[styles.marketChipOdds, { color: c.mutedForeground }]}>
                  {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                </Text>
              </PressableScale>
              <PressableScale
                style={[styles.marketChip, { backgroundColor: c.secondary, borderColor: c.border }]}
                scaleTo={0.95}
                onPress={() => handleBet("away", "total", "under")}
              >
                <Text style={[styles.marketChipLabel, { color: c.foreground }]}>
                  U {game.line.overUnder}
                </Text>
                <Text style={[styles.marketChipOdds, { color: c.mutedForeground }]}>
                  {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                </Text>
              </PressableScale>
            </>
          ) : null}
        </View>
      )}

      <Footer game={game} c={c} isLocked={isLocked} priced={priced} leagueMembers={leagueMembers} />

      {position && <PositionStrip game={game} position={position} c={c} />}
    </Pressable>
  );
}

export default memo(GameCard);

function Header({ game, c }: { game: Game; c: Colors }) {
  const sportColor = c.sport(game.sport);
  const now = Date.now();
  const msLeft = game.startsAt - now;
  const underHour = game.status === "upcoming" && !game.disrupted && msLeft > 0 && msLeft <= 60 * 60_000;

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
        {game.disrupted ? (
          <Text style={[styles.statusText, { color: c.warning }]}>
            {game.disrupted === "canceled" ? "Cancelled" : "Postponed"}
          </Text>
        ) : game.status === "live" ? (
          <LiveClock game={game} c={c} />
        ) : game.status === "final" ? (
          <Text style={[styles.statusText, { color: c.mutedForeground }]}>Final</Text>
        ) : (
          <Text style={[styles.statusText, { color: c.foreground }]}>
            {kickoffLabel(game.startsAt)}
            <Text style={{ color: underHour ? c.live : c.subtleForeground }}>
              {`  ${underHour ? `Locks ${untilKickoff(game.startsAt)}` : untilKickoff(game.startsAt)}`}
            </Text>
          </Text>
        )}
      </View>
    </View>
  );
}

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
      <Text style={[styles.statusText, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function TeamRow({
  team,
  score,
  probability,
  priced,
  leading,
  locked,
  backed,
  oddsFormat,
  onPress,
  c,
}: {
  team: TeamSide;
  score: number | null;
  probability: number;
  priced: boolean;
  leading: boolean;
  locked: boolean;
  backed: boolean;
  oddsFormat: "decimal" | "american";
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

      {priced || backed ? (
        <OddsButton
          team={team}
          probability={probability}
          locked={locked}
          backed={backed}
          oddsFormat={oddsFormat}
          onPress={onPress}
          c={c}
        />
      ) : (
        <NoLineTile locked={locked} onPress={onPress} c={c} />
      )}
    </View>
  );
}

function NoLineTile({ locked, onPress, c }: { locked: boolean; onPress: () => void; c: Colors }) {
  return (
    <PressableScale
      style={[styles.oddsBtn, { backgroundColor: c.secondary, borderColor: c.border, borderStyle: "dashed", opacity: locked ? 0.55 : 1 }]}
      scaleTo={0.96}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={`${NO_LINE}. Opens the game`}
    >
      <Text style={[styles.noLine, { color: c.mutedForeground }]}>No line</Text>
      <Text style={[styles.oddsProb, { color: c.subtleForeground }]}>yet</Text>
    </PressableScale>
  );
}

function OddsButton({
  team,
  probability,
  locked,
  backed,
  oddsFormat,
  onPress,
  c,
}: {
  team: TeamSide;
  probability: number;
  locked: boolean;
  backed: boolean;
  oddsFormat: "decimal" | "american";
  onPress: () => void;
  c: Colors;
}) {
  const odds = team.odds ?? 0;
  const flash = useValueFlash(odds, { up: c.positive, down: c.negative, rest: c.alpha(c.border, 0) });
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
        accessibilityLabel={odds > 1 ? `Back ${team.name} at ${formatOdds(odds, oddsFormat)}, ${formatPercent(probability)} chance` : `Your pick: ${team.name}`}
      >
        <Reanimated.View pointerEvents="none" style={[styles.oddsFlash, flash.style]} />
        <View style={styles.oddsLine}>
          {flash.dir !== 0 ? (
            <MaterialCommunityIcons name={flash.dir > 0 ? "menu-up" : "menu-down"} size={16} color={flash.dir > 0 ? c.positive : c.negative} style={{ marginHorizontal: -4 }} />
          ) : null}
          <Text style={[styles.oddsValue, { color: backed ? c.primaryForeground : c.foreground }]}>
            {odds > 1 ? formatOdds(odds, oddsFormat) : "—"}
          </Text>
        </View>
        <Text style={[styles.oddsProb, { color: backed ? c.alpha(c.primaryForeground, 0.75) : c.mutedForeground }]}>{odds > 1 ? formatPercent(probability) : "your pick"}</Text>
      </PressableScale>
    </Reanimated.View>
  );
}

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

function Footer({
  game,
  c,
  isLocked,
  priced,
  leagueMembers,
}: {
  game: Game;
  c: Colors;
  isLocked: boolean;
  priced: boolean;
  leagueMembers?: LeagueActionMember[];
}) {
  const noLine = !priced && game.status === "upcoming" && !game.disrupted;
  const bits: string[] = [];
  if (game.line?.spread) bits.push(game.line.spread);
  if (game.line?.overUnder) bits.push(`O/U ${game.line.overUnder}`);
  if (game.broadcast) bits.push(game.broadcast);
  if (game.venue && game.status === "upcoming") bits.push(game.venue);

  const hasLeagueAction = !!leagueMembers && leagueMembers.length > 0;
  if (bits.length === 0 && !isLocked && !noLine && !hasLeagueAction) return null;

  return (
    <View style={styles.footer}>
      {hasLeagueAction && (
        <View style={[styles.leagueOnChip, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.45) }]}>
          <View style={styles.avatarStack}>
            {leagueMembers.slice(0, 3).map((m, idx) => (
              <View
                key={m.uid}
                style={[
                  styles.avatarPip,
                  { backgroundColor: m.avatarColor || c.league, borderColor: c.card, marginLeft: idx === 0 ? 0 : -6 },
                ]}
              >
                <Text style={styles.avatarPipText}>{(m.displayName || "P")[0]!.toUpperCase()}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.leagueOnText, { color: c.league }]}>
            {leagueMembers.length === 1
              ? `${leagueMembers[0]!.displayName} on this`
              : `${leagueMembers.length} in league on this`}
          </Text>
        </View>
      )}
      <Text style={[styles.meta, { color: c.subtleForeground, flex: 1 }]} numberOfLines={1}>
        {bits.join("   ")}
      </Text>
      {isLocked && game.status === "live" && (
        <Text style={[styles.meta, { color: c.mutedForeground }]}>Betting closed</Text>
      )}
      {noLine && (
        <View style={[styles.noLinePill, { backgroundColor: c.alpha(c.warning, 0.14) }]}>
          <MaterialCommunityIcons name="clock-outline" size={11} color={c.warning} />
          <Text style={[styles.noLinePillText, { color: c.warning }]}>{NO_LINE}</Text>
        </View>
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
        {position.stake.toLocaleString()} on {position.label ?? backed.abbreviation} to return{" "}
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto", flexShrink: 0, maxWidth: "62%" },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, flexShrink: 0 },
  sportText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  // Long season labels ("Premier League · Regular Season") truncate instead of pushing the status off-screen.
  meta: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 11, fontFamily: "Inter_400Regular" },
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
  noLine: { fontSize: 12, fontFamily: "Inter_700Bold" },
  noLinePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  noLinePillText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },

  marketStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  marketChip: { flex: 1, minWidth: 74, borderWidth: 1, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 8, alignItems: "center", gap: 1 },
  marketChipLabel: { fontSize: 11, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  marketChipOdds: { fontSize: 10, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },

  bar: { flexDirection: "row", height: 4, borderRadius: 2, overflow: "hidden" },

  footer: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  leagueOnChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  avatarPip: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  avatarPipText: { color: "#fff", fontSize: 8, fontFamily: "Inter_800ExtraBold" },
  leagueOnText: { fontSize: 10, fontFamily: "Inter_700Bold" },

  position: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  positionText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  positionState: { fontSize: 11, fontFamily: "Inter_700Bold" },
});

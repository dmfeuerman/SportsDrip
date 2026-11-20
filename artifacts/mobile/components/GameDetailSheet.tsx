import FlashPickCard from "@/components/FlashPickCard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { haptic } from "@/lib/motion";
import TeamCrest from "@/components/TeamCrest";
import { FormChips, MatchupTape, StreakBadge, VenueTag } from "@/components/TeamMeta";
import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import ScrollHint, { useScrollHint } from "@/components/ScrollHint";
import { Button, CloseButton } from "@/components/ui";
import { GlassModalSurface, LiquidGlass } from "@/components/ui/LiquidGlass";
import { Pressable } from "@/components/fx/Tap";
import { Linescore, MatchupInsights, ScoringTimeline, SituationCard } from "@/components/insights";
import { useColors, type Colors } from "@/hooks/useColors";
import { hintProviderPath } from "@/lib/insights/onDevice";
import { useGameInsights } from "@/hooks/useGameInsights";
import { useNow } from "@/hooks/useNow";
import { formatSpread, hasSpreadLine, hasTotalLine, quoteMarket, SPREAD_TOTAL_ODDS, type Market, type Selection } from "@/lib/markets";
import { useParlay } from "@/context/ParlayContext";
import { fairProbabilities, formatDecimal, formatOdds, formatPercent, kickoffLabel, margin, NO_LINE, toAmerican, untilKickoff } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { isPriced, type Game, type Side, type TeamSide } from "@/types/game";

export interface DetailBet {
  id: string;
  side: Side | null;
  label?: string;
  teamAbbr?: string;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: string;
  /** League name for league-wallet bets; omitted means credits. */
  wallet?: string;
}

interface Props {
  game: Game | null;
  onClose: () => void;
  onBet: (game: Game, side: Side, market?: Market, selection?: Selection) => void;
  /** Head-to-head with a friend on this pick: opens the slip in friend mode. */
  onChallenge?: (game: Game, side: Side) => void;
  /** The user's bets on this fixture. */
  bets?: DetailBet[];
  /** Full-screen game center. The sheet closes first. */
  onOpenCenter?: (game: Game) => void;
}

/** The pick a game opens with: always the top-right option (home moneyline), or null when nothing can be bet on it. */
function defaultPick(game: Game): { side: Side; market: Market; selection: Selection; label: string } | null {
  if (game.status !== "upcoming" || game.disrupted || game.startsAt <= Date.now()) return null;
  return { side: "home", market: "ml", selection: "home", label: `${game.homeTeam.abbreviation} to win` };
}

export default function GameDetailSheet({ game, onClose, onBet, onChallenge, bets = [], onOpenCenter }: Props) {
  const c = useColors();
  const oddsFormat = useOddsFormat();
  const hint = useScrollHint();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const statsY = useRef(0);
  type Pick = { side: Side; market: Market; selection: Selection; label: string };
  const [pick, setPick] = useState<Pick | null>(null);
  useEffect(() => {
    setPick(game ? defaultPick(game) : null);
    setNudge(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);
  const [nudge, setNudge] = useState<string | null>(null);
  const choose = (p: Pick) => {
    haptic.tick();
    setNudge(null);
    setPick(p);
  };
  const isPicked = (m: Market, sel: Selection) => pick?.market === m && pick.selection === sel;
  if (game) hintProviderPath(game.id, game.providerPath);
  const insights = useGameInsights(game?.id ?? null, game?.status);
  const parlay = useParlay();
  const building = parlay.legs.length > 0;
  const tick = useNow(5_000);
  if (!game) return null;

  const priced = isPriced(game);
  const canSpread = hasSpreadLine(game);
  const canTotal = hasTotalLine(game);
  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const vig = margin(game.homeTeam.odds, game.awayTeam.odds);
  const now = Math.max(tick, Date.now());
  const canBet = game.status === "upcoming" && !game.disrupted && game.startsAt > now;
  const underHour = canBet && game.startsAt - now <= 60 * 60_000;
  const friendOnly = canBet && !priced && !canSpread && !canTotal && !!onChallenge;

  // Dynamic dome glow adapts to the currently highlighted team/market!
  const activeGlow =
    pick?.market === "total"
      ? c.primary
      : pick?.side === "away"
        ? game.awayTeam.color
        : game.homeTeam.color || c.primary;

  const glassSubtleBg = c.isDark ? "rgba(255, 255, 255, 0.05)" : c.alpha(c.secondary, 0.72);
  const glassSubtleBorder = c.isDark ? "rgba(255, 255, 255, 0.12)" : c.border;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={styles.scrim}>
        {Platform.OS !== "web" ? (
          <BlurView intensity={44} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(4, 6, 12, 0.66)" }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close game details" />

        <Animated.View entering={ZoomIn.springify().damping(18).stiffness(220)} style={styles.modalWrap}>
          <GlassModalSurface id={`game_detail_${game.id}`} glowColor={activeGlow} style={styles.modalSurface}>
            {/* Top Bar: Sport Kicker + Glass Close Button */}
            <View style={styles.topBar}>
              <View style={[styles.sportPill, { backgroundColor: c.alpha(activeGlow, 0.18), borderColor: c.alpha(activeGlow, 0.42) }]}>
                <Text style={[styles.sportPillText, { color: c.foreground }]} numberOfLines={1}>
                  {[game.sport, game.seasonLabel].filter(Boolean).join(" · ").toUpperCase()}
                </Text>
              </View>
              {game.broadcast ? (
                <Text style={[styles.broadcast, { color: c.subtleForeground }]} numberOfLines={1}>
                  {game.broadcast}
                </Text>
              ) : null}
              <View style={{ flex: 1 }} />
              <CloseButton onPress={onClose} label="Close" />
            </View>

            {/* Scrollable Matchup Hero + Insights */}
            <View style={styles.scrollWrap}>
              <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} {...hint.scrollProps} contentContainerStyle={styles.body}>
                {/* 2026 Bento Matchup Hero */}
                <LiquidGlass variant="tile" radius={20} borderColor={glassSubtleBorder} contentStyle={styles.matchupCard}>
                  <View style={styles.matchup}>
                    <TeamColumn side="away" neutral={game.neutralSite} sport={game.sport} team={game.awayTeam} score={game.awayScore} probability={priced ? prob.away : null} c={c} />
                    <View style={styles.centre}>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: game.status === "live" ? c.alpha(c.live, 0.18) : glassSubtleBg,
                            borderColor: game.status === "live" ? c.alpha(c.live, 0.5) : glassSubtleBorder,
                          },
                        ]}
                      >
                        <Text style={[styles.kickoff, { color: game.status === "live" ? c.live : c.foreground }]}>
                          {game.disrupted
                            ? game.disrupted === "canceled"
                              ? "Cancelled"
                              : "Postponed"
                            : game.status === "live"
                              ? game.clock ?? "Live"
                              : game.status === "final"
                                ? "Final"
                                : kickoffLabel(game.startsAt)}
                        </Text>
                      </View>
                      <Text style={[styles.at, { color: c.subtleForeground }]}>AT</Text>
                      {game.status === "upcoming" && !game.disrupted && (
                        <Text style={[styles.countdown, { color: underHour ? c.live : c.mutedForeground }]}>
                          {underHour ? `Locks ${untilKickoff(game.startsAt)}` : untilKickoff(game.startsAt)}
                        </Text>
                      )}
                    </View>
                    <TeamColumn side="home" neutral={game.neutralSite} sport={game.sport} team={game.homeTeam} score={game.homeScore} probability={priced ? prob.home : null} c={c} />
                  </View>
                  {game.venue ? (
                    <Text style={[styles.venue, { color: c.subtleForeground }]} numberOfLines={1}>
                      {game.venue}
                    </Text>
                  ) : null}
                </LiquidGlass>

                {game.status === "upcoming" ? <MatchupTape game={game} /> : null}

                {onOpenCenter ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onOpenCenter(game)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
                  >
                    <LiquidGlass
                      variant="tile"
                      radius={16}
                      tintColor={game.status === "live" ? c.alpha(c.live, 0.12) : undefined}
                      borderColor={game.status === "live" ? c.alpha(c.live, 0.45) : glassSubtleBorder}
                      contentStyle={styles.callout}
                    >
                      <MaterialCommunityIcons
                        name={game.status === "live" ? "broadcast" : "chart-box-outline"}
                        size={17}
                        color={game.status === "live" ? c.live : c.accent}
                      />
                      <Text style={[styles.calloutText, { color: c.foreground }]}>
                        {game.status === "live"
                          ? "Live scoring, sweat tracker, play-by-play and win probability"
                          : game.status === "final"
                            ? "Full recap and box score"
                            : "Full Game Center: form, head-to-head & key players"}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
                    </LiquidGlass>
                  </Pressable>
                ) : null}

                <SituationCard game={game} />
                {game.status === "live" ? <FlashPickCard game={game} /> : null}
                {game.status !== "upcoming" ? (
                  <>
                    <Linescore game={game} insights={insights.data} />
                    <ScoringTimeline game={game} insights={insights.data} />
                  </>
                ) : null}

                <Section title="THE MARKET" c={c}>
                  {priced ? (
                    <>
                      <Row
                        label={game.awayTeam.abbreviation}
                        value={`${formatDecimal(game.awayTeam.odds)}   ${toAmerican(game.awayTeam.odds)}`}
                        hint={`${formatPercent(prob.away, 1)} to win`}
                        c={c}
                      />
                      <Row
                        label={game.homeTeam.abbreviation}
                        value={`${formatDecimal(game.homeTeam.odds)}   ${toAmerican(game.homeTeam.odds)}`}
                        hint={`${formatPercent(prob.home, 1)} to win`}
                        c={c}
                      />
                    </>
                  ) : (
                    <Row label="Moneyline" value={NO_LINE} hint="the book hasn't priced this game" c={c} />
                  )}
                  {game.line?.spread ? (
                    <Row
                      label="Spread"
                      value={game.line.spread}
                      hint={canSpread ? `Pays ${formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)} · land on exact line = push` : undefined}
                      c={c}
                    />
                  ) : null}
                  {game.line?.overUnder ? (
                    <Row
                      label="Total (O/U)"
                      value={String(game.line.overUnder)}
                      hint={canTotal ? `Pays ${formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)} · land on exact line = push` : undefined}
                      c={c}
                    />
                  ) : null}
                  {priced && game.oddsSource === "model" ? (
                    <Row
                      label="Line source"
                      value="On The House Model"
                      hint={`No sportsbook line yet. Built from team ratings and results${game.model ? ` · ${game.model.confidence} confidence` : ""}. Updates as results come in.`}
                      c={c}
                    />
                  ) : null}
                  {priced ? (
                    <Row
                      label="Built-in edge"
                      value={formatPercent(vig, 1)}
                      hint="the house's cut, already in these odds"
                      c={c}
                    />
                  ) : null}
                </Section>

                <View onLayout={(e) => (statsY.current = e.nativeEvent.layout.y)}>
                  <MatchupInsights
                    game={game}
                    insights={insights.data}
                    loading={insights.loading}
                    error={insights.error}
                    onRetry={() => void insights.reload()}
                  />
                </View>

                {bets.length > 0 && (
                  <Section title={`YOUR BETS (${bets.length})`} c={c}>
                    {bets.map((b) => {
                      const t = b.side === "away" ? game.awayTeam : game.homeTeam;
                      const pickText = b.label ?? b.teamAbbr ?? t.abbreviation;
                      return (
                        <Row
                          key={b.id}
                          label={`${b.stake.toLocaleString()} on ${pickText}`}
                          value={b.potentialPayout.toLocaleString()}
                          hint={`${b.wallet ? `${b.wallet} · league tokens` : "Credits"} · at ${formatOdds(b.odds, oddsFormat)} · ${b.status}`}
                          accent={c.primary}
                          c={c}
                        />
                      );
                    })}
                  </Section>
                )}
              </ScrollView>
              <ScrollHint
                visible={hint.visible}
                label="View Team Stats"
                onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, statsY.current - 8), animated: true })}
              />
            </View>

            {/* 2026 Liquid Glass Bet Types & Action Deck */}
            {canBet && (priced || canSpread || canTotal || onChallenge) ? (
              <View style={[styles.footer, { borderTopColor: glassSubtleBorder, backgroundColor: c.isDark ? "rgba(8, 10, 16, 0.45)" : c.alpha(c.background, 0.4) }]}>
                {friendOnly ? (
                  <Text style={[styles.closedNote, { color: c.mutedForeground }]}>
                    {NO_LINE} — the book can't take this game, but you can challenge a friend on it.
                  </Text>
                ) : null}

                <Text style={[styles.groupLabel, { color: c.subtleForeground }]}>MONEYLINE · WHO WINS</Text>
                <View style={styles.actionRow}>
                  {(["away", "home"] as Side[]).map((side) => {
                    const t = side === "home" ? game.homeTeam : game.awayTeam;
                    const on = isPicked("ml", side);
                    return (
                      <Pressable
                        key={side}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`Pick ${t.name} to win`}
                        style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => choose({ side, market: "ml", selection: side, label: `${t.abbreviation} to win` })}
                      >
                        <LiquidGlass
                          variant="tile"
                          radius={16}
                          interactive
                          tintColor={c.alpha(t.color, on ? 0.36 : 0.14)}
                          borderColor={on ? c.primary : c.alpha(t.color, 0.55)}
                          borderWidth={on ? 2 : 1}
                          contentStyle={styles.action}
                        >
                          <Text style={[styles.actionTeam, { color: c.foreground }]} numberOfLines={1}>
                            {t.abbreviation}
                          </Text>
                          <Text style={[styles.actionOdds, { color: on ? c.foreground : c.mutedForeground }]}>
                            {friendOnly ? "vs a friend" : formatOdds(t.odds, oddsFormat)}
                          </Text>
                        </LiquidGlass>
                      </Pressable>
                    );
                  })}
                </View>

                {canSpread && typeof game.line?.spreadHome === "number" ? (
                  <>
                    <Text style={[styles.groupLabel, { color: c.subtleForeground }]}>SPREAD · WIN OR LOSE BY</Text>
                    <View style={styles.subActionRow}>
                      {(["away", "home"] as Side[]).map((side) => {
                        const t = side === "home" ? game.homeTeam : game.awayTeam;
                        const line = formatSpread(side === "home" ? game.line!.spreadHome! : -game.line!.spreadHome!);
                        const on = isPicked("spread", side);
                        return (
                          <Pressable
                            key={side}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.85 : 1 }]}
                            onPress={() => choose({ side, market: "spread", selection: side, label: `${t.abbreviation} ${line}` })}
                          >
                            <LiquidGlass
                              variant="tile"
                              radius={14}
                              interactive
                              tintColor={on ? c.alpha(c.primary, 0.22) : undefined}
                              borderColor={on ? c.primary : glassSubtleBorder}
                              borderWidth={on ? 2 : 1}
                              contentStyle={styles.subAction}
                            >
                              <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                                {t.abbreviation} {line}
                              </Text>
                              <Text style={[styles.subActionOdds, { color: on ? c.foreground : c.mutedForeground }]}>
                                {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                              </Text>
                            </LiquidGlass>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                {canTotal && typeof game.line?.overUnder === "number" ? (
                  <>
                    <Text style={[styles.groupLabel, { color: c.subtleForeground }]}>TOTAL POINTS · OVER / UNDER</Text>
                    <View style={styles.subActionRow}>
                      {(["over", "under"] as const).map((sel) => {
                        const on = isPicked("total", sel);
                        const label = `${sel === "over" ? "Over" : "Under"} ${game.line!.overUnder}`;
                        return (
                          <Pressable
                            key={sel}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.85 : 1 }]}
                            onPress={() => choose({ side: sel === "over" ? "home" : "away", market: "total", selection: sel, label })}
                          >
                            <LiquidGlass
                              variant="tile"
                              radius={14}
                              interactive
                              tintColor={on ? c.alpha(c.primary, 0.22) : undefined}
                              borderColor={on ? c.primary : glassSubtleBorder}
                              borderWidth={on ? 2 : 1}
                              contentStyle={styles.subAction}
                            >
                              <Text style={[styles.subActionTitle, { color: c.foreground }]}>{label}</Text>
                              <Text style={[styles.subActionOdds, { color: on ? c.foreground : c.mutedForeground }]}>
                                {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                              </Text>
                            </LiquidGlass>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                {nudge ? (
                  <View accessibilityRole="alert" style={[styles.nudge, { backgroundColor: c.alpha(c.warning, 0.16), borderColor: c.warning }]}>
                    <MaterialCommunityIcons name="gesture-tap" size={16} color={c.warning} />
                    <Text style={[styles.nudgeText, { color: c.foreground }]}>{nudge}</Text>
                  </View>
                ) : null}

                <View style={[styles.pickBadge, { backgroundColor: glassSubtleBg, borderColor: glassSubtleBorder }]}>
                  <Text style={[styles.pickLine, { color: pick ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                    {pick ? (
                      <>
                        Selected: <Text style={{ color: c.primary }}>{pick.label}</Text>
                      </>
                    ) : (
                      "Tap a pick above, then choose how to play it"
                    )}
                  </Text>
                </View>

                {!building ? (
                  <View style={styles.actionRow}>
                    {!friendOnly ? (
                      <Button
                        label="Choose Bet Amount"
                        icon="cash-multiple"
                        size="sm"
                        style={{ flex: 1.35, opacity: pick ? 1 : 0.55 }}
                        accessibilityHint="Opens the bet slip to choose how much to stake"
                        onPress={() => {
                          if (!pick) {
                            haptic.warning();
                            setNudge("Pick a team, spread or total above first.");
                            return;
                          }
                          onBet(game, pick.side, pick.market, pick.selection);
                        }}
                      />
                    ) : null}
                    {onChallenge ? (
                      <Button
                        label="Select Friend"
                        icon="sword-cross"
                        variant={friendOnly ? "primary" : "secondary"}
                        size="sm"
                        style={{ flex: 1, opacity: pick && pick.market === "ml" ? 1 : 0.55 }}
                        accessibilityHint="Pick a friend to challenge on this side, then choose the amount"
                        onPress={() => {
                          if (!pick || pick.market !== "ml") {
                            haptic.warning();
                            setNudge(!pick ? "Pick the team you're backing first, then choose a friend." : "Friend challenges are on who wins. Pick a team under Moneyline.");
                            return;
                          }
                          onChallenge(game, pick.side);
                        }}
                      />
                    ) : null}
                  </View>
                ) : null}

                {!friendOnly && pick ? (
                  <Button
                    label={parlay.has(game.id, pick.market, pick.selection) ? "On Your Parlay ✓" : parlay.has(game.id) ? "Swap Parlay Leg" : "Add to Parlay"}
                    icon="link-variant"
                    variant={building ? "primary" : "secondary"}
                    size="sm"
                    accessibilityHint="Adds this pick to your parlay slip; every leg has to hit"
                    onPress={() => {
                      if (parlay.has(game.id, pick.market, pick.selection)) {
                        parlay.remove(game.id);
                        return;
                      }
                      const q = quoteMarket(game, pick.market, pick.selection);
                      if (!q.odds) {
                        haptic.warning();
                        setNudge("That pick has no price yet, so it can't go on a parlay.");
                        return;
                      }
                      haptic.tick();
                      parlay.add({
                        gameId: game.id,
                        market: pick.market,
                        selection: pick.selection,
                        label: q.label || pick.label,
                        odds: q.odds,
                        sport: game.sport,
                        matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
                        startsAt: game.startsAt,
                      });
                      onClose();
                    }}
                  />
                ) : null}

                {building ? (
                  <Button
                    label="Cancel Parlay"
                    icon="close"
                    variant="secondary"
                    size="sm"
                    accessibilityHint="Removes every pick from your parlay slip"
                    onPress={() => {
                      haptic.warning();
                      parlay.clear();
                    }}
                  />
                ) : null}
              </View>
            ) : (
              <View style={[styles.closedFooter, { borderTopColor: glassSubtleBorder }]}>
                {!game.disrupted && !canBet && game.status !== "final" ? (
                  <View style={styles.closedHead}>
                    <MaterialCommunityIcons name="lock-outline" size={16} color={c.foreground} />
                    <Text style={[styles.closedTitle, { color: c.foreground }]}>Lines closed</Text>
                  </View>
                ) : null}
                {!game.disrupted && !canBet && (priced || game.line?.spread || game.line?.overUnder) ? (
                  <Text style={[styles.closedNote, { color: c.subtleForeground }]}>
                    {[
                      priced ? `${game.awayTeam.abbreviation} ${formatOdds(game.awayTeam.odds, oddsFormat)} · ${game.homeTeam.abbreviation} ${formatOdds(game.homeTeam.odds, oddsFormat)}` : null,
                      game.line?.spread ? `Spread ${game.line.spread}` : null,
                      game.line?.overUnder ? `O/U ${game.line.overUnder}` : null,
                    ]
                      .filter(Boolean)
                      .join("   ·   ")}
                  </Text>
                ) : null}
                <Text style={[styles.closedNote, { color: c.mutedForeground }]}>
                  {game.disrupted
                    ? `This game is ${game.disrupted}. Open bets are refunded automatically.`
                    : canBet
                      ? `${NO_LINE}. The book hasn't priced this game — check back closer to kickoff.`
                      : game.status !== "final"
                        ? "Betting closed when the game started. Open bets settle at the final."
                        : "This game is over. Results settle on their own."}
                </Text>
              </View>
            )}
          </GlassModalSurface>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function TeamColumn({
  side,
  neutral,
  sport,
  team,
  score,
  probability,
  c,
}: {
  side: "home" | "away";
  neutral?: boolean | null;
  sport: string;
  team: TeamSide;
  score: number | null;
  probability: number | null;
  c: Colors;
}) {
  return (
    <View style={styles.teamCol}>
      <TeamCrest abbr={team.abbreviation} color={team.color} altColor={team.altColor} size={54} sport={sport} />
      <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={2}>
        {team.name}
      </Text>
      {score !== null ? (
        <Text style={[styles.bigScore, { color: c.foreground }]}>{score}</Text>
      ) : (
        <Text style={[styles.bigProb, { color: c.mutedForeground }]}>{probability != null ? formatPercent(probability) : "—"}</Text>
      )}
      <View style={styles.teamMeta}>
        <VenueTag side={side} neutral={neutral} />
        {team.record ? <Text style={[styles.teamRecord, { color: c.cardForeground }]}>{team.record}</Text> : null}
        <StreakBadge form={team.form} />
      </View>
      <FormChips form={team.form} size={14} />
    </View>
  );
}

function Section({ title, c, children }: { title: string; c: Colors; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{title}</Text>
      <LiquidGlass variant="tile" radius={16} contentStyle={styles.sectionBody}>
        {children}
      </LiquidGlass>
    </View>
  );
}

function Row({
  label,
  value,
  hint,
  accent,
  c,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  c: Colors;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: c.cardForeground }]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, { color: c.subtleForeground }]}>{hint}</Text> : null}
      </View>
      <Text style={[styles.rowValue, { color: accent ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 28 },
  modalWrap: { width: "100%", maxWidth: 420, maxHeight: "90%" },
  modalSurface: { width: "100%", maxHeight: "100%", overflow: "hidden" },

  topBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  sportPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, maxWidth: "60%" },
  sportPillText: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.2 },
  broadcast: { fontSize: 11, fontFamily: "Inter_600SemiBold", flexShrink: 1 },

  scrollWrap: { flexShrink: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },

  matchupCard: { padding: 14, gap: 8 },
  matchup: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  teamCol: { flex: 1, alignItems: "center", gap: 5 },
  teamMeta: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "center" },
  teamRecord: { fontSize: 11, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  centre: { alignItems: "center", gap: 4, paddingTop: 14 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  at: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  kickoff: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  countdown: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  venue: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  teamName: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  bigScore: { fontSize: 26, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  bigProb: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },

  callout: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  calloutText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },

  section: { gap: 6 },
  sectionTitle: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.3, paddingLeft: 2 },
  sectionBody: { paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rowHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowValue: { fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1 },
  groupLabel: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.2, marginBottom: -3 },
  actionRow: { flexDirection: "row", gap: 10 },
  action: { paddingVertical: 10, alignItems: "center", gap: 2 },
  actionTeam: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  actionOdds: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },

  subActionRow: { flexDirection: "row", gap: 8 },
  subAction: { paddingVertical: 8, alignItems: "center", gap: 1 },
  subActionTitle: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  subActionOdds: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },

  nudge: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  nudgeText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pickBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5, alignSelf: "center" },
  pickLine: { fontSize: 12, fontFamily: "Inter_700Bold", textAlign: "center" },

  closedFooter: { gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1 },
  closedHead: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  closedTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  closedNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 17 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import TeamCrest from "@/components/TeamCrest";
import { haptic as buzz } from "@/lib/motion";
import React, { memo, useEffect, useRef, useState } from "react";
import { quoteMarket } from "@/lib/markets";
import { useParlay } from "@/context/ParlayContext";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { TourTarget } from "@/components/tour/TourTarget";
import { tourEvent } from "@/lib/tour/store";
import Reanimated, {
  cancelAnimation,
  Easing as REasing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import { Button } from "@/components/ui";
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
  /** Tapping the "League is on this" chip (opens the tail sheet). */
  onLeaguePress?: (game: Game) => void;
  /** Head-to-head with a friend on the picked side (opens the slip in friend mode). */
  onChallenge?: (game: Game, side: Side) => void;
  /** Tutorial handle: "first" / "second" mark this card's odds and buttons as tour targets. */
  tourKey?: string;
}

/** A tour target when the card has a tutorial handle; a plain View otherwise (same layout). */
function MaybeTarget({ id, style, children }: { id?: string; style?: object; children: React.ReactNode }) {
  return id ? <TourTarget id={id} style={style}>{children}</TourTarget> : <View style={style}>{children}</View>;
}

type Pick = { side: Side; market: Market; selection: Selection; label: string };

function GameCard({ game, onBet, onOpenDetail, position, leagueMembers, locked, onLeaguePress, onChallenge, tourKey }: Props) {
  const tid = (part: string) => (tourKey ? `game.${tourKey}.${part}` : undefined);
  const c = useColors();
  const oddsFormat = useOddsFormat();
  const isLocked = locked ?? (game.status !== "upcoming" || !!game.disrupted);
  const priced = isPriced(game);
  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const canSpread = hasSpreadLine(game);
  const canTotal = hasTotalLine(game);

  const leader: Side | null =
    game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore
      ? null
      : game.homeScore > game.awayScore
        ? "home"
        : "away";

  // Tap a price to highlight it, then confirm with the button below.
  const [pick, setPick] = useState<Pick | null>(null);
  const parlay = useParlay();
  useEffect(() => {
    if (isLocked) setPick(null);
  }, [isLocked]);
  const isPicked = (market: Market, selection: Selection) => pick?.market === market && pick.selection === selection;

  function handleBet(side: Side, market: Market = "ml", selection?: Selection, label?: string) {
    if (isLocked) return;
    if (market === "ml" && !priced) {
      onOpenDetail?.(game);
      return;
    }
    const sel = selection ?? side;
    buzz.tick();
    const next = pick && pick.market === market && pick.selection === sel ? null : { side, market, selection: sel, label: label ?? (side === "home" ? game.homeTeam.abbreviation : game.awayTeam.abbreviation) };
    setPick(next);
    if (next) tourEvent("pick:selected");
  }

  function addToParlay() {
    if (!pick) return;
    const q = quoteMarket(game, pick.market, pick.selection);
    if (!q.odds) return;
    buzz.tick();
    parlay.add({ gameId: game.id, market: pick.market, selection: pick.selection, label: q.label || pick.label, odds: q.odds, sport: game.sport, matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`, startsAt: game.startsAt });
    setPick(null);
    tourEvent("parlay:add");
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

      <MaybeTarget id={tid("odds")} style={styles.teams}>
        <View style={styles.colHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.colLabel, { color: c.subtleForeground }]}>MONEYLINE · WHO WINS</Text>
          <Text style={[styles.colLabel, styles.colOdds, { color: c.subtleForeground }]}>TAP TO PICK</Text>
        </View>
        <TeamRow
          sport={game.sport}
          team={game.awayTeam}
          score={game.awayScore}
          probability={prob.away}
          priced={priced}
          leading={leader === "away"}
          locked={isLocked}
          backed={position?.side === "away"}
          selected={isPicked("ml", "away")}
          oddsFormat={oddsFormat}
          onPress={() => handleBet("away", "ml", "away", `${game.awayTeam.abbreviation} to win`)}
          tourId={tid("odds.away")}
          c={c}
        />
        <TeamRow
          sport={game.sport}
          team={game.homeTeam}
          score={game.homeScore}
          probability={prob.home}
          priced={priced}
          leading={leader === "home"}
          locked={isLocked}
          backed={position?.side === "home"}
          selected={isPicked("ml", "home")}
          oddsFormat={oddsFormat}
          onPress={() => handleBet("home", "ml", "home", `${game.homeTeam.abbreviation} to win`)}
          tourId={tid("odds.home")}
          c={c}
        />
      </MaybeTarget>

      {priced ? <ProbabilityBar game={game} prob={prob} c={c} /> : null}

      {canSpread && typeof game.line?.spreadHome === "number" ? (
        <MarketGroup title="SPREAD · WIN OR LOSE BY" c={c}>
          <MarketChip
            label={`${game.awayTeam.abbreviation} ${formatSpread(-game.line.spreadHome)}`}
            odds={formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
            selected={isPicked("spread", "away")}
            disabled={isLocked}
            onPress={() => handleBet("away", "spread", "away", `${game.awayTeam.abbreviation} ${formatSpread(-game.line!.spreadHome!)}`)}
            c={c}
          />
          <MarketChip
            label={`${game.homeTeam.abbreviation} ${formatSpread(game.line.spreadHome)}`}
            odds={formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
            selected={isPicked("spread", "home")}
            disabled={isLocked}
            onPress={() => handleBet("home", "spread", "home", `${game.homeTeam.abbreviation} ${formatSpread(game.line!.spreadHome!)}`)}
            c={c}
          />
        </MarketGroup>
      ) : null}
      {canTotal && typeof game.line?.overUnder === "number" ? (
        <MarketGroup title="TOTAL POINTS · OVER / UNDER" c={c}>
          <MarketChip
            label={`Over ${game.line.overUnder}`}
            odds={formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
            selected={isPicked("total", "over")}
            disabled={isLocked}
            onPress={() => handleBet("home", "total", "over", `Over ${game.line!.overUnder}`)}
            c={c}
          />
          <MarketChip
            label={`Under ${game.line.overUnder}`}
            odds={formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
            selected={isPicked("total", "under")}
            disabled={isLocked}
            onPress={() => handleBet("away", "total", "under", `Under ${game.line!.overUnder}`)}
            c={c}
          />
        </MarketGroup>
      ) : null}

      {pick && !isLocked ? (
        <View style={[styles.cta, { borderColor: c.alpha(c.primary, 0.4), backgroundColor: c.primarySoft }]}>
          <Text style={[styles.ctaText, { color: c.foreground }]} numberOfLines={1}>
            Your Pick: <Text style={{ color: c.primary }}>{pick.label}</Text>
          </Text>
          <View style={styles.ctaRow}>
            {parlay.legs.length ? (
              // A parlay is being built: picks can only go on it (or the parlay is called off).
              <>
                <MaybeTarget id={tid("parlay")} style={{ flex: 1.3 }}>
                <Button
                  label={parlay.has(game.id, pick.market, pick.selection) ? "On Parlay" : "Add to Parlay"}
                  icon="link-variant"
                  size="sm"
                  accessibilityHint="Adds this pick to your parlay slip"
                  onPress={addToParlay}
                />
                </MaybeTarget>
                <Button
                  label="Cancel Parlay"
                  icon="close"
                  size="sm"
                  variant="secondary"
                  style={{ flex: 1 }}
                  accessibilityHint="Removes every pick from your parlay slip"
                  onPress={() => {
                    buzz.warning();
                    parlay.clear();
                    setPick(null);
                  }}
                />
              </>
            ) : (
              <>
            <MaybeTarget id={tid("bet")} style={{ flex: 1.3 }}>
            <Button
              label="Choose Bet Amount"
              icon="cash-multiple"
              size="sm"
              accessibilityHint="Opens the bet slip to choose how much to stake"
              onPress={() => {
                buzz.medium();
                onBet(game, pick.side, pick.market, pick.selection);
                setPick(null);
              }}
            />
            </MaybeTarget>
            <MaybeTarget id={tid("parlay")} style={{ flex: 0.9 }}>
            <Button
              label="+ Parlay"
              icon="link-variant"
              size="sm"
              variant="secondary"
              accessibilityHint="Starts a parlay with this pick"
              onPress={addToParlay}
            />
            </MaybeTarget>
            {onChallenge && pick.market === "ml" ? (
              <Button
                label="Select Friend"
                icon="sword-cross"
                size="sm"
                variant="secondary"
                style={{ flex: 1 }}
                accessibilityHint="Pick a friend to challenge, then choose the amount"
                onPress={() => {
                  onChallenge(game, pick.side);
                  setPick(null);
                }}
              />
            ) : null}
              </>
            )}
          </View>
        </View>
      ) : null}

      <Footer
        game={game}
        c={c}
        isLocked={isLocked}
        priced={priced}
        leagueMembers={leagueMembers}
        onLeaguePress={onLeaguePress ? () => onLeaguePress(game) : undefined}
      />

      {position && <PositionStrip game={game} position={position} c={c} />}
    </Pressable>
  );
}

export default memo(GameCard);

function MarketGroup({ title, c, children }: { title: string; c: Colors; children: React.ReactNode }) {
  return (
    <View style={[styles.group, { borderTopColor: c.border }]}>
      <Text style={[styles.colLabel, { color: c.subtleForeground }]}>{title}</Text>
      <View style={styles.marketStrip}>{children}</View>
    </View>
  );
}

function MarketChip({ label, odds, selected, onPress, disabled = false, c }: { label: string; odds: string; selected: boolean; onPress: () => void; disabled?: boolean; c: Colors }) {
  return (
    <PressableScale
      style={[
        styles.marketChip,
        selected
          ? { backgroundColor: c.alpha(c.primary, 0.18), borderColor: c.primary, borderWidth: 2 }
          : { backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.22) },
        disabled && { opacity: 0.55 },
      ]}
      scaleTo={0.95}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} at ${odds}${selected ? ", selected" : ""}${disabled ? ", betting closed" : ""}`}
    >
      <Text style={[styles.marketChipLabel, { color: c.foreground }]}>{label}</Text>
      <Text style={[styles.marketChipOdds, { color: selected ? c.primary : c.mutedForeground }]}>{odds}</Text>
    </PressableScale>
  );
}

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
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 700, easing: REasing.inOut(REasing.quad) }),
        withTiming(1, { duration: 700, easing: REasing.inOut(REasing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const detail = game.clock ?? game.situation ?? kickoffLabel(game.startsAt);

  return (
    <View style={styles.headerRight}>
      <View style={[styles.liveBadge, { backgroundColor: c.live }]}>
        <Reanimated.View style={[styles.liveDot, { backgroundColor: "#fff" }, dotStyle]} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
      <Text style={[styles.statusText, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function TeamRow({
  sport,
  team,
  score,
  probability,
  priced,
  leading,
  locked,
  backed,
  selected,
  oddsFormat,
  onPress,
  c,
  tourId,
}: {
  tourId?: string;
  sport: string;
  team: TeamSide;
  score: number | null;
  probability: number;
  priced: boolean;
  leading: boolean;
  locked: boolean;
  backed: boolean;
  selected: boolean;
  oddsFormat: "decimal" | "american";
  onPress: () => void;
  c: Colors;
}) {
  return (
    <View style={styles.teamRow}>
      <TeamMark team={team} sport={sport} c={c} />

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

      <MaybeTarget id={tourId}>
      {priced || backed ? (
        <OddsButton
          team={team}
          probability={probability}
          locked={locked}
          backed={backed}
          selected={selected}
          oddsFormat={oddsFormat}
          onPress={onPress}
          c={c}
        />
      ) : (
        <NoLineTile locked={locked} onPress={onPress} c={c} />
      )}
      </MaybeTarget>
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
      accessibilityLabel={locked ? "Lines closed" : `${NO_LINE}. Opens the game`}
    >
      <Text style={[styles.noLine, { color: c.mutedForeground }]}>{locked ? "Lines" : "No Line"}</Text>
      <Text style={[styles.oddsProb, { color: c.subtleForeground }]}>{locked ? "closed" : "yet"}</Text>
    </PressableScale>
  );
}

function OddsButton({
  team,
  probability,
  locked,
  backed,
  selected,
  oddsFormat,
  onPress,
  c,
}: {
  team: TeamSide;
  probability: number;
  locked: boolean;
  backed: boolean;
  selected: boolean;
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
            backgroundColor: backed ? c.primary : selected ? c.alpha(c.primary, 0.18) : c.secondary,
            borderColor: backed || selected ? c.primary : c.alpha(c.foreground, 0.1),
            borderWidth: selected ? 2 : 1,
            opacity: locked && !backed ? 0.55 : 1,
          },
        ]}
        scaleTo={0.93}
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={odds > 1 ? `Pick ${team.name} at ${formatOdds(odds, oddsFormat)}, ${formatPercent(probability)} chance` : `Your pick: ${team.name}`}
      >
        <Reanimated.View pointerEvents="none" style={[styles.oddsFlash, flash.style]} />
        <View style={styles.oddsLine}>
          {flash.dir !== 0 ? (
            <MaterialCommunityIcons name={flash.dir > 0 ? "menu-up" : "menu-down"} size={16} color={flash.dir > 0 ? c.positive : c.negative} style={{ marginHorizontal: -4 }} />
          ) : null}
          <Text style={[styles.oddsValue, { color: backed ? c.primaryForeground : odds > 1 ? c.primary : c.foreground }]}>
            {odds > 1 ? formatOdds(odds, oddsFormat) : "—"}
          </Text>
        </View>
        <Text style={[styles.oddsProb, { color: backed ? c.alpha(c.primaryForeground, 0.75) : c.mutedForeground }]}>{odds > 1 ? formatPercent(probability) : "your pick"}</Text>
      </PressableScale>
    </Reanimated.View>
  );
}

/** Team colour + abbreviation. Official logos aren't shown (trademarked). */
function TeamMark({ team, sport, c: _c }: { team: TeamSide; sport: string; c: Colors }) {
  return (
    <TeamCrest abbr={team.abbreviation} color={team.color} altColor={team.altColor} size={28} sport={sport} />
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
  onLeaguePress,
}: {
  game: Game;
  c: Colors;
  isLocked: boolean;
  priced: boolean;
  leagueMembers?: LeagueActionMember[];
  onLeaguePress?: () => void;
}) {
  const noLine = !priced && game.status === "upcoming" && !game.disrupted;
  const modelLine = priced && game.oddsSource === "model" && game.status === "upcoming";
  const bits: string[] = [];
  if (game.line?.spread) bits.push(game.line.spread);
  if (game.line?.overUnder) bits.push(`O/U ${game.line.overUnder}`);
  if (game.broadcast) bits.push(game.broadcast);
  if (game.venue && game.status === "upcoming") bits.push(game.venue);

  const hasLeagueAction = !!leagueMembers && leagueMembers.length > 0;
  if (bits.length === 0 && !isLocked && !noLine && !modelLine && !hasLeagueAction) return null;

  return (
    <View style={styles.footer}>
      {hasLeagueAction && (
        <Pressable
          onPress={onLeaguePress}
          disabled={!onLeaguePress}
          hitSlop={6}
          accessibilityRole={onLeaguePress ? "button" : undefined}
          accessibilityLabel="See who in your league is on this game"
          style={[styles.leagueOnChip, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.45) }]}
        >
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
        </Pressable>
      )}
      <Text style={[styles.meta, { color: c.subtleForeground, flex: 1 }]} numberOfLines={1}>
        {bits.join("   ")}
      </Text>
      {isLocked && game.status === "live" && (
        <Text style={[styles.meta, { color: c.mutedForeground }]}>Betting Closed</Text>
      )}
      {modelLine && (
        <View
          accessible
          accessibilityLabel="SportDrip model line. No sportsbook line yet."
          style={[styles.noLinePill, { backgroundColor: c.alpha(c.accent, 0.14) }]}
        >
          <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={11} color={c.accent} />
          <Text style={[styles.noLinePillText, { color: c.accent }]}>Model Line</Text>
        </View>
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
  sportText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  // Long season labels ("Premier League · Regular Season") truncate instead of pushing the status off-screen.
  meta: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 11, fontFamily: "Inter_400Regular" },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  liveText: { color: "#fff", fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.8 },
  colHead: { flexDirection: "row", alignItems: "center", marginBottom: -4 },
  colLabel: { flex: 1, fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  colOdds: { flex: 0, width: 80, textAlign: "center" },

  teams: { gap: 10 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  logoFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  logoText: { fontSize: 11, fontFamily: "Inter_700Bold" },
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
  oddsProb: { fontSize: 11, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  noLine: { fontSize: 12, fontFamily: "Inter_700Bold" },
  noLinePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  noLinePillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },

  marketStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  group: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  cta: { gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  ctaText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  ctaRow: { flexDirection: "row", gap: 8 },
  marketChip: { flex: 1, minWidth: 74, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, alignItems: "center", gap: 1 },
  marketChipLabel: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  marketChipOdds: { fontSize: 11, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },

  bar: { flexDirection: "row", height: 4, borderRadius: 2, overflow: "hidden" },

  footer: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  leagueOnChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  avatarPip: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  avatarPipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  leagueOnText: { fontSize: 11, fontFamily: "Inter_700Bold" },

  position: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  positionText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  positionState: { fontSize: 11, fontFamily: "Inter_700Bold" },
});

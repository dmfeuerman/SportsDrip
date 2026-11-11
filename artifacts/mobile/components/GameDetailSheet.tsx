import FlashPickCard from "@/components/FlashPickCard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic } from "@/lib/motion";
import TeamCrest from "@/components/TeamCrest";
import { FormChips, MatchupTape, StreakBadge, VenueTag } from "@/components/TeamMeta";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScrollHint, { useScrollHint } from "@/components/ScrollHint";
import { Button } from "@/components/ui";
import { Pressable } from "@/components/fx/Tap";
import KeyboardSheet from "@/components/KeyboardSheet";
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
  const insets = useSafeAreaInsets();
  const hint = useScrollHint();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const statsY = useRef(0);
  type Pick = { side: Side; market: Market; selection: Selection; label: string };
  const [pick, setPick] = useState<Pick | null>(null);
  // Opening a game pre-selects the top-right option (home moneyline); the player can switch to anything else.
  useEffect(() => {
    setPick(game ? defaultPick(game) : null);
    setNudge(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);
  const [nudge, setNudge] = useState<string | null>(null);
  const choose = (p: Pick) => {
    setNudge(null);
    // Always one selected: tapping the current pick keeps it rather than clearing it.
    setPick(p);
  };
  const isPicked = (m: Market, sel: Selection) => pick?.market === m && pick.selection === sel;
  if (game) hintProviderPath(game.id, game.providerPath);
  const insights = useGameInsights(game?.id ?? null, game?.status);
  const parlay = useParlay();
  const building = parlay.legs.length > 0;
  // Ticks so an open sheet closes betting the moment the game starts.
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

  return (
    <KeyboardSheet visible onClose={onClose} maxHeight="92%" style={[styles.sheet, { paddingBottom: Math.max(insets.bottom - 18, 8) }]} headerStyle={styles.header}>
      <View style={styles.scrollWrap}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} {...hint.scrollProps} contentContainerStyle={styles.body}>
        <Text style={[styles.kicker, { color: c.subtleForeground }]}>
          {[game.sport, game.seasonLabel, game.venue].filter(Boolean).join("   ")}
        </Text>

        <View style={styles.matchup}>
          <TeamColumn side="away" neutral={game.neutralSite} sport={game.sport} team={game.awayTeam} score={game.awayScore} probability={priced ? prob.away : null} c={c} />
          <View style={styles.centre}>
            <Text style={[styles.at, { color: c.subtleForeground }]}>at</Text>
            <Text style={[styles.kickoff, { color: c.foreground }]}>
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
            {game.status === "upcoming" && !game.disrupted && (
              <Text style={[styles.kicker, { color: underHour ? c.live : c.subtleForeground }]}>
                {underHour ? `Locks ${untilKickoff(game.startsAt)}` : untilKickoff(game.startsAt)}
              </Text>
            )}
          </View>
          <TeamColumn side="home" neutral={game.neutralSite} sport={game.sport} team={game.homeTeam} score={game.homeScore} probability={priced ? prob.home : null} c={c} />
        </View>

        {game.status === "upcoming" ? <MatchupTape game={game} /> : null}

        {onOpenCenter ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenCenter(game)}
            style={({ pressed }) => [
              styles.callout,
              { backgroundColor: c.secondary, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <MaterialCommunityIcons
              name={game.status === "live" ? "broadcast" : "chart-box-outline"}
              size={16}
              color={game.status === "live" ? c.live : c.accent}
            />
            <Text style={[styles.calloutText, { color: c.cardForeground }]}>
              {game.status === "live"
                ? "Live scoring, sweat tracker, play-by-play and win probability"
                : game.status === "final"
                  ? "Full recap and box score"
                  : "Full matchup: form, head-to-head, key players"}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
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

        <Section title="The Market" c={c}>
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
          <Section title={`Your Bets (${bets.length})`} c={c}>
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

        {game.broadcast ? (
          <Text style={[styles.kicker, { color: c.subtleForeground }]}>
            Watch on {game.broadcast}
          </Text>
        ) : null}
      </ScrollView>
      <ScrollHint
        visible={hint.visible}
        label="View Team Stats"
        onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, statsY.current - 8), animated: true })}
      />
      </View>

      {canBet && (priced || canSpread || canTotal || onChallenge) ? (
        <View style={[styles.footer, { borderTopColor: c.border }]}>
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
                  style={({ pressed }) => [
                    styles.action,
                    {
                      backgroundColor: c.alpha(t.color, on ? 0.38 : pressed ? 0.3 : 0.16),
                      borderColor: on ? c.primary : c.alpha(t.color, 0.6),
                      borderWidth: on ? 2 : 1,
                    },
                  ]}
                  onPress={() => choose({ side, market: "ml", selection: side, label: `${t.abbreviation} to win` })}
                >
                  <Text style={[styles.actionTeam, { color: c.foreground }]} numberOfLines={1}>
                    {t.abbreviation}
                  </Text>
                  <Text style={[styles.actionOdds, { color: c.mutedForeground }]}>
                    {friendOnly ? "vs a friend" : formatOdds(t.odds, oddsFormat)}
                  </Text>
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
                      style={[styles.subAction, on ? { backgroundColor: c.alpha(c.primary, 0.18), borderColor: c.primary, borderWidth: 2 } : { backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.22) }]}
                      onPress={() => choose({ side, market: "spread", selection: side, label: `${t.abbreviation} ${line}` })}
                    >
                      <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                        {t.abbreviation} {line}
                      </Text>
                      <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>{formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}</Text>
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
                      style={[styles.subAction, on ? { backgroundColor: c.alpha(c.primary, 0.18), borderColor: c.primary, borderWidth: 2 } : { backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.22) }]}
                      onPress={() => choose({ side: sel === "over" ? "home" : "away", market: "total", selection: sel, label })}
                    >
                      <Text style={[styles.subActionTitle, { color: c.foreground }]}>{label}</Text>
                      <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>{formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          {nudge ? (
            <View accessibilityRole="alert" style={[styles.nudge, { backgroundColor: c.alpha(c.warning, 0.14), borderColor: c.warning }]}>
              <MaterialCommunityIcons name="gesture-tap" size={16} color={c.warning} />
              <Text style={[styles.nudgeText, { color: c.foreground }]}>{nudge}</Text>
            </View>
          ) : null}
          <Text style={[styles.pickLine, { color: pick ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
            {pick ? (
              <>
                Your Pick: <Text style={{ color: c.primary }}>{pick.label}</Text>
              </>
            ) : (
              "Tap a pick above, then choose how to play it"
            )}
          </Text>
          {/* A parlay is being built: picks can only go on it (or the parlay is called off). */}
          {!building ? (
          <View style={styles.actionRow}>
            {!friendOnly ? (
              <Button
                label="Choose Bet Amount"
                icon="cash-multiple"
                size="sm"
                style={{ flex: 1.3, opacity: pick ? 1 : 0.55 }}
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
        <View style={[styles.actions, { borderTopColor: c.border, flexDirection: "column", gap: 4 }]}>
          {!game.disrupted && !canBet && game.status !== "final" ? (
            <View style={styles.closedHead}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={c.foreground} />
              <Text style={[styles.closedTitle, { color: c.foreground }]}>Lines closed</Text>
            </View>
          ) : null}
          {!game.disrupted && !canBet && (priced || game.line?.spread || game.line?.overUnder) ? (
            <Text style={[styles.closedNote, { color: c.subtleForeground, flex: 0 }]}>
              {[
                priced ? `${game.awayTeam.abbreviation} ${formatOdds(game.awayTeam.odds, oddsFormat)} · ${game.homeTeam.abbreviation} ${formatOdds(game.homeTeam.odds, oddsFormat)}` : null,
                game.line?.spread ? `Spread ${game.line.spread}` : null,
                game.line?.overUnder ? `O/U ${game.line.overUnder}` : null,
              ]
                .filter(Boolean)
                .join("   ·   ")}
            </Text>
          ) : null}
          <Text style={[styles.closedNote, { color: c.mutedForeground, flex: 0 }]}>
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
    </KeyboardSheet>
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
      <TeamCrest abbr={team.abbreviation} color={team.color} altColor={team.altColor} size={58} sport={sport} />
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
      <FormChips form={team.form} size={15} />
    </View>
  );
}

function Section({ title, c, children }: { title: string; c: Colors; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.foreground }]}>{title}</Text>
      <View style={[styles.sectionBody, { borderColor: c.border, backgroundColor: c.card }]}>
        {children}
      </View>
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
  sheet: { paddingHorizontal: 0, gap: 0 },
  header: { marginHorizontal: 16 },
  scrollWrap: { flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  groupLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginBottom: -4 },
  nudge: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  nudgeText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pickLine: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  kicker: { fontSize: 11, fontFamily: "Inter_500Medium" },

  matchup: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  teamCol: { flex: 1, alignItems: "center", gap: 6 },
  teamMeta: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "center" },
  teamRecord: { fontSize: 12, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  centre: { alignItems: "center", gap: 2, paddingTop: 18 },
  at: { fontSize: 12, fontFamily: "Inter_400Regular" },
  kickoff: { fontSize: 14, fontFamily: "Inter_700Bold" },
  bigLogo: { width: 54, height: 54, borderRadius: 14 },
  logoFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  logoText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  teamName: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  bigScore: { fontSize: 28, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  bigProb: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  callout: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  calloutText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },

  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionBody: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rowHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowValue: { fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1 },
  actionRow: { flexDirection: "row", gap: 10 },
  subActionRow: { flexDirection: "row", gap: 8 },
  subAction: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", gap: 1 },
  subActionTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  subActionOdds: { fontSize: 11, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  vsToggle: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  vsText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  action: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 10, alignItems: "center", gap: 2 },
  actionTeam: { fontSize: 15, fontFamily: "Inter_700Bold" },
  actionOdds: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  closedNote: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  closedHead: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  closedTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
});

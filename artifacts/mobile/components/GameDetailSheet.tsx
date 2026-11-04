import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import KeyboardSheet from "@/components/KeyboardSheet";
import { Linescore, MatchupInsights, ScoringTimeline, SituationCard } from "@/components/insights";
import { useColors, type Colors } from "@/hooks/useColors";
import { useGameInsights } from "@/hooks/useGameInsights";
import { formatSpread, hasSpreadLine, hasTotalLine, SPREAD_TOTAL_ODDS, type Market, type Selection } from "@/lib/markets";
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

export default function GameDetailSheet({ game, onClose, onBet, onChallenge, bets = [], onOpenCenter }: Props) {
  const c = useColors();
  const oddsFormat = useOddsFormat();
  const [vsFriend, setVsFriend] = useState(false);
  useEffect(() => setVsFriend(false), [game?.id]);
  const insights = useGameInsights(game?.id ?? null, game?.status);
  if (!game) return null;

  const priced = isPriced(game);
  const canSpread = hasSpreadLine(game);
  const canTotal = hasTotalLine(game);
  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const vig = margin(game.homeTeam.odds, game.awayTeam.odds);
  const now = Date.now();
  const canBet = game.status === "upcoming" && !game.disrupted && game.startsAt > now;
  const underHour = canBet && game.startsAt - now <= 60 * 60_000;
  const friendOnly = canBet && !priced && !canSpread && !canTotal && !!onChallenge;
  const asFriend = vsFriend || friendOnly;

  return (
    <KeyboardSheet visible onClose={onClose} maxHeight="88%" style={styles.sheet} headerStyle={styles.header}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={[styles.kicker, { color: c.subtleForeground }]}>
          {[game.sport, game.seasonLabel, game.venue].filter(Boolean).join("   ")}
        </Text>

        <View style={styles.matchup}>
          <TeamColumn team={game.awayTeam} score={game.awayScore} probability={priced ? prob.away : null} c={c} />
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
          <TeamColumn team={game.homeTeam} score={game.homeScore} probability={priced ? prob.home : null} c={c} />
        </View>

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
                  : "Full matchup: sweat tracker, form, head-to-head, key players"}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
          </Pressable>
        ) : null}

        <SituationCard game={game} />
        {game.status !== "upcoming" ? (
          <>
            <Linescore game={game} insights={insights.data} />
            <ScoringTimeline game={game} insights={insights.data} />
          </>
        ) : null}

        <Section title="The market" c={c}>
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
          {priced ? (
            <Row
              label="Built-in edge"
              value={formatPercent(vig, 1)}
              hint="the house's cut, already in these odds"
              c={c}
            />
          ) : null}
        </Section>

        <MatchupInsights
          game={game}
          insights={insights.data}
          loading={insights.loading}
          error={insights.error}
          onRetry={() => void insights.reload()}
        />

        {bets.length > 0 && (
          <Section title={`Your bets (${bets.length})`} c={c}>
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

      {canBet && (priced || canSpread || canTotal || onChallenge) ? (
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          {friendOnly ? (
            <Text style={[styles.closedNote, { color: c.mutedForeground }]}>
              {NO_LINE} — the book can't take this game, but you can challenge a friend on it.
            </Text>
          ) : onChallenge ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: vsFriend }}
              accessibilityLabel="Challenge a friend instead of betting the book"
              onPress={() => setVsFriend((v) => !v)}
              style={[styles.vsToggle, { backgroundColor: vsFriend ? c.alpha(c.accent, 0.14) : c.secondary, borderColor: vsFriend ? c.accent : c.border }]}
            >
              <MaterialCommunityIcons name="sword-cross" size={15} color={vsFriend ? c.accent : c.mutedForeground} />
              <Text style={[styles.vsText, { color: vsFriend ? c.foreground : c.mutedForeground }]}>
                {vsFriend ? "Challenging a friend — pick your side" : "Challenge a friend on this game"}
              </Text>
              <MaterialCommunityIcons name={vsFriend ? "toggle-switch" : "toggle-switch-off-outline"} size={26} color={vsFriend ? c.accent : c.subtleForeground} />
            </Pressable>
          ) : null}
          <View style={styles.actionRow}>
            {(["away", "home"] as Side[]).map((side) => {
              const t = side === "home" ? game.homeTeam : game.awayTeam;
              return (
                <Pressable
                  key={side}
                  style={({ pressed }) => [
                    styles.action,
                    {
                      backgroundColor: c.alpha(t.color, pressed ? 0.32 : 0.2),
                      borderColor: c.alpha(t.color, 0.6),
                    },
                  ]}
                  onPress={() => (asFriend && onChallenge ? onChallenge(game, side) : onBet(game, side, "ml", side))}
                >
                  <Text style={[styles.actionTeam, { color: c.foreground }]} numberOfLines={1}>
                    {asFriend ? `Take ${t.abbreviation}` : `Back ${t.abbreviation}`}
                  </Text>
                  <Text style={[styles.actionOdds, { color: c.mutedForeground }]}>
                    {asFriend ? "vs a friend" : formatOdds(t.odds, oddsFormat)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!asFriend && (canSpread || canTotal) && (
            <View style={styles.subActionRow}>
              {canSpread && typeof game.line?.spreadHome === "number" ? (
                <>
                  <Pressable
                    style={[styles.subAction, { backgroundColor: c.secondary, borderColor: c.border }]}
                    onPress={() => onBet(game, "away", "spread", "away")}
                  >
                    <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                      {game.awayTeam.abbreviation} {formatSpread(-game.line.spreadHome)}
                    </Text>
                    <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>
                      {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.subAction, { backgroundColor: c.secondary, borderColor: c.border }]}
                    onPress={() => onBet(game, "home", "spread", "home")}
                  >
                    <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                      {game.homeTeam.abbreviation} {formatSpread(game.line.spreadHome)}
                    </Text>
                    <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>
                      {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                    </Text>
                  </Pressable>
                </>
              ) : null}
              {canTotal && typeof game.line?.overUnder === "number" ? (
                <>
                  <Pressable
                    style={[styles.subAction, { backgroundColor: c.secondary, borderColor: c.border }]}
                    onPress={() => onBet(game, "home", "total", "over")}
                  >
                    <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                      Over {game.line.overUnder}
                    </Text>
                    <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>
                      {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.subAction, { backgroundColor: c.secondary, borderColor: c.border }]}
                    onPress={() => onBet(game, "away", "total", "under")}
                  >
                    <Text style={[styles.subActionTitle, { color: c.foreground }]}>
                      Under {game.line.overUnder}
                    </Text>
                    <Text style={[styles.subActionOdds, { color: c.mutedForeground }]}>
                      {formatOdds(SPREAD_TOTAL_ODDS, oddsFormat)}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.actions, { borderTopColor: c.border }]}>
          <Text style={[styles.closedNote, { color: c.mutedForeground }]}>
            {game.disrupted
              ? `This game is ${game.disrupted}. Open bets are refunded automatically.`
              : canBet
                ? `${NO_LINE}. The book hasn't priced this game — check back closer to kickoff.`
                : game.status !== "final"
                  ? "Betting closed once the game starts."
                  : "This game is over. Results settle on their own."}
          </Text>
        </View>
      )}
    </KeyboardSheet>
  );
}

function TeamColumn({
  team,
  score,
  probability,
  c,
}: {
  team: TeamSide;
  score: number | null;
  probability: number | null;
  c: Colors;
}) {
  return (
    <View style={styles.teamCol}>
      {team.logoUrl ? (
        <Image source={{ uri: team.logoUrl }} style={styles.bigLogo} contentFit="contain" transition={120} />
      ) : (
        <View style={[styles.bigLogo, styles.logoFallback, { backgroundColor: c.alpha(team.color, 0.2), borderColor: team.color }]}>
          <Text style={[styles.logoText, { color: team.color }]}>{team.abbreviation}</Text>
        </View>
      )}
      <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={2}>
        {team.name}
      </Text>
      {score !== null ? (
        <Text style={[styles.bigScore, { color: c.foreground }]}>{score}</Text>
      ) : (
        <Text style={[styles.bigProb, { color: c.mutedForeground }]}>{probability != null ? formatPercent(probability) : "—"}</Text>
      )}
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
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
  kicker: { fontSize: 11, fontFamily: "Inter_500Medium" },

  matchup: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  teamCol: { flex: 1, alignItems: "center", gap: 6 },
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

  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 16, borderTopWidth: 1 },
  footer: { gap: 10, paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1 },
  actionRow: { flexDirection: "row", gap: 10 },
  subActionRow: { flexDirection: "row", gap: 8 },
  subAction: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", gap: 1 },
  subActionTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  subActionOdds: { fontSize: 10, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  vsToggle: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  vsText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  action: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 2 },
  actionTeam: { fontSize: 15, fontFamily: "Inter_700Bold" },
  actionOdds: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  closedNote: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});

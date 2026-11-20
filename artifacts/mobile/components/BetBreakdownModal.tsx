import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Amount, Button, CloseButton, Pill, StatTile } from "@/components/ui";
import { GlassModalSurface } from "@/components/ui/LiquidGlass";
import { useColors } from "@/hooks/useColors";
import { describeBet } from "@/lib/markets";
import { formatOdds, formatPercent, impliedProbability, untilKickoff } from "@/lib/odds";
import type { Game, TeamSide } from "@/types/game";
import { useOddsFormat } from "@/lib/settings";
import { shareViewOrText } from "@/lib/shareCard";

export interface BetBreakdownLeg {
  label: string;
  matchup: string;
  sport?: string | null;
  odds: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled" | "void" | string;
  ownerName?: string;
}

export interface BetBreakdownItem {
  id: string;
  gameId?: string | null;
  sport?: string | null;
  teamName: string;
  teamAbbr: string;
  teamColor?: string;
  opponentAbbr: string;
  side?: "home" | "away" | null;
  market?: "ml" | "spread" | "total" | "parlay" | "challenge" | string;
  selection?: string | null;
  line?: number | null;
  label?: string | null;
  lock?: boolean;
  odds: number;
  stake: number;
  payout: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled" | string;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
  wallet: "credits" | "league";
  leagueId?: string | null;
  leagueName?: string | null;
  friendName?: string | null;
  ownerUid?: string | null;
  ownerName?: string | null;
  placedAtMs?: number | null;
  settledAtMs?: number | null;
  legs?: BetBreakdownLeg[];
}

export default function BetBreakdownModal({
  item,
  onClose,
  onOpenGame,
  onReply,
  game,
}: {
  item: BetBreakdownItem | null;
  /** The live game document, when the board still has it: adds live score, kickoff and team info. */
  game?: Game | null;
  onClose: () => void;
  onOpenGame?: (gameId: string) => void;
  onReply?: (item: BetBreakdownItem) => void;
}) {
  const c = useColors();
  const fmt = useOddsFormat();

  if (!item) return null;

  const won = item.status === "won";
  const lost = item.status === "lost";
  const pending = item.status === "pending";
  const push = item.status === "push";
  const tone = won ? "positive" : lost ? "negative" : pending ? "accent" : "neutral";
  const accentColor = won ? c.positive : lost ? c.negative : pending ? c.primary : c.mutedForeground;

  const netProfit = won ? item.payout - item.stake : lost ? -item.stake : 0;
  const prob = impliedProbability(item.odds);

  const myScore =
    item.finalHomeScore != null && item.finalAwayScore != null
      ? item.side === "away"
        ? item.finalAwayScore
        : item.finalHomeScore
      : null;
  const theirScore =
    item.finalHomeScore != null && item.finalAwayScore != null
      ? item.side === "away"
        ? item.finalHomeScore
        : item.finalAwayScore
      : null;

  const marketLabel =
    item.market === "spread"
      ? `Point Spread${item.line != null ? ` (${item.line > 0 ? `+${item.line}` : item.line})` : ""}`
      : item.market === "total"
        ? `Game Total${item.line != null ? ` (O/U ${item.line})` : ""}`
        : item.market === "parlay"
          ? "Multi-Leg Parlay"
          : item.market === "challenge" || item.friendName
            ? `1v1 Challenge${item.friendName ? ` vs ${item.friendName}` : ""}`
            : "Moneyline";

  const single = !item.legs?.length && item.market !== "parlay" && item.market !== "challenge" && !item.friendName;
  const desc = single ? describeBet({ ...item, market: item.market ?? "ml", side: item.side ?? null }) : null;
  const typeTint = item.market === "spread" ? c.accent : item.market === "total" ? c.warning : item.teamColor || c.primary;

  // The two teams from the game document, the bet's team first.
  const mine: TeamSide | null = game ? (item.side === "away" ? game.awayTeam : game.homeTeam) : null;
  const theirs: TeamSide | null = game ? (item.side === "away" ? game.homeTeam : game.awayTeam) : null;
  const liveMine = game && game.status === "live" ? (item.side === "away" ? game.awayScore : game.homeScore) : null;
  const liveTheirs = game && game.status === "live" ? (item.side === "away" ? game.homeScore : game.awayScore) : null;

  const legs: BetBreakdownLeg[] = item.legs?.length
    ? item.legs
    : [
        {
          label: item.label || `${item.teamName} (${item.teamAbbr})`,
          matchup: `${item.teamAbbr} vs ${item.opponentAbbr}`,
          sport: item.sport,
          odds: item.odds,
          status: item.status,
          ownerName: item.ownerName ?? undefined,
        },
      ];

  const shareBreakdown = () => {
    void shareViewOrText({
      kind: "bet_ticket",
      id: item.id,
      message: `${item.label ?? item.teamName} (${formatOdds(item.odds, fmt)}) · Stake ${item.stake.toLocaleString()} → ${item.payout.toLocaleString()} (${item.status.toUpperCase()}) on On The House`,
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.scrim}>
        {Platform.OS !== "web" ? <BlurView intensity={34} tint={c.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} /> : null}
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.isDark ? "rgba(5, 9, 16, 0.46)" : c.overlay }]} onPress={onClose} accessibilityLabel="Close bet breakdown" />
        <GlassModalSurface id="bet_breakdown" glowColor={item.teamColor || accentColor} style={styles.sheet}>

          <View style={styles.header}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.pills}>
                <Pill
                  label={won ? "WON" : lost ? "LOST" : pending ? "OPEN" : push ? "PUSH" : "VOID"}
                  tone={tone}
                  icon={won ? "check-decagram" : lost ? "close-octagon-outline" : pending ? "clock-outline" : "minus-circle-outline"}
                />
                {item.sport ? <Pill label={item.sport} tone="neutral" /> : null}
                {item.lock ? <Pill label="LOCK 🔒" tone="accent" /> : null}
                <Pill
                  label={item.wallet === "league" ? item.leagueName ?? "League Tokens" : "Credits"}
                  tone={item.wallet === "league" ? "league" : "money"}
                  icon={item.wallet === "league" ? "trophy-outline" : "lightning-bolt"}
                />
              </View>
              <Text style={[styles.title, { color: c.foreground }]}>
                {item.label || item.teamName}
                {item.market === "parlay" ? null : <Text style={{ color: c.mutedForeground }}> vs {item.opponentAbbr}</Text>}
              </Text>
              {item.ownerName ? (
                <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                  Placed by {item.ownerName}
                </Text>
              ) : null}
            </View>
            <CloseButton onPress={onClose} label="Close Breakdown" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {/* Score Banner */}
            {myScore !== null && theirScore !== null ? (
              <View style={[styles.scoreCard, { backgroundColor: c.secondary, borderColor: c.border }]}>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreTeam, { color: c.foreground }]}>{item.teamAbbr}</Text>
                  <Text style={[styles.scoreNum, { color: myScore > theirScore ? c.positive : c.foreground }]}>{myScore}</Text>
                </View>
                <View style={styles.scoreCenter}>
                  <Text style={[styles.scoreFinal, { color: c.mutedForeground }]}>FINAL SCORE</Text>
                  <Text style={[styles.scoreVs, { color: c.subtleForeground }]}>—</Text>
                </View>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreTeam, { color: c.foreground }]}>{item.opponentAbbr}</Text>
                  <Text style={[styles.scoreNum, { color: theirScore > myScore ? c.foreground : c.mutedForeground }]}>{theirScore}</Text>
                </View>
              </View>
            ) : null}

            {/* Live score while the game is on */}
            {pending && liveMine !== null && liveTheirs !== null ? (
              <View style={[styles.scoreCard, { backgroundColor: c.alpha(c.live, 0.1), borderColor: c.alpha(c.live, 0.4) }]}>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreTeam, { color: c.foreground }]}>{item.teamAbbr}</Text>
                  <Text style={[styles.scoreNum, { color: c.foreground }]}>{liveMine}</Text>
                </View>
                <View style={styles.scoreCenter}>
                  <Text style={[styles.scoreFinal, { color: c.live }]}>● LIVE</Text>
                  <Text style={[styles.scoreVs, { color: c.mutedForeground }]}>{game?.clock ?? ""}</Text>
                </View>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreTeam, { color: c.foreground }]}>{item.opponentAbbr}</Text>
                  <Text style={[styles.scoreNum, { color: c.foreground }]}>{liveTheirs}</Text>
                </View>
              </View>
            ) : null}

            {/* What kind of bet this is and what has to happen for it to cash */}
            {desc ? (
              <View style={[styles.typeBox, { backgroundColor: c.alpha(typeTint, 0.1), borderColor: c.alpha(typeTint, 0.4) }]}>
                <View style={styles.typeHead}>
                  <View style={[styles.typeIcon, { backgroundColor: c.alpha(typeTint, 0.2) }]}>
                    <MaterialCommunityIcons name={desc.icon} size={18} color={typeTint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.typeLabel, { color: typeTint }]}>{desc.type.toUpperCase()}</Text>
                    <Text style={[styles.typePick, { color: c.foreground }]}>{desc.pick}</Text>
                  </View>
                </View>
                <Text style={[styles.typeNeeds, { color: c.foreground }]}>
                  {pending ? "To win: " : "Needed: "}
                  <Text style={{ fontFamily: "Inter_500Medium" }}>{desc.needs}</Text>
                </Text>
                <Text style={[styles.typeExplain, { color: c.mutedForeground }]}>{TYPE_EXPLAIN[item.market === "spread" ? "spread" : item.market === "total" ? "total" : "ml"]}</Text>
              </View>
            ) : null}

            {/* Financial Summary Tiles */}
            <View style={styles.tiles}>
              <StatTile label="Stake" hint={item.wallet === "league" ? "league tokens" : "credits"}>
                <Amount value={item.stake} currency={item.wallet} size="sm" tone="neutral" />
              </StatTile>
              <StatTile label="Odds" hint={`${formatPercent(prob)} implied`}>
                <Text style={[styles.oddsText, { color: c.foreground }]}>{formatOdds(item.odds, fmt)}</Text>
              </StatTile>
              <StatTile label={pending ? "To Return" : won ? "Net Profit" : "Outcome"}>
                <Amount
                  value={pending ? item.payout : netProfit}
                  currency={item.wallet}
                  size="sm"
                  signed={!pending}
                  tone={won ? "positive" : lost ? "negative" : "neutral"}
                />
              </StatTile>
            </View>

            {/* Detailed Ticket Breakdown */}
            <View style={[styles.detailBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>Ticket Details</Text>
              <DetailRow label="Bet Type" value={desc ? `${desc.type}${item.line != null ? ` (${item.market === "total" ? `O/U ${item.line}` : item.line > 0 ? `+${item.line}` : item.line})` : ""}` : marketLabel} />
              <DetailRow label="Selection" value={item.label || `${item.teamName} (${item.teamAbbr})`} />
              <DetailRow
                label="Price (Decimal / American)"
                value={`${formatOdds(item.odds, "decimal")} · ${formatOdds(item.odds, "american")}`}
              />
              <DetailRow label="Implied Probability" value={formatPercent(prob)} />
              <DetailRow label="Total Stake" value={`${item.stake.toLocaleString()} ${item.wallet === "league" ? "tokens" : "credits"}`} />
              <DetailRow
                label={pending ? "Potential Payout" : "Total Payout"}
                value={`${(won || pending ? item.payout : push ? item.stake : 0).toLocaleString()} ${item.wallet === "league" ? "tokens" : "credits"}`}
              />
              {item.placedAtMs ? (
                <DetailRow
                  label="Placed"
                  value={new Date(item.placedAtMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                />
              ) : null}
              {item.settledAtMs ? (
                <DetailRow
                  label="Settled"
                  value={new Date(item.settledAtMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                />
              ) : null}
            </View>

            {/* The matchup: kickoff, venue and both teams' form */}
            {game && mine && theirs ? (
              <View style={[styles.detailBox, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.sectionTitle, { color: c.foreground }]}>Matchup</Text>
                {game.status === "upcoming" ? (
                  <DetailRow label="Kickoff" value={`${game.startTimeLabel} · in ${untilKickoff(game.startsAt)}`} />
                ) : null}
                {game.venue ? <DetailRow label="Venue" value={[game.venue, game.city].filter(Boolean).join(", ")} /> : null}
                {game.broadcast ? <DetailRow label="Watch on" value={game.broadcast} /> : null}
                <TeamRow team={mine} yours />
                <TeamRow team={theirs} />
              </View>
            ) : null}

            {/* Legs Breakdown */}
            {legs.length > 1 || !desc ? (
            <View style={[styles.detailBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>
                {legs.length > 1 ? `Parlay Legs (${legs.length})` : "Leg Breakdown (1 Leg)"}
              </Text>
              {legs.map((leg, i) => {
                const legWon = leg.status === "won";
                const legLost = leg.status === "lost";
                return (
                  <View
                    key={i}
                    style={[
                      styles.legRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                    ]}
                  >
                    <View style={[styles.legBadge, { backgroundColor: c.secondary }]}>
                      <Text style={[styles.legNum, { color: c.foreground }]}>#{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.legTitle, { color: c.foreground }]}>{leg.label}</Text>
                      <Text style={[styles.legSub, { color: c.mutedForeground }]}>
                        {[leg.sport, leg.matchup, leg.ownerName ? `by ${leg.ownerName}` : null].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={[styles.legOdds, { color: c.foreground }]}>{formatOdds(leg.odds, fmt)}</Text>
                      <Pill
                        label={leg.status.toUpperCase()}
                        tone={legWon ? "positive" : legLost ? "negative" : "neutral"}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
            ) : null}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            {onReply ? (
              <Button
                label="Reply"
                icon="reply-outline"
                variant="secondary"
                onPress={() => {
                  const target = item;
                  onClose();
                  onReply(target);
                }}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                label="Share"
                icon="share-variant"
                variant="secondary"
                onPress={shareBreakdown}
                style={{ flex: 1 }}
              />
            )}
            {item.gameId && onOpenGame ? (
              <Button
                label="Matchup Details"
                icon="scoreboard-outline"
                onPress={() => {
                  const gId = item.gameId!;
                  onClose();
                  onOpenGame(gId);
                }}
                style={{ flex: 1.4 }}
              />
            ) : (
              <Button label="Done" onPress={onClose} style={{ flex: 1.2 }} />
            )}
          </View>
        </GlassModalSurface>
      </View>
    </Modal>
  );
}

const TYPE_EXPLAIN = {
  ml: "Moneyline: you're backing a team to win the game. The margin doesn't matter.",
  spread: "Point spread: the line is added to your team's final score. Your bet wins if the adjusted score beats the opponent's.",
  total: "Game total (over/under): it doesn't matter who wins, only how many points both teams score combined.",
} as const;

function TeamRow({ team, yours }: { team: TeamSide; yours?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.teamRow}>
      <View style={[styles.teamDot, { backgroundColor: team.color || c.mutedForeground }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={1}>
          {team.rank ? `#${team.rank} ` : ""}{team.name}{yours ? "  · your pick" : ""}
        </Text>
        <Text style={[styles.teamMeta, { color: c.mutedForeground }]} numberOfLines={1}>
          {[team.record, team.splitRecord, team.pointsFor != null && team.pointsAgainst != null ? `${team.pointsFor.toFixed(1)} for / ${team.pointsAgainst.toFixed(1)} against` : null].filter(Boolean).join(" · ") || "No record yet"}
        </Text>
      </View>
      {team.form?.length ? (
        <View style={styles.form}>
          {team.form.slice(0, 5).map((r, i) => (
            <View key={i} style={[styles.formDot, { backgroundColor: r === "W" ? c.positive : r === "L" ? c.negative : c.push }]}>
              <Text style={styles.formText}>{r}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: c.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "88%",
  },
  topStripe: { height: 5, width: "100%" },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  title: { fontSize: 20, fontFamily: "Inter_900Black", letterSpacing: -0.5, marginTop: 2 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium" },
  body: { paddingHorizontal: 18, paddingBottom: 16, gap: 12 },
  scoreCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  scoreCol: { alignItems: "center", gap: 2 },
  scoreTeam: { fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  scoreNum: { fontSize: 28, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  scoreCenter: { alignItems: "center", gap: 2 },
  scoreFinal: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  scoreVs: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tiles: { flexDirection: "row", gap: 8 },
  oddsText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  detailBox: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 2 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  detailValue: { fontSize: 12, fontFamily: "Inter_700Bold", flexShrink: 1, textAlign: "right" },
  legRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  legBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  legNum: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  legTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  legSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  legOdds: { fontSize: 13, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  typeBox: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  typeHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  typeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  typeLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  typePick: { fontSize: 18, fontFamily: "Inter_900Black", letterSpacing: -0.3 },
  typeNeeds: { fontSize: 13, fontFamily: "Inter_800ExtraBold", lineHeight: 18 },
  typeExplain: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4 },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  teamMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  form: { flexDirection: "row", gap: 3 },
  formDot: { width: 16, height: 16, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  formText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", color: "#FFFFFF" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
});

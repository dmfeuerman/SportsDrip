import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Amount, Button, CloseButton, Pill, StatTile } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatOdds, formatPercent, impliedProbability } from "@/lib/odds";
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
}: {
  item: BetBreakdownItem | null;
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
      message: `${item.label ?? item.teamName} (${formatOdds(item.odds, fmt)}) · Stake ${item.stake.toLocaleString()} → ${item.payout.toLocaleString()} (${item.status.toUpperCase()}) on SportDrip`,
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close bet breakdown" />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <View style={[styles.topStripe, { backgroundColor: item.teamColor || accentColor }]} />

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
                  icon={item.wallet === "league" ? "shield-star" : "lightning-bolt"}
                />
              </View>
              <Text style={[styles.title, { color: c.foreground }]}>
                {item.label || item.teamName} <Text style={{ color: c.mutedForeground }}>vs {item.opponentAbbr}</Text>
              </Text>
              {item.ownerName ? (
                <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                  Placed by {item.ownerName}
                </Text>
              ) : null}
            </View>
            <CloseButton onPress={onClose} label="Close breakdown" />
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
              <DetailRow label="Market" value={marketLabel} />
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

            {/* Legs Breakdown */}
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
        </View>
      </View>
    </Modal>
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
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "88%",
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
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
  scoreFinal: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
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
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
});

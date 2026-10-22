import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors, type Colors } from "@/hooks/useColors";
import { fairProbabilities, formatPercent, margin, toAmerican, untilKickoff } from "@/lib/odds";
import type { Game, Side, TeamSide } from "@/types/game";

export interface DetailBet {
  id: string;
  side: Side;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: string;
}

interface Props {
  game: Game | null;
  onClose: () => void;
  onBet: (game: Game, side: Side) => void;
  /** The user's bets on this fixture. */
  bets?: DetailBet[];
}

/**
 * Everything about one fixture, one tap from the board.
 *
 * The board card has to stay scannable, so it carries the six facts that
 * change a decision. This sheet carries the rest: both teams side by side,
 * their form and season scoring, the market with the vig made explicit, and
 * whatever the user already has on the game.
 *
 * The vig line is deliberate. A user comparing 1.85 and 2.05 has no way to
 * know the pair implies 105%; stating the margin is the honest version of
 * showing odds at all, and it costs one row.
 */
export default function GameDetailSheet({ game, onClose, onBet, bets = [] }: Props) {
  const c = useColors();
  if (!game) return null;

  const prob = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const vig = margin(game.homeTeam.odds, game.awayTeam.odds);
  const canBet = game.status === "upcoming";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: c.overlay }]} onPress={onClose} />

      <View style={[styles.sheet, { backgroundColor: c.elevated, borderColor: c.border }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={[styles.kicker, { color: c.subtleForeground }]}>
            {[game.sport, game.seasonLabel, game.venue].filter(Boolean).join("   ")}
          </Text>

          <View style={styles.matchup}>
            <TeamColumn team={game.awayTeam} score={game.awayScore} probability={prob.away} c={c} />
            <View style={styles.centre}>
              <Text style={[styles.at, { color: c.subtleForeground }]}>at</Text>
              <Text style={[styles.kickoff, { color: c.foreground }]}>
                {game.status === "live"
                  ? game.clock ?? "Live"
                  : game.status === "final"
                    ? "Final"
                    : game.startTimeLabel}
              </Text>
              {game.status === "upcoming" && (
                <Text style={[styles.kicker, { color: c.subtleForeground }]}>
                  {untilKickoff(game.startsAt)}
                </Text>
              )}
            </View>
            <TeamColumn team={game.homeTeam} score={game.homeScore} probability={prob.home} c={c} />
          </View>

          {game.situation || game.lastPlay ? (
            <View style={[styles.callout, { backgroundColor: c.secondary, borderColor: c.border }]}>
              <MaterialCommunityIcons name="broadcast" size={14} color={c.live} />
              <Text style={[styles.calloutText, { color: c.cardForeground }]}>
                {game.lastPlay ?? game.situation}
              </Text>
            </View>
          ) : null}

          <Section title="The market" c={c}>
            <Row
              label={game.awayTeam.abbreviation}
              value={`${game.awayTeam.odds.toFixed(2)}x   ${toAmerican(game.awayTeam.odds)}`}
              hint={`${formatPercent(prob.away, 1)} to win`}
              c={c}
            />
            <Row
              label={game.homeTeam.abbreviation}
              value={`${game.homeTeam.odds.toFixed(2)}x   ${toAmerican(game.homeTeam.odds)}`}
              hint={`${formatPercent(prob.home, 1)} to win`}
              c={c}
            />
            {game.line?.spread ? <Row label="Spread" value={game.line.spread} c={c} /> : null}
            {game.line?.overUnder ? (
              <Row label="Total" value={String(game.line.overUnder)} c={c} />
            ) : null}
            <Row
              label="Built-in edge"
              value={formatPercent(vig, 1)}
              hint="the house's cut, already in these odds"
              c={c}
            />
          </Section>

          <Section title="Season so far" c={c}>
            <Compare
              label="Record"
              away={game.awayTeam.record ?? "—"}
              home={game.homeTeam.record ?? "—"}
              c={c}
            />
            <Compare
              label="This venue"
              away={game.awayTeam.splitRecord ?? "—"}
              home={game.homeTeam.splitRecord ?? "—"}
              c={c}
            />
            <Compare
              label="Scored / game"
              away={fmt(game.awayTeam.pointsFor)}
              home={fmt(game.homeTeam.pointsFor)}
              c={c}
            />
            <Compare
              label="Allowed / game"
              away={fmt(game.awayTeam.pointsAgainst)}
              home={fmt(game.homeTeam.pointsAgainst)}
              c={c}
            />
          </Section>

          {bets.length > 0 && (
            <Section title={`Your bets (${bets.length})`} c={c}>
              {bets.map((b) => {
                const t = b.side === "home" ? game.homeTeam : game.awayTeam;
                return (
                  <Row
                    key={b.id}
                    label={`${b.stake.toLocaleString()} on ${t.abbreviation}`}
                    value={b.potentialPayout.toLocaleString()}
                    hint={`at ${b.odds.toFixed(2)}x · ${b.status}`}
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

        {canBet ? (
          <View style={[styles.actions, { borderTopColor: c.border }]}>
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
                  onPress={() => onBet(game, side)}
                >
                  <Text style={[styles.actionTeam, { color: c.foreground }]} numberOfLines={1}>
                    Back {t.abbreviation}
                  </Text>
                  <Text style={[styles.actionOdds, { color: c.mutedForeground }]}>
                    {t.odds.toFixed(2)}x
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={[styles.actions, { borderTopColor: c.border }]}>
            <Text style={[styles.closedNote, { color: c.mutedForeground }]}>
              {game.status === "live"
                ? "Betting closed once the game starts."
                : "This game is over. Results settle on their own."}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(1) : "—");

function TeamColumn({
  team,
  score,
  probability,
  c,
}: {
  team: TeamSide;
  score: number | null;
  probability: number;
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
        <Text style={[styles.bigProb, { color: c.mutedForeground }]}>{formatPercent(probability)}</Text>
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

function Compare({ label, away, home, c }: { label: string; away: string; home: string; c: Colors }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowValue, { color: c.foreground, width: 68 }]}>{away}</Text>
      <Text style={[styles.rowLabel, { color: c.subtleForeground, flex: 1, textAlign: "center" }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: c.foreground, width: 68, textAlign: "right" }]}>{home}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    paddingTop: 10,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
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

  actions: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1 },
  action: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 2 },
  actionTeam: { fontSize: 15, fontFamily: "Inter_700Bold" },
  actionOdds: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  closedNote: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});

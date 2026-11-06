import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { FormStrip, formLine, h2hTally, injuryTone, teamOf } from "@/components/insights";
import { useColors } from "@/hooks/useColors";
import { useGameInsights } from "@/hooks/useGameInsights";
import { fairProbabilities, formatPercent } from "@/lib/odds";
import { isPriced, type Game, type Side } from "@/types/game";

/**
 * The bet slip's "before you lock it in" panel: what you'd want to know about
 * the team you just picked, in three glanceable facts — record, last five,
 * head-to-head — with key players, injuries, the model's view and the
 * opponent's form one tap deeper. Collapsed by default so the slip keeps its
 * height on small phones.
 */
export default function TeamEdge({ game, side }: { game: Game; side: Side }) {
  const c = useColors();
  const { data, loading, error } = useGameInsights(game.id, game.status);
  const [open, setOpen] = useState(false);

  const other: Side = side === "home" ? "away" : "home";
  const t = teamOf(game, side);
  const o = teamOf(game, other);

  const results = data?.recent[side].length ? data.recent[side].map((g) => g.result) : (t.form ?? []);
  const oppResults = data?.recent[other].length ? data.recent[other].map((g) => g.result) : (o.form ?? []);
  const h2h = data?.headToHead.games ?? [];
  const tally = h2hTally(game, h2h);
  const leaders = data?.leaders[side] ?? [];
  const injuries = data?.injuries[side] ?? [];
  const market = isPriced(game) ? fairProbabilities(game.homeTeam.odds, game.awayTeam.odds)[side] : null;
  const model = data?.predictor ? data.predictor[side] : null;

  return (
    <Animated.View layout={LinearTransition.duration(200)} style={[styles.box, { backgroundColor: c.secondary, borderColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t.name} insights`}
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        style={styles.head}
      >
        <MaterialCommunityIcons name="chart-timeline-variant" size={15} color={c.accent} />
        <Text style={[styles.title, { color: c.foreground }]}>Before You Lock It In</Text>
        {loading && !data ? <ActivityIndicator size="small" color={c.mutedForeground} /> : null}
        <Text style={[styles.link, { color: c.accent }]}>{open ? "Show Less" : "Show More"}</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.accent} />
      </Pressable>

      <View style={styles.facts}>
        <Fact label="Record" hint={t.splitRecord ?? undefined}>
          <Text style={[styles.value, { color: c.foreground }]}>{t.record ?? "—"}</Text>
        </Fact>
        <Fact label="Last 5" hint={results.length ? formLine(results) : undefined}>
          {results.length ? <FormStrip results={results} size={14} /> : <Text style={[styles.value, { color: c.foreground }]}>—</Text>}
        </Fact>
        <Fact label={`vs ${o.abbreviation}`} hint={h2h.length ? `last ${h2h.length}` : undefined}>
          <Text style={[styles.value, { color: c.foreground }]}>
            {h2h.length ? `${tally[side]}-${tally[other]}${tally.draws ? `-${tally.draws}` : ""}` : "—"}
          </Text>
        </Fact>
      </View>

      {open ? (
        <Animated.View entering={FadeIn.duration(180)}>
          <ScrollView style={{ maxHeight: 210 }} nestedScrollEnabled showsVerticalScrollIndicator persistentScrollbar contentContainerStyle={styles.more}>
            {market !== null || model !== null ? (
              <Line icon="scale-balance" c={c}>
                {market !== null
                  ? `Margin removed, the market gives ${t.abbreviation} ${formatPercent(market)}${model !== null ? `; ESPN's model says ${formatPercent(model)}` : ""}.`
                  : `No line yet; ESPN's model gives ${t.abbreviation} ${formatPercent(model ?? 0)}.`}
              </Line>
            ) : null}
            {t.pointsFor != null && t.pointsAgainst != null ? (
              <Line icon="scoreboard-outline" c={c}>
                Scores {t.pointsFor.toFixed(1)} and allows {t.pointsAgainst.toFixed(1)} a game
                {o.pointsFor != null && o.pointsAgainst != null ? ` (${o.abbreviation}: ${o.pointsFor.toFixed(1)} / ${o.pointsAgainst.toFixed(1)})` : ""}.
              </Line>
            ) : null}
            {leaders.slice(0, 3).map((l, i) => (
              <Line key={i} icon={i === 0 ? "star-outline" : "account-outline"} c={c}>
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>{l.athlete}</Text> · {l.category} {l.value}
              </Line>
            ))}
            {injuries.length ? (
              <View style={styles.injuries}>
                <MaterialCommunityIcons name="medical-bag" size={14} color={c.mutedForeground} />
                <View style={{ flex: 1, gap: 4 }}>
                  {injuries.slice(0, 4).map((i, k) => (
                    <Text key={k} style={[styles.lineText, { color: c.mutedForeground }]} numberOfLines={1}>
                      <Text style={{ color: injuryTone(c, i.status), fontFamily: "Inter_700Bold" }}>{i.status}</Text> {i.athlete}
                      {i.detail ? ` (${i.detail})` : ""}
                    </Text>
                  ))}
                </View>
              </View>
            ) : data ? (
              <Line icon="medical-bag" c={c}>
                No injuries reported for {t.abbreviation}.
              </Line>
            ) : null}
            {oppResults.length ? (
              <View style={styles.opp}>
                <Text style={[styles.lineText, { color: c.mutedForeground }]}>{o.abbreviation} last 5</Text>
                <FormStrip results={oppResults} size={14} />
                <Text style={[styles.lineText, { color: c.mutedForeground }]}>{formLine(oppResults)}</Text>
              </View>
            ) : null}
            {!data && error ? (
              <Line icon="wifi-off" c={c}>
                Deeper stats aren't loading right now — the basics above are from the board.
              </Line>
            ) : null}
          </ScrollView>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: c.subtleForeground }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      {children}
      {hint ? (
        <Text style={[styles.factHint, { color: c.mutedForeground }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Line({ icon, children, c }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; children: React.ReactNode; c: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.line}>
      <MaterialCommunityIcons name={icon} size={14} color={c.mutedForeground} style={{ marginTop: 1 }} />
      <Text style={[styles.lineText, { color: c.mutedForeground, flex: 1 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  link: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  facts: { flexDirection: "row", gap: 8 },
  fact: { flex: 1, gap: 3 },
  factLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  factHint: { fontSize: 11, fontFamily: "Inter_500Medium" },
  value: { fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  more: { gap: 8, paddingTop: 2 },
  line: { flexDirection: "row", gap: 8 },
  lineText: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  injuries: { flexDirection: "row", gap: 8 },
  opp: { flexDirection: "row", alignItems: "center", gap: 8 },
});

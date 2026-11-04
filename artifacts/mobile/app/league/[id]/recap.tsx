import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Button, Card, EmptyState, Pill, ScreenHeader, useBottomPad } from "@/components/ui";
import { type LeagueReportCard } from "@/constants/leagueTypes";
import { useLeague, useLeagueDetail } from "@/context/LeagueContext";
import { useColors, type Colors } from "@/hooks/useColors";
import { shareViewOrText } from "@/lib/shareCard";

const CARD_META: Record<
  LeagueReportCard["kind"],
  { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; badge: string; tone: "positive" | "negative" | "accent" | "league" }
> = {
  biggest_hit: { icon: "trophy", badge: "BIGGEST HIT", tone: "positive" },
  bad_beat: { icon: "heart-broken", badge: "BAD BEAT OF THE WEEK", tone: "negative" },
  climber: { icon: "trending-up", badge: "BIGGEST CLIMBER", tone: "positive" },
  faller: { icon: "trending-down", badge: "BIGGEST FALLER", tone: "negative" },
  best_tail: { icon: "account-multiple-plus", badge: "CROWD PLEASER", tone: "league" },
  coldest_streak: { icon: "snowflake", badge: "ICE COLD", tone: "accent" },
};

export default function LeagueRecapScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const params = useLocalSearchParams<{ id: string; week?: string }>();
  const { getLeague } = useLeague();
  const league = getLeague(params.id);
  const detail = useLeagueDetail(league);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(params.week ?? null);

  if (!league) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScreenHeader back title="League Report" />
        <View style={{ padding: 16 }}>
          <EmptyState
            icon="newspaper-variant-outline"
            title="League not found"
            body="You may have left this league or it's still loading."
            action="Back to leagues"
            onAction={() => router.navigate("/(tabs)/leagues")}
          />
        </View>
      </View>
    );
  }

  const reports = detail.reports;
  const activeReport = (selectedWeek ? reports.find((r) => r.week === selectedWeek) : reports[0]) ?? reports[0];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title="Tuesday League Report"
        subtitle={activeReport ? `${league.name} · Week ${activeReport.week}` : league.name}
      >
        {reports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {reports.map((r) => {
              const on = r.week === activeReport?.week;
              return (
                <Pressable
                  key={r.week}
                  accessibilityRole="button"
                  onPress={() => setSelectedWeek(r.week)}
                  style={[
                    styles.weekChip,
                    {
                      backgroundColor: on ? c.leagueSoft : c.secondary,
                      borderColor: on ? c.league : c.border,
                    },
                  ]}
                >
                  <Text style={[styles.weekChipText, { color: on ? c.foreground : c.mutedForeground }]}>
                    {r.week}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </ScreenHeader>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {!activeReport || activeReport.cards.length === 0 ? (
          <EmptyState
            icon="newspaper-variant-outline"
            title="No weekly report yet"
            body="Every Tuesday morning, SportDrip compiles the biggest hits, worst bad beats, climbers, fallers, and streaks from your league."
          />
        ) : (
          <>
            <Card tone="league" style={{ gap: 6 }}>
              <Text style={[styles.introTitle, { color: c.foreground }]}>
                Week {activeReport.week} Wrapped
              </Text>
              <Text style={[styles.introSub, { color: c.mutedForeground }]}>
                Tap Share on any story card to drop it in the group chat.
              </Text>
            </Card>
            {activeReport.cards.map((card, i) => (
              <StoryCard key={`${card.kind}_${i}`} card={card} leagueName={league.name} week={activeReport.week} c={c} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StoryCard({
  card,
  leagueName,
  week,
  c,
}: {
  card: LeagueReportCard;
  leagueName: string;
  week: string;
  c: Colors;
}) {
  const cardRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const meta = CARD_META[card.kind] ?? { icon: "star", badge: "HIGHLIGHT", tone: "league" as const };
  const tint =
    meta.tone === "positive"
      ? c.positive
      : meta.tone === "negative"
        ? c.negative
        : meta.tone === "accent"
          ? c.accent
          : c.league;
  const statLabel = card.value >= 0 ? `+${card.value.toLocaleString()}` : card.value.toLocaleString();

  return (
    <View ref={cardRef} collapsable={false} style={[styles.storyCard, { backgroundColor: c.card, borderColor: c.alpha(tint, 0.55) }]}>
      <LinearGradient
        colors={[c.alpha(tint, 0.22), c.alpha(tint, 0.04), "transparent"] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.storyTop}>
        <Pill label={meta.badge} tone={meta.tone} icon={meta.icon} />
        <Text style={[styles.storyLeague, { color: c.subtleForeground }]} numberOfLines={1}>
          {leagueName} · {week}
        </Text>
      </View>

      <View style={styles.storyMain}>
        <View style={[styles.storyIconWrap, { backgroundColor: c.alpha(tint, 0.16), borderColor: c.alpha(tint, 0.45) }]}>
          <MaterialCommunityIcons name={meta.icon} size={28} color={tint} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.storyTitle, { color: c.foreground }]}>{card.headline || card.title}</Text>
          <Text style={[styles.storySubtitle, { color: c.mutedForeground }]}>{card.detail}</Text>
        </View>
      </View>

      <View style={[styles.storyFooter, { borderTopColor: c.border }]}>
        <Text style={[styles.storyStat, { color: tint }]}>{statLabel}</Text>
        <Button
          size="sm"
          variant="secondary"
          icon="share-variant"
          label="Share card"
          onPress={() => {
            void shareViewOrText({
              viewRef: cardRef,
              kind: "league_report",
              id: `${week}_${card.kind}`,
              message: `${meta.badge}: ${card.headline || card.title} (${statLabel}) — ${card.detail} in ${leagueName} on SportDrip`,
            });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 16, gap: 14 },
  weekChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  weekChipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  introTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  introSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  storyCard: { borderRadius: 20, borderWidth: 1.5, padding: 16, gap: 14, overflow: "hidden" },
  storyTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  storyLeague: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  storyMain: { flexDirection: "row", alignItems: "center", gap: 14 },
  storyIconWrap: { width: 54, height: 54, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  storyTitle: { fontSize: 18, fontFamily: "Inter_900Black", letterSpacing: -0.4 },
  storySubtitle: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  storyFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  storyStat: { fontSize: 18, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
});

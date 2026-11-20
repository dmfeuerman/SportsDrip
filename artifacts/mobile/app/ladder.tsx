import BannerSlot from "@/components/ads/BannerSlot";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, LoadingState, Pill, ScreenHeader, useBottomPad } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import { usePublicProfiles } from "@/hooks/usePublicProfiles";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { getDb } from "@/lib/firebase";

export const TIER_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond" };

/** This week's ladder cohort, framed as "players like you". Experimental (ladder_v1). */
export default function LadderScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const ready = useDeferredMount();
  const { profile } = useApp();
  const arm = useExperiment(EXPERIMENTS.ladder, profile?.uid);
  const cohortId = profile?.ladder?.cohortId ?? null;
  const [cohort, setCohort] = useState<{ tier: string; members: string[] } | null>(null);
  const [cohortLoading, setCohortLoading] = useState(!!cohortId);
  useEffect(() => {
    const db = getDb();
    if (!db || !cohortId) {
      setCohortLoading(false);
      return;
    }
    setCohortLoading(true);
    return onSnapshot(
      doc(db, "ladderCohorts", cohortId),
      (s) => {
        setCohort(s.exists() ? (s.data() as { tier: string; members: string[] }) : null);
        setCohortLoading(false);
      },
      () => setCohortLoading(false)
    );
  }, [cohortId]);
  const ids = useMemo(() => cohort?.members ?? [], [cohort]);
  const profiles = usePublicProfiles(ids);

  const tier = TIER_LABEL[profile?.ladder?.tier ?? "bronze"] ?? "Bronze";
  if (arm === CONTROL || !cohort) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ObsidianBackdrop />
        <ScreenHeader title="Ladder" back />
        {!ready || (arm !== CONTROL && cohortLoading) ? (
          <LoadingState label="Loading your ladder…" />
        ) : (
          <EmptyState icon="stairs-up" title="Ladder opens Monday" body="Play this week to get placed with players like you." />
        )}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ObsidianBackdrop />
      <ScreenHeader title={`${tier} Ladder`} subtitle="Players like you, this week" back />
      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
          <LiquidGlass variant="hero" radius={22} borderColor={c.alpha(c.league, 0.45)} contentStyle={styles.hero}>
            <GlassDomeSheen id="ladder_hero" glowColor={c.league} intensity={0.28} />
            <View style={[styles.heroBadge, { backgroundColor: c.alpha(c.league, 0.16), borderColor: c.alpha(c.league, 0.4) }]}>
              <MaterialCommunityIcons name="stairs-up" size={22} color={c.league} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.kicker, { color: c.league }]}>{tier.toUpperCase()} COHORT</Text>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                Top 3 move up, bottom 3 move down on Sunday night. Score = correct picks.
              </Text>
            </View>
          </LiquidGlass>
          {ids.map((u, idx) => (
            <Card key={u} style={styles.row} tone={u === profile?.uid ? "league" : undefined}>
              <Text style={[styles.rank, { color: c.subtleForeground }]}>#{idx + 1}</Text>
              <Text style={[styles.name, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                {u === profile?.uid ? "You" : profiles[u]?.displayName ?? "Player"}
              </Text>
              {u === profile?.uid ? <Pill label="You" tone="league" /> : null}
            </Card>
          ))}
          <BannerSlot />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  heroBadge: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { fontSize: 13, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"], width: 26 },
  name: theme.type.bodyStrong,
  sub: theme.type.caption,
});

import BannerSlot from "@/components/ads/BannerSlot";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, Pill, ScreenHeader, useBottomPad } from "@/components/ui";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { usePublicProfiles } from "@/hooks/usePublicProfiles";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { getDb } from "@/lib/firebase";

export const TIER_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond" };

/** This week's ladder cohort, framed as "players like you". Experimental (ladder_v1). */
export default function LadderScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const { profile } = useApp();
  const arm = useExperiment(EXPERIMENTS.ladder, profile?.uid);
  const cohortId = profile?.ladder?.cohortId ?? null;
  const [cohort, setCohort] = useState<{ tier: string; members: string[] } | null>(null);
  useEffect(() => {
    const db = getDb();
    if (!db || !cohortId) return;
    return onSnapshot(doc(db, "ladderCohorts", cohortId), (s) => setCohort(s.exists() ? (s.data() as { tier: string; members: string[] }) : null), () => {});
  }, [cohortId]);
  const ids = useMemo(() => cohort?.members ?? [], [cohort]);
  const profiles = usePublicProfiles(ids);

  const tier = TIER_LABEL[profile?.ladder?.tier ?? "bronze"] ?? "Bronze";
  if (arm === CONTROL || !cohort) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Ladder" back />
        <EmptyState icon="stairs-up" title="Ladder opens Monday" body="Play this week to get placed with players like you." />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={`${tier} ladder`} subtitle="Players like you, this week" back />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: bottom }}>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>Top 3 move up, bottom 3 move down on Sunday night. Score = correct picks.</Text>
        {ids.map((u) => (
          <Card key={u} style={styles.row}>
            <Text style={[styles.name, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
              {u === profile?.uid ? "You" : profiles[u]?.displayName ?? "Player"}
            </Text>
            {u === profile?.uid ? <Pill label="You" tone="league" /> : null}
          </Card>
        ))}
        <BannerSlot />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: theme.type.bodyStrong,
  sub: theme.type.caption,
});

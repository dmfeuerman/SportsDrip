import BannerSlot from "@/components/ads/BannerSlot";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionChip, Card, EmptyState, LoadingState, Pill, ScreenHeader, useBottomPad } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import * as api from "@/lib/api";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

interface Tier {
  xp: number;
  reward: { kind: "item" | "background" | "move"; id: string } | { kind: "credits"; amount: number };
}
interface Season {
  id: string;
  startsAt: number;
  endsAt: number;
  tiers: Tier[];
}

const rewardLabel = (r: Tier["reward"]) => (r.kind === "credits" ? `${r.amount.toLocaleString()} credits` : `${r.kind}: ${r.id.replace(/_/g, " ")}`);

/** Season pass, free track. Season XP comes from quests and Daily Picks; lifetime levels are separate. */
export default function SeasonScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const ready = useDeferredMount();
  const { profile } = useApp();
  const [season, setSeason] = useState<Season | null | "none">(null);
  const [claimed, setClaimed] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const enabled = useExperiment(EXPERIMENTS.seasonPass, profile?.uid) !== CONTROL;

  useEffect(() => {
    const db = getDb();
    if (!db) return;
    const now = Date.now();
    getDocs(query(collection(db, "seasons"), where("endsAt", ">", now), orderBy("endsAt"), limit(3)))
      .then((snap) => {
        const s = snap.docs.map((d) => ({ ...(d.data() as Omit<Season, "id">), id: d.id })).find((x) => x.startsAt <= now);
        setSeason(s ?? "none");
      })
      .catch(() => setSeason("none"));
  }, []);

  useEffect(() => {
    const db = getDb();
    if (!db || !profile?.uid || !season || season === "none") return;
    getDocs(query(collection(db, "users", profile.uid, "seasonClaims"), where("seasonId", "==", season.id)))
      .then((snap) => {
        const out: Record<number, boolean> = {};
        snap.forEach((d) => {
          out[d.get("tier") as number] = true;
        });
        setClaimed(out);
      })
      .catch(() => {});
  }, [profile?.uid, season]);

  if (season === "none" || !enabled) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ObsidianBackdrop />
        <ScreenHeader title="Season Pass" back />
        <EmptyState icon="flag-outline" title="No Season Running" body="Keep doing quests and Daily Free Bets. The next season starts soon." />
      </View>
    );
  }
  if (!season || !ready) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ObsidianBackdrop />
        <ScreenHeader title="Season Pass" back />
        <LoadingState label="Loading season…" />
      </View>
    );
  }

  const xp = profile?.seasonXp?.[season.id] ?? 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ObsidianBackdrop />
      <ScreenHeader title="Season Pass" back />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
        <LiquidGlass variant="hero" radius={24} borderColor={c.alpha(c.primary, 0.48)} contentStyle={styles.hero}>
          <GlassDomeSheen id="season_hero" glowColor={c.primary} intensity={0.3} />
          <View style={[styles.heroBadge, { backgroundColor: c.alpha(c.primary, 0.16), borderColor: c.alpha(c.primary, 0.4) }]}>
            <MaterialCommunityIcons name="flag-checkered" size={24} color={c.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.kicker, { color: c.primary }]}>FREE TRACK</Text>
            <Text style={[styles.heroValue, { color: c.foreground }]}>{xp.toLocaleString()} Season XP</Text>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Ends {new Date(season.endsAt).toLocaleDateString()}</Text>
          </View>
        </LiquidGlass>
        {season.tiers.map((t, i) => {
          const reached = xp >= t.xp;
          return (
            <Card key={i} style={styles.row} tone={reached && !claimed[i] ? "positive" : "default"}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.title, { color: c.foreground }]}>Tier {i + 1}</Text>
                <Text style={[styles.sub, { color: c.mutedForeground }]}>
                  {t.xp.toLocaleString()} XP · {rewardLabel(t.reward)}
                </Text>
              </View>
              {claimed[i] ? (
                <Pill label="Claimed" tone="positive" />
              ) : reached ? (
                <ActionChip
                  label="Claim"
                  chevron={false}
                  disabled={busy === i}
                  onPress={async () => {
                    setBusy(i);
                    setClaimed((m) => ({ ...m, [i]: true }));
                    haptic.success();
                    try {
                      await api.claimSeasonTier({ seasonId: season.id, tier: i });
                    } catch {
                      setClaimed((m) => ({ ...m, [i]: false }));
                      haptic.error();
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              ) : (
                <Pill label="Locked" icon="lock" />
              )}
            </Card>
          );
        })}
        <BannerSlot />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  heroBadge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.4 },
  heroValue: { fontSize: 22, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: theme.type.bodyStrong,
  sub: theme.type.caption,
});

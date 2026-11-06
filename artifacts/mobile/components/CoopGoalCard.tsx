import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/ui";
import theme from "@/constants/theme";
import type { League } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { CONTROL, EXPERIMENTS, useExperiment } from "@/lib/experiments";
import { getDb } from "@/lib/firebase";
import { weekKey } from "@/lib/markets";

interface Coop {
  target: number;
  progress: number;
  contributions?: Record<string, number>;
  completedAt?: number;
}

/** Weekly co-op goal with per-member contribution. Experimental (coop_goals_v1, league unit). */
export default function CoopGoalCard({ league, uid }: { league: League; uid: string | null }) {
  const c = useColors();
  const arm = useExperiment(EXPERIMENTS.coopGoals, uid, league.id);
  const [coop, setCoop] = useState<Coop | null>(null);
  const week = weekKey();
  useEffect(() => {
    const db = getDb();
    if (!db || arm === CONTROL) return;
    return onSnapshot(doc(db, "leagues", league.id, "coop", week), (s) => setCoop(s.exists() ? (s.data() as Coop) : null), () => {});
  }, [league.id, week, arm]);
  if (arm === CONTROL) return null;
  const target = coop?.target ?? Math.min(80, Math.max(20, 5 * league.memberIds.length));
  const progress = Math.min(target, coop?.progress ?? 0);
  const rows = Object.entries(coop?.contributions ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Card style={{ gap: 8 }} accessibilityLabel={`League goal: ${progress} of ${target} correct picks`}>
      <Text style={[styles.title, { color: c.foreground }]}>{coop?.completedAt ? "🤝 League goal hit!" : "League goal this week"}</Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {progress}/{target} correct picks together
      </Text>
      <View style={[styles.track, { backgroundColor: c.secondary }]}>
        {rows.map(([u, n]) => (
          <View key={u} style={{ width: `${(n / target) * 100}%`, backgroundColor: u === uid ? c.league : c.alpha(c.league, 0.45) }} />
        ))}
      </View>
      {rows.slice(0, 5).map(([u, n]) => (
        <Text key={u} style={[styles.sub, { color: c.mutedForeground }]}>
          {u === uid ? "You" : league.members[u]?.displayName ?? "Player"} · {n}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: theme.type.bodyStrong,
  sub: theme.type.caption,
  track: { height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row" },
});

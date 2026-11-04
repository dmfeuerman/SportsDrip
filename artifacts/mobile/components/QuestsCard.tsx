import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ActionChip, Card } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { haptic } from "@/lib/motion";

const ICON = { endowed: "check-circle-outline", effort: "run-fast", social: "calendar-check", skill: "target" } as const;

/** This week's quests. Progress is computed on the server; rewards are XP. */
export default function QuestsCard() {
  const c = useColors();
  const focused = useIsFocused();
  const [quests, setQuests] = useState<api.WeeklyQuest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (DEMO) return;
    api.getWeeklyQuests({}).then((r) => setQuests(r.quests)).catch(() => {});
  }, []);
  useEffect(() => {
    if (focused) load();
  }, [focused, load]);

  if (!quests?.length) return null;
  const done = quests.filter((q) => q.progress >= q.target).length;

  return (
    <Card style={{ gap: 8 }} accessibilityLabel="Weekly quests">
      <View style={styles.head}>
        <MaterialCommunityIcons name="flag-checkered" size={18} color={c.accent} />
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>This week</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {done}/{quests.length} done
        </Text>
      </View>
      {quests.map((q) => {
        const complete = q.progress >= q.target;
        return (
          <View key={q.id} style={styles.row}>
            <MaterialCommunityIcons name={complete ? "check-circle" : ICON[q.kind]} size={18} color={complete ? c.positive : c.mutedForeground} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.qt, { color: c.foreground }]}>{q.title}</Text>
              <View style={[styles.track, { backgroundColor: c.secondary }]}>
                <View style={[styles.fill, { width: `${(q.progress / q.target) * 100}%`, backgroundColor: complete ? c.positive : c.accent }]} />
              </View>
            </View>
            {q.claimed ? (
              <Text style={[styles.sub, { color: c.subtleForeground }]}>+{q.xp} XP</Text>
            ) : complete ? (
              <ActionChip
                label={`+${q.xp} XP`}
                chevron={false}
                disabled={busy === q.id}
                onPress={async () => {
                  setBusy(q.id);
                  try {
                    await api.claimQuest({ questId: q.id });
                    haptic.success();
                    load();
                  } catch {
                    haptic.error();
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            ) : (
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                {q.progress}/{q.target}
              </Text>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  sub: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  qt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  track: { height: 5, borderRadius: 3, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3 },
});

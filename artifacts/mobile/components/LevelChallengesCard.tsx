import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { ActionChip, Card } from "@/components/ui";
import { recordXpReason } from "@/components/XpGainPopup";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { DEMO } from "@/lib/demo";
import { haptic } from "@/lib/motion";

/**
 * This level's XP challenges — optional bonus XP, never a gate. A claimed one
 * stays, greyed out, until the next level deals a new set.
 */
export default function LevelChallengesCard() {
  const c = useColors();
  const focused = useIsFocused();
  const { progress: lvl } = useApp();
  const [list, setList] = useState<api.LevelChallenge[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (DEMO) return;
    api
      .getLevelChallenges({})
      .then((r) => {
        setList(r.challenges);
        setFailed(false);
      })
      .catch((e) => {
        console.warn("[challenges] getLevelChallenges failed", e);
        setFailed(true);
      });
  }, []);
  const loadedAt = useRef(0);
  useEffect(() => {
    if (!focused || Date.now() - loadedAt.current < 20_000) return;
    loadedAt.current = Date.now();
    load();
  }, [focused, load]);
  // A new level deals a new set.
  const seenLevel = useRef(lvl.level);
  useEffect(() => {
    if (seenLevel.current === lvl.level) return;
    seenLevel.current = lvl.level;
    load();
  }, [lvl.level, load]);

  if (!list?.length) {
    if (DEMO) return null;
    return (
      <Card style={{ gap: 8 }} accessibilityLabel="XP challenges">
        <View style={styles.head}>
          <MaterialCommunityIcons name="flag-checkered" size={18} color={c.accent} />
          <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>XP Challenges</Text>
        </View>
        {failed ? (
          <Pressable accessibilityRole="button" onPress={load}>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Couldn't load your challenges. Tap to retry.</Text>
          </Pressable>
        ) : (
          <Text style={[styles.sub, { color: c.mutedForeground }]}>{list ? "Nothing to do here — keep earning XP to reach the next level." : "Loading…"}</Text>
        )}
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="XP challenges">
      <View style={styles.head}>
        <MaterialCommunityIcons name="flag-checkered" size={18} color={c.accent} />
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>XP Challenges</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {list.filter((q) => q.claimed).length}/{list.length} done
        </Text>
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {lvl.maxed ? "Max level." : `Bonus XP toward level ${lvl.level + 1} — knock out any you like.`}
      </Text>
      {list.map((q) => {
        const complete = q.progress >= q.target;
        if (q.claimed) {
          return (
            <View key={q.id} accessibilityLabel={`${q.title}, done`} style={[styles.row, { opacity: 0.4 }]}>
              <MaterialCommunityIcons name="check-circle" size={18} color={c.mutedForeground} />
              <Text style={[styles.qt, { color: c.mutedForeground, flex: 1, textDecorationLine: "line-through" }]}>{q.title}</Text>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>Done</Text>
            </View>
          );
        }
        return (
          <Pressable
            key={q.id}
            accessibilityRole="button"
            accessibilityLabel={`${q.title}, ${q.progress} of ${q.target}`}
            disabled={complete || !q.to}
            onPress={() => q.to && router.push(q.to as never)}
            style={styles.row}
          >
            <MaterialCommunityIcons
              name={complete ? "check-circle" : q.explore ? "compass-outline" : "target"}
              size={18}
              color={complete ? c.positive : c.mutedForeground}
            />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.qt, { color: c.foreground }]}>{q.title}</Text>
              <View style={[styles.track, { backgroundColor: c.secondary }]}>
                <View style={[styles.fill, { width: `${(q.progress / q.target) * 100}%`, backgroundColor: complete ? c.positive : c.accent }]} />
              </View>
            </View>
            {complete ? (
              <ActionChip
                label={`Claim +${q.xp} XP`}
                chevron={false}
                disabled={busy === q.id}
                onPress={async () => {
                  // Instant: the claimed challenge greys out now; the server grants the XP behind it (undone if refused).
                  const before = list;
                  setBusy(q.id);
                  setList((cur) => cur?.map((x) => (x.id === q.id ? { ...x, claimed: true } : x)) ?? cur);
                  haptic.success();
                  try {
                    recordXpReason(`Challenge: ${q.title}`, "flag-checkered");
                    await api.claimLevelChallenge({ id: q.id });
                    trackEvent("quest_claimed", { quest_id: q.id });
                    load();
                  } catch {
                    setList(before);
                    haptic.error();
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            ) : (
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                {q.progress}/{q.target} · +{q.xp} XP
              </Text>
            )}
          </Pressable>
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

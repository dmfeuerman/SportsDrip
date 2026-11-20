import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useLevelRewards } from "@/hooks/useLevelRewards";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";

/**
 * This level's XP challenges — optional bonus XP, auto-claimed server-side
 * (no manual Claim button). Styled with a radial Liquid Glass dome sheen.
 */
const rank = (q: api.LevelChallenge) => (q.claimed ? 2 : q.progress >= q.target ? 0 : 1);

function DomeSheen() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="xpDome" cx="50%" cy="0%" rx="68%" ry="58%">
            <Stop offset="0" stopColor="#93C5FD" stopOpacity="0.24" />
            <Stop offset="0.55" stopColor="#60A5FA" stopOpacity="0.06" />
            <Stop offset="1" stopColor="#0A0F1A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#xpDome)" />
      </Svg>
      <LinearGradient
        colors={["transparent", "rgba(255,255,255,0.45)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topSheen}
      />
    </View>
  );
}

export default function LevelChallengesCard() {
  const c = useColors();
  const focused = useIsFocused();
  const { progress: lvl } = useApp();
  const { nextAfter } = useLevelRewards();
  const [list, setList] = useState<api.LevelChallenge[] | null>(null);
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

  const seenXp = useRef(lvl.xp);
  useEffect(() => {
    if (seenXp.current === lvl.xp) return;
    seenXp.current = lvl.xp;
    load();
  }, [lvl.xp, load]);

  const rawNext = nextAfter(lvl.level);
  const nextUnlock = rawNext && !rawNext.includes("undefined") ? rawNext : null;
  const xpLeft = Math.max(0, lvl.needed - lvl.into);
  const lvlPct = Math.max(0.04, Math.min(1, lvl.pct ?? 0));

  if (!list?.length) {
    if (DEMO) return null;
    return (
      <View
        style={[
          styles.glassCard,
          {
            backgroundColor: c.isDark ? "#0D1422" : c.card,
            borderColor: c.isDark ? "rgba(255,255,255,0.20)" : c.border,
          },
        ]}
        accessibilityLabel="XP challenges"
      >
        {c.isDark ? <DomeSheen /> : null}
        <Text style={[styles.kicker, { color: c.subtleForeground }]}>XP CHALLENGES</Text>
        {failed ? (
          <Pressable accessibilityRole="button" onPress={load}>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Couldn't load your challenges. Tap to retry.</Text>
          </Pressable>
        ) : (
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {list ? "Nothing to do here — keep earning XP to reach the next level." : "Loading…"}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.glassCard,
        {
          backgroundColor: c.isDark ? "#0D1422" : c.card,
          borderColor: c.isDark ? "rgba(255,255,255,0.20)" : c.border,
        },
      ]}
      accessibilityLabel="XP challenges"
    >
      {c.isDark ? <DomeSheen /> : null}

      <Pressable accessibilityRole="button" onPress={() => router.push("/levels" as never)} style={{ gap: 10 }}>
        <View style={styles.topRow}>
          <Text style={[styles.kicker, { color: c.subtleForeground }]}>XP CHALLENGES</Text>
          <Text style={[styles.doneCount, { color: c.mutedForeground }]}>
            {list.filter((q) => q.claimed).length}/{list.length}
          </Text>
        </View>
        <View style={styles.levelLine}>
          <Text style={[styles.levelHead, { color: c.foreground }]}>
            {lvl.maxed ? `Level ${lvl.level}` : `Level ${lvl.level} → ${lvl.level + 1}`}
          </Text>
          {!lvl.maxed ? (
            <Text style={[styles.levelSub, { color: c.mutedForeground }]} numberOfLines={1}>
              · {xpLeft.toLocaleString()} XP{nextUnlock ? ` · ${nextUnlock}` : ""}
            </Text>
          ) : null}
        </View>
        <View style={[styles.track, { backgroundColor: c.isDark ? "rgba(255,255,255,0.11)" : c.secondary }]}>
          <LinearGradient
            colors={["#7DD3FC", "#34D399"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fill, { width: `${Math.round(lvlPct * 100)}%` }]}
          />
        </View>
      </Pressable>

      <View style={[styles.divider, { backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : c.border }]} />

      <View style={{ gap: 16 }}>
        {[...list]
          .sort((a, b) => rank(a) - rank(b) || b.progress / b.target - a.progress / a.target)
          .map((q) => {
            const complete = q.progress >= q.target;
            const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.target)) * 100));
            if (q.claimed) {
              return (
                <View key={q.id} accessibilityLabel={`${q.title}, completed`} style={[styles.row, { opacity: 0.72 }]}>
                  <View style={styles.rowTop}>
                    <View style={styles.rowTitleWrap}>
                      <MaterialCommunityIcons name="check-circle" size={16} color="#34D399" />
                      <Text style={[styles.qt, { color: c.foreground }]} numberOfLines={1}>
                        {q.title}
                      </Text>
                    </View>
                    <Text style={styles.completedLabel}>Completed</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: c.isDark ? "rgba(255,255,255,0.09)" : c.secondary }]}>
                    <View style={[styles.fill, { width: "100%", backgroundColor: "#34D399" }]} />
                  </View>
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
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.qt, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                    {q.title}
                  </Text>
                  <Text style={[styles.progressNum, { color: complete ? "#34D399" : c.mutedForeground }]}>
                    {complete ? "Completed" : `(${q.progress}/${q.target})`}
                  </Text>
                </View>
                <View style={[styles.track, { backgroundColor: c.isDark ? "rgba(255,255,255,0.09)" : c.secondary }]}>
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: complete ? "#34D399" : "#93C5FD" }]} />
                </View>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glassCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    overflow: "hidden",
  },
  topSheen: { position: "absolute", top: 0, left: 20, right: 20, height: 1.5 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.2 },
  doneCount: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  levelLine: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  levelHead: { fontSize: 17, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  levelSub: { fontSize: 14, fontFamily: "Inter_500Medium", flexShrink: 1 },
  sub: { fontSize: 13, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  row: { gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  qt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  progressNum: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  completedLabel: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#34D399" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});

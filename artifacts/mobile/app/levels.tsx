import { useExitBreakpoint } from "@/context/AdsContext";
import BannerSlot from "@/components/ads/BannerSlot";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import { Pressable } from "@/components/fx/Tap";
import LevelBar, { LevelBadge, levelTier } from "@/components/LevelBar";
import { replayLevelUp } from "@/components/LevelUpHost";
import { ScreenHeader, SectionHeader, useBottomPad } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { levelUpCredits, totalXpForLevel } from "@/constants/progression";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import { useLevelRewards, type LevelUnlock } from "@/hooks/useLevelRewards";
import { haptic } from "@/lib/motion";
import * as api from "@/lib/api";
import LevelChallengesCard from "@/components/LevelChallengesCard";

/**
 * Levels: where you are, how XP is earned, and the road ahead — what every
 * level pays and unlocks. Tap your medallion to replay the level-up.
 */
export default function LevelsScreen() {
  React.useEffect(() => api.reportChallengeAction("levelsViewed"), []);
  useExitBreakpoint("levels_exit");
  const c = useColors();
  const bottom = useBottomPad(false);
  const ready = useDeferredMount();
  const { progress } = useApp();
  const { rows, nextAfter } = useLevelRewards();
  const tier = levelTier(progress.level);
  const toNext = progress.maxed ? 0 : progress.needed - progress.into;
  const next = nextAfter(progress.level);

  // Leaving Levels (back button, swipe, Android back) always lands on Home,
  // wherever it was opened from.
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState(false);
  const allowLeave = usePreventRemove(!leaving, ({ data }) => {
    setLeaving(true);
    allowLeave();
    const type = (data.action as { type?: string }).type;
    if (type === "GO_BACK" || type === "POP") {
      router.dismissTo("/(tabs)");
      router.navigate("/(tabs)");
    } else navigation.dispatch(data.action as never);
  });

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ObsidianBackdrop />
      <ScreenHeader back title="Levels" subtitle={`${progress.xp.toLocaleString()} XP lifetime`} />
      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
          <LiquidGlass variant="hero" radius={26} borderColor={c.alpha(tier.glow, 0.52)} contentStyle={styles.hero}>
            <AvatarBackdrop id="galaxy" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.28)" }]} />
            <GlassDomeSheen id="levels_hero" glowColor={tier.glow} intensity={0.34} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Level ${progress.level}. Replay the level-up`}
              onPress={() => {
                haptic.light();
                replayLevelUp(progress.level);
              }}
              disabled={progress.level < 2}
            >
              <LevelBadge level={progress.level} size={92} glow />
            </Pressable>
            <Text style={styles.heroTitle}>Level {progress.level}</Text>
            <Text style={[styles.heroRank, { color: tier.glow }]}>{tier.name.toUpperCase()}</Text>
            <Text style={styles.heroSub}>
              {progress.maxed ? "Max level. Legend." : `${toNext.toLocaleString()} XP to level ${progress.level + 1}`}
            </Text>
            {!progress.maxed ? (
              <Text style={[styles.heroBonus, { color: "#FFD56A" }]}>
                <MaterialCommunityIcons name="cash-multiple" size={13} color="#FFD56A" /> Level {progress.level + 1} pays +{levelUpCredits(progress.level + 1).toLocaleString()} credits
              </Text>
            ) : null}
            <LevelBar progress={progress} nextReward={next} style={{ alignSelf: "stretch", marginTop: 6 }} />
          </LiquidGlass>

          <SectionHeader title="Earn XP: This Level's Challenges" />
          <LevelChallengesCard />

          <SectionHeader title="Level Road" />
          {rows.map((r) => {
            const reached = progress.level >= r.level;
            const isNext = r.level === progress.level + 1;
            return (
              <LiquidGlass
                key={r.level}
                variant="card"
                radius={18}
                tintColor={isNext ? c.alpha(c.primary, c.isDark ? 0.14 : 0.09) : undefined}
                borderColor={isNext ? c.alpha(c.primary, 0.65) : undefined}
                borderWidth={isNext ? 1.5 : 1}
                style={!reached && !isNext ? { opacity: 0.72 } : undefined}
                contentStyle={styles.road}
              >
                <View style={{ opacity: reached || isNext ? 1 : 0.55 }}>
                  <LevelBadge level={r.level} size={38} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.roadHead}>
                    <Text style={[styles.roadCredits, { color: c.foreground }]}>
                      <MaterialCommunityIcons name="lightning-bolt" size={13} color={c.primary} /> +{r.credits.toLocaleString()}
                    </Text>
                    <Text style={[styles.roadXp, { color: c.subtleForeground }]}>{totalXpForLevel(r.level).toLocaleString()} XP</Text>
                  </View>
                  {r.unlocks.length ? (
                    <View style={styles.chips}>
                      {r.unlocks.map((u) => (
                        <UnlockChip key={`${u.kind}:${u.id}`} u={u} />
                      ))}
                    </View>
                  ) : null}
                </View>
                {reached ? (
                  <MaterialCommunityIcons name="check-circle" size={20} color={c.primary} />
                ) : isNext ? (
                  <Text style={[styles.nextTag, { color: c.primaryForeground, backgroundColor: c.primary }]}>NEXT</Text>
                ) : (
                  <MaterialCommunityIcons name="lock-outline" size={18} color={c.subtleForeground} />
                )}
              </LiquidGlass>
            );
          })}
          <BannerSlot />
        </ScrollView>
      )}
    </View>
  );
}

function UnlockChip({ u }: { u: LevelUnlock }) {
  const c = useColors();
  const col = c.rarity(u.rarity);
  return (
    <View style={[styles.chip, { borderColor: c.alpha(col, 0.55), backgroundColor: c.alpha(col, 0.14) }]}>
      <MaterialCommunityIcons name={u.kind === "background" ? "image-filter-hdr" : u.mode === "reward" ? "gift" : "lock-open-variant-outline"} size={12} color={col} />
      <Text style={[styles.chipText, { color: c.foreground }]} numberOfLines={1}>
        {u.name}
      </Text>
      <Text style={[styles.chipTag, { color: col }]}>{u.mode === "reward" ? "FREE" : "SHOP"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  hero: { overflow: "hidden", alignItems: "center", padding: 18, paddingTop: 22, gap: 2 },
  heroTitle: { color: "#FFFFFF", fontSize: 30, fontFamily: "Inter_900Black", letterSpacing: -1, marginTop: 8 },
  heroRank: { fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 3 },
  heroSub: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  heroBonus: { fontSize: 12, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  road: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  roadHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  roadCredits: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  roadXp: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, maxWidth: "100%" },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  chipTag: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.6 },
  nextTag: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import { Pressable } from "@/components/fx/Tap";
import LevelBar, { LevelBadge, levelTier } from "@/components/LevelBar";
import { replayLevelUp } from "@/components/LevelUpHost";
import { Card, ScreenHeader, SectionHeader, useBottomPad } from "@/components/ui";
import { REFERRAL, totalXpForLevel, XP } from "@/constants/progression";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useLevelRewards, type LevelUnlock } from "@/hooks/useLevelRewards";
import { haptic } from "@/lib/motion";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const EARN: Array<{ icon: Icon; label: string; xp: string; to?: string }> = [
  { icon: "trophy-outline", label: "Win a bet", xp: `${XP.betWin}+ XP`, to: "/(tabs)/games" },
  { icon: "sword-cross", label: "Win a friend challenge", xp: `${XP.challengeWin} XP`, to: "/challenges" },
  { icon: "shield-star-outline", label: "Win a league bet", xp: `${XP.leagueBetWin} XP`, to: "/(tabs)/leagues" },
  { icon: "podium-gold", label: "Finish in the money in a league", xp: `${XP.leaguePayout} XP` },
  { icon: "shopping-outline", label: "Buy from the Drip Shop", xp: `1 XP / ${XP.purchasePer} credits`, to: "/shop" },
  { icon: "gift-outline", label: "Open a prize box", xp: `${XP.prizeBox} XP`, to: "/prizes" },
  { icon: "account-plus-outline", label: "Add a friend", xp: `${XP.newFriend} XP`, to: "/(tabs)/friends" },
  { icon: "account-heart-outline", label: "Invite a friend with your code", xp: `${XP.referrer} XP`, to: "/(tabs)/friends" },
];

/**
 * Levels: where you are, how XP is earned, and the road ahead — what every
 * level pays and unlocks. Tap your medallion to replay the level-up.
 */
export default function LevelsScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const { progress } = useApp();
  const { rows, nextAfter } = useLevelRewards();
  const tier = levelTier(progress.level);
  const toNext = progress.maxed ? 0 : progress.needed - progress.into;
  const next = nextAfter(progress.level);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Levels" subtitle={`${progress.xp.toLocaleString()} XP lifetime`} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { borderColor: c.alpha(tier.glow, 0.4) }]}>
          <AvatarBackdrop id="galaxy" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.25)" }]} />
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
          <LevelBar progress={progress} nextReward={next} style={{ alignSelf: "stretch", marginTop: 6 }} />
        </View>

        <SectionHeader title="Earn XP" />
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {EARN.map((e, i) => (
            <Pressable
              key={e.label}
              accessibilityRole={e.to ? "button" : undefined}
              disabled={!e.to}
              onPress={() => e.to && router.push(e.to as never)}
              style={({ pressed }) => [
                styles.earnRow,
                i < EARN.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
                pressed && { backgroundColor: c.secondary },
              ]}
            >
              <View style={[styles.earnIcon, { backgroundColor: c.alpha(c.primary, 0.13) }]}>
                <MaterialCommunityIcons name={e.icon} size={18} color={c.primary} />
              </View>
              <Text style={[styles.earnLabel, { color: c.foreground }]}>{e.label}</Text>
              <Text style={[styles.earnXp, { color: c.primary }]}>{e.xp}</Text>
            </Pressable>
          ))}
        </Card>
        <Text style={[styles.note, { color: c.subtleForeground }]}>
          Every level pays a credit bonus. Friends who join with your invite code get {REFERRAL.newUserCredits.toLocaleString()} credits, and you get{" "}
          {REFERRAL.referrerCredits.toLocaleString()}.
        </Text>

        <SectionHeader title="Level road" />
        {rows.map((r) => {
          const reached = progress.level >= r.level;
          const isNext = r.level === progress.level + 1;
          return (
            <View
              key={r.level}
              style={[
                styles.road,
                { backgroundColor: c.card, borderColor: isNext ? c.alpha(c.primary, 0.6) : c.border },
                isNext && { borderWidth: 1.5 },
                !reached && !isNext && { opacity: 0.72 },
              ]}
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
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function UnlockChip({ u }: { u: LevelUnlock }) {
  const c = useColors();
  const col = c.rarity(u.rarity);
  return (
    <View style={[styles.chip, { borderColor: c.alpha(col, 0.55), backgroundColor: c.alpha(col, 0.1) }]}>
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
  hero: { borderRadius: 24, borderWidth: 1, overflow: "hidden", alignItems: "center", padding: 18, paddingTop: 22, gap: 2 },
  heroTitle: { color: "#FFFFFF", fontSize: 30, fontFamily: "Inter_900Black", letterSpacing: -1, marginTop: 8 },
  heroRank: { fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 3 },
  heroSub: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  earnIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  earnLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  earnXp: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  note: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, marginTop: -4 },
  road: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  roadHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  roadCredits: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  roadXp: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, maxWidth: "100%" },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  chipTag: { fontSize: 9, fontFamily: "Inter_900Black", letterSpacing: 0.6 },
  nextTag: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import { Pressable } from "@/components/fx/Tap";
import { useColors } from "@/hooks/useColors";
import type { StoreBackground } from "@/hooks/useBackgrounds";

/**
 * A background in the Drip Shop: the scene itself as the thumbnail, then
 * price / level lock / owned, and one action (buy, use, in use).
 */
function BackgroundCard({
  bg,
  owned,
  inUse,
  level,
  canAfford,
  busy,
  onBuy,
  onUse,
  onPreview,
}: {
  bg: StoreBackground;
  owned: boolean;
  inUse: boolean;
  level: number;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  onUse: () => void;
  onPreview: () => void;
}) {
  const c = useColors();
  const col = c.rarity(bg.rarity);
  // Hard gate: can't be bought until this level. Reward: free at this level, buyable now.
  const lock = owned ? null : bg.levelRequired && bg.levelRequired > level ? bg.levelRequired : null;
  const reward = owned || !bg.levelReward ? null : bg.levelReward;
  const buyable = !owned && !lock && bg.price > 0;
  const label = inUse ? "In Use" : owned ? "Use" : lock ? `Lv ${lock}` : buyable ? `Buy ${bg.price.toLocaleString()}` : reward ? `Lv ${reward}` : "Locked";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${bg.name}, ${bg.rarity}${inUse ? ", in use" : owned ? ", owned" : lock ? `, unlocks at level ${lock}` : `, ${bg.price} credits${reward ? `, or free at level ${reward}` : ""}`}`}
      onPress={onPreview}
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: inUse ? c.primary : c.border, borderWidth: inUse ? 1.5 : 1, opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={styles.thumb}>
        <AvatarBackdrop id={bg.id} />
        {lock ? (
          <View style={styles.lockVeil}>
            <MaterialCommunityIcons name="lock" size={22} color="#FFFFFF" />
            <Text style={styles.lockText}>{`LEVEL ${lock}`}</Text>
          </View>
        ) : reward ? (
          <View style={[styles.rewardTag, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
            <MaterialCommunityIcons name="star-four-points" size={11} color="#FFFFFF" />
            <Text style={styles.rewardText}>{`FREE AT LV ${reward}`}</Text>
          </View>
        ) : null}
        <View style={[styles.rarity, { backgroundColor: "rgba(0,0,0,0.55)", borderColor: col }]}>
          <Text style={[styles.rarityText, { color: col }]}>{bg.rarity.toUpperCase()}</Text>
        </View>
        {inUse ? (
          <View style={[styles.on, { backgroundColor: c.primary }]}>
            <Text style={[styles.onText, { color: c.primaryForeground }]}>ON</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
          {bg.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={inUse ? "In use" : owned ? `Use ${bg.name}` : lock ? `Locked until level ${lock}` : `Buy ${bg.name} for ${bg.price} credits`}
          disabled={busy || inUse || !!lock || (!owned && (!buyable || !canAfford))}
          onPress={owned ? onUse : onBuy}
          hitSlop={4}
          style={({ pressed }) => [
            styles.action,
            owned && !inUse
              ? { backgroundColor: c.primary, borderColor: c.primary }
              : inUse || lock
                ? { backgroundColor: c.secondary, borderColor: c.border }
                : { backgroundColor: c.alpha(c.primary, 0.13), borderColor: c.primary },
            { opacity: busy ? 0.5 : !owned && !lock && !canAfford ? 0.55 : pressed ? 0.8 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={c.primary} />
          ) : (
            <View style={styles.actionRow}>
              {buyable ? <MaterialCommunityIcons name="lightning-bolt" size={13} color={c.primary} /> : null}
              {lock ? <MaterialCommunityIcons name="lock" size={12} color={c.mutedForeground} /> : null}
              <Text
                style={[
                  styles.actionText,
                  { color: owned && !inUse ? c.primaryForeground : inUse || lock ? c.mutedForeground : c.primary },
                ]}
              >
                {label}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

export default memo(BackgroundCard);

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: 16, overflow: "hidden" },
  thumb: { height: 150, overflow: "hidden" },
  lockVeil: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", gap: 4 },
  rewardTag: { position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  rewardText: { color: "#FFFFFF", fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.6 },
  lockText: { color: "#FFFFFF", fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 1 },
  rarity: { position: "absolute", left: 8, top: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  rarityText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  on: { position: "absolute", right: 8, top: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  onText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  info: { padding: 10, gap: 8 },
  name: { fontSize: 14, fontFamily: "Inter_700Bold" },
  action: { borderRadius: 10, borderWidth: 1, paddingVertical: 7, alignItems: "center" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import ItemIcon from "@/components/avatar/ItemIcon";
import { RARITY_COLORS, type CatalogItem } from "@/types/catalog";
import { useColors } from "@/hooks/useColors";

interface Props {
  item: CatalogItem;
  owned: boolean;
  equipped: boolean;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  onToggleEquip: () => void;
  onPreview: () => void;
}

/**
 * Now renders a `CatalogItem` from Firestore rather than a hardcoded
 * `ClothingItem` (AUDIT A4), and surfaces rarity, which the old card had no
 * concept of (§13).
 *
 * `busy` disables the button while the purchase callable is in flight — the UI
 * half of the rapid-click protection from §17.
 */
function ClothingCard({
  item,
  owned,
  equipped,
  canAfford,
  busy,
  onBuy,
  onToggleEquip,
  onPreview,
}: Props) {
  const colors = useColors();
  const rarity = RARITY_COLORS[item.rarity];

  const label = busy ? "" : equipped ? "Remove" : owned ? "Equip" : canAfford ? "Buy" : "Can't afford";
  const disabled = busy || (!owned && !canAfford);

  return (
    <Pressable
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: equipped ? colors.primary : colors.border,
          borderWidth: equipped ? 1.5 : 1,
        },
      ]}
      onPress={onPreview}
    >
      {equipped && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>ON</Text>
        </View>
      )}

      <View style={[styles.swatch, { backgroundColor: colors.secondary }]}>
        <ItemIcon item={item} size={64} />
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={[styles.rarity, { backgroundColor: rarity + "22", borderColor: rarity }]}>
            <Text style={[styles.rarityText, { color: rarity }]}>
              {item.rarity.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.description}
        </Text>

        <View style={styles.bottom}>
          {owned ? (
            <View style={[styles.owned, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.ownedText, { color: colors.mutedForeground }]}>OWNED</Text>
            </View>
          ) : (
            <View style={styles.priceRow}>
              <MaterialCommunityIcons name="lightning-bolt" size={13} color={colors.primary} />
              <Text style={[styles.price, { color: canAfford ? colors.primary : colors.mutedForeground }]}>
                {item.price.toLocaleString()}
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: equipped ? colors.secondary : owned ? colors.primary : colors.primary + "22",
                borderColor: equipped ? colors.border : owned ? "transparent" : colors.primary,
                opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
            onPress={owned ? onToggleEquip : onBuy}
            disabled={disabled}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.actionText,
                  {
                    color: equipped
                      ? colors.mutedForeground
                      : owned
                        ? colors.primaryForeground
                        : colors.primary,
                  },
                ]}
              >
                {label}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

export default memo(ClothingCard);

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  badge: { position: "absolute", top: 8, left: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, zIndex: 1 },
  badgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  swatch: { width: 80, alignItems: "center", justifyContent: "center" },
  info: { flex: 1, padding: 12, gap: 4, justifyContent: "space-between" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rarity: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  rarityText: { fontSize: 8, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  price: { fontSize: 15, fontFamily: "Inter_700Bold" },
  owned: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ownedText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  action: { minWidth: 78, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

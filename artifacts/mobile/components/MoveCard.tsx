import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useColors } from "@/hooks/useColors";
import type { StoreMove } from "@/hooks/useMoves";

interface Props {
  move: StoreMove;
  owned: boolean;
  /** On the dance button. */
  equipped: boolean;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  onToggleEquip: () => void;
  onPreview: () => void;
}

/** A dance move in the Drip Shop, laid out like ClothingCard. */
function MoveCard({ move, owned, equipped, canAfford, busy, onBuy, onToggleEquip, onPreview }: Props) {
  const c = useColors();
  const rarity = c.rarity(move.rarity);
  const label = busy ? "" : equipped ? "Remove" : owned ? "Equip" : canAfford ? "Buy" : "Can't afford";
  const disabled = busy || (!owned && !canAfford);

  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.card, borderColor: equipped ? c.primary : c.border, borderWidth: equipped ? 1.5 : 1 }]}
      onPress={onPreview}
      accessibilityRole="button"
      accessibilityLabel={`${move.name}. ${move.description}. Preview`}
    >
      {equipped && (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={[styles.badgeText, { color: c.primaryForeground }]}>ON</Text>
        </View>
      )}
      <View style={[styles.swatch, { backgroundColor: c.secondary }]}>
        <View style={[styles.icon, { backgroundColor: c.alpha(rarity, 0.16), borderColor: c.alpha(rarity, 0.5) }]}>
          <MaterialCommunityIcons name={move.icon as never} size={26} color={rarity} />
        </View>
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {move.name}
          </Text>
          <View style={[styles.rarity, { backgroundColor: c.alpha(rarity, 0.14), borderColor: rarity }]}>
            <Text style={[styles.rarityText, { color: rarity }]}>{move.rarity.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={[styles.desc, { color: c.mutedForeground }]} numberOfLines={1}>
          {move.description}
        </Text>
        <View style={styles.bottom}>
          {owned ? (
            <View style={[styles.owned, { backgroundColor: c.secondary }]}>
              <Text style={[styles.ownedText, { color: c.mutedForeground }]}>{move.free ? "FREE" : "OWNED"}</Text>
            </View>
          ) : (
            <View style={styles.priceRow}>
              <MaterialCommunityIcons name="lightning-bolt" size={13} color={c.primary} />
              <Text style={[styles.price, { color: canAfford ? c.primary : c.mutedForeground }]}>{move.price.toLocaleString()}</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: equipped ? c.secondary : owned ? c.primary : c.alpha(c.primary, 0.13),
                borderColor: equipped ? c.border : owned ? "transparent" : c.primary,
                opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
            onPress={owned ? onToggleEquip : onBuy}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={equipped ? `Take ${move.name} off your dance button` : owned ? `Put ${move.name} on your dance button` : `Buy ${move.name}`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Text style={[styles.actionText, { color: equipped ? c.mutedForeground : owned ? c.primaryForeground : c.primary }]}>{label}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

export default memo(MoveCard);

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  badge: { position: "absolute", top: 8, left: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, zIndex: 1 },
  badgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  swatch: { width: 80, alignItems: "center", justifyContent: "center" },
  icon: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import ItemIcon from "@/components/avatar/ItemIcon";
import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { CatalogItem } from "@/types/catalog";

/** Top of the Drip Shop until it's owned: the free basics, one press into the cart. */
export default function StarterKitCard({ items, inCart, onAdd }: { items: CatalogItem[]; inCart: boolean; onAdd: () => void }) {
  const c = useColors();
  const total = items.reduce((n, i) => n + i.price, 0);
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.alpha(c.primary, 0.6) }]}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="gift-outline" size={18} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground }]}>Starter Kit</Text>
        <View style={[styles.free, { backgroundColor: c.alpha(c.primary, 0.16) }]}>
          <Text style={[styles.freeText, { color: c.primary }]}>{total ? `${total.toLocaleString()} CREDITS` : "FREE"}</Text>
        </View>
      </View>
      <View style={styles.items}>
        {items.map((i) => (
          <View key={i.id} style={styles.item}>
            <View style={[styles.art, { backgroundColor: c.secondary }]}>
              <ItemIcon item={i} size={48} />
            </View>
            <Text style={[styles.name, { color: c.mutedForeground }]} numberOfLines={1}>
              {i.name}
            </Text>
          </View>
        ))}
      </View>
      <Button
        label={inCart ? "In your cart" : "Add starter kit to cart"}
        icon={inCart ? "cart-check" : "cart-plus"}
        variant={inCart ? "secondary" : "primary"}
        disabled={inCart}
        onPress={onAdd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, padding: 14, gap: 12, marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  free: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  freeText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  items: { flexDirection: "row", gap: 10 },
  item: { flex: 1, alignItems: "center", gap: 6 },
  art: { width: "100%", aspectRatio: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

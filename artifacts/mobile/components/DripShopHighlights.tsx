import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import ItemIcon from "@/components/avatar/ItemIcon";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import { RARITY_COLORS, type CatalogItem } from "@/types/catalog";

function leftLabel(until: number, now: number): string {
  const ms = Math.max(0, until - now);
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.ceil(ms / 60_000))}m left`;
}

function Row({
  title,
  icon,
  items,
  owned,
  onPress,
  showTimer,
}: {
  title: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  items: CatalogItem[];
  owned: Set<string>;
  onPress: (i: CatalogItem) => void;
  showTimer?: boolean;
}) {
  const c = useColors();
  const now = useNow(60_000);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.head}>
        <MaterialCommunityIcons name={icon} size={16} color={showTimer ? c.warning : c.accent} />
        <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {items.map((i) => (
          <Pressable
            key={i.id}
            onPress={() => onPress(i)}
            accessibilityLabel={`${i.name}, ${i.price} credits`}
            style={[styles.tile, { backgroundColor: c.card, borderColor: RARITY_COLORS[i.rarity] ?? c.border }]}
          >
            <ItemIcon item={i} size={48} />
            <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
              {i.name}
            </Text>
            <Text style={[styles.meta, { color: owned.has(i.id) ? c.positive : c.mutedForeground }]} numberOfLines={1}>
              {owned.has(i.id) ? "Owned" : i.price.toLocaleString()}
            </Text>
            {showTimer && i.availableUntil ? (
              <Text style={[styles.meta, { color: c.warning }]}>{leftLabel(i.availableUntil, now)}</Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** "Featured" and "Leaving soon" strips above the Drip Shop grid. */
export default function DripShopHighlights({
  featured,
  leavingSoon,
  owned,
  onPress,
}: {
  featured: CatalogItem[];
  leavingSoon: CatalogItem[];
  owned: Set<string>;
  onPress: (i: CatalogItem) => void;
}) {
  if (featured.length === 0 && leavingSoon.length === 0) return null;
  return (
    <View style={{ gap: 14, marginBottom: 14 }}>
      <Row title="Featured" icon="star-four-points" items={featured} owned={owned} onPress={onPress} />
      <Row title="Leaving soon" icon="timer-sand" items={leavingSoon} owned={owned} onPress={onPress} showTimer />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 15, fontWeight: "700" },
  tile: { width: 108, borderWidth: 1.5, borderRadius: 14, padding: 10, alignItems: "center", gap: 4 },
  name: { fontSize: 12, fontWeight: "600" },
  meta: { fontSize: 11 },
});

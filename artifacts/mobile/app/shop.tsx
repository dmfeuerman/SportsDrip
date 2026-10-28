import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import { SLOT_FOCUS } from "@/lib/avatar3d/spec";
import ClothingCard from "@/components/ClothingCard";
import TokenBalance from "@/components/TokenBalance";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { BackButton, CloseButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { Slot } from "@/lib/api";
import { RARITY_COLORS, SLOT_LABELS, SLOT_ORDER, type CatalogItem } from "@/types/catalog";

const ALL = "ALL";

/**
 * Store rewritten against the database-driven catalog.
 *
 * Previously this imported a hardcoded 15-item array, so shipping a new hat
 * meant a code change and an app release (AUDIT A4, requirement §14). It now
 * subscribes to `catalog/*`.
 *
 * Preview (§18) shows the item on the user's actual character with their real
 * appearance and the rest of their current outfit, not a generic mannequin.
 */
export default function ShopScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { balance, profile, inventory, purchaseItem, equip, error, clearError } = useApp();
  const { items, byId, loading, error: catalogError } = useCatalog();

  const [slot, setSlot] = useState<Slot | typeof ALL>(ALL);
  const [preview, setPreview] = useState<CatalogItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 32 : insets.bottom + 24;

  const owned = useMemo(() => new Set(inventory), [inventory]);
  const equipped = profile?.equipped ?? {};
  const avatar = profile?.avatar ?? DEFAULT_AVATAR;

  const filtered = useMemo(
    () => (slot === ALL ? items : items.filter((i) => i.slot === slot)),
    [items, slot]
  );

  const handleBuy = useCallback(
    async (item: CatalogItem) => {
      setBusyId(item.id);
      const ok = await purchaseItem(item.id);
      setBusyId(null);
      if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [purchaseItem]
  );

  const handleToggleEquip = useCallback(
    async (item: CatalogItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setBusyId(item.id);
      await equip(item.slot, equipped[item.slot] === item.id ? null : item.id);
      setBusyId(null);
    },
    [equip, equipped]
  );

  // What the avatar looks like with the previewed item on. Purely local — no
  // write happens until the user actually buys or equips.
  const previewEquipped = useMemo(
    () => (preview ? { ...equipped, [preview.slot]: preview.id } : equipped),
    [preview, equipped]
  );

  const slotTabs: Array<Slot | typeof ALL> = [ALL, ...SLOT_ORDER];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <BackButton />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Drip Shop</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {owned.size} {owned.size === 1 ? "item" : "items"} owned
            </Text>
          </View>
          <TokenBalance tokens={balance} />
        </View>

        <FlatList
          horizontal
          data={slotTabs}
          keyExtractor={(x) => x}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabList}
          renderItem={({ item }) => {
            const active = slot === item;
            return (
              <Pressable
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? colors.primary : colors.secondary,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSlot(item)}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {item === ALL ? "All" : SLOT_LABELS[item]}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {(error || catalogError) && (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onPress={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error ?? catalogError}</Text>
        </Pressable>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <ClothingCard
              item={item}
              owned={owned.has(item.id)}
              equipped={equipped[item.slot] === item.id}
              canAfford={balance >= item.price}
              busy={busyId === item.id}
              onBuy={() => handleBuy(item)}
              onToggleEquip={() => handleToggleEquip(item)}
              onPreview={() => setPreview(item)}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="hanger" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing here yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                New drops land in this category soon.
              </Text>
            </View>
          }
        />
      )}

      {/* Preview sheet (§18) */}
      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.overlay} onPress={() => setPreview(null)} />
        {preview && (
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            <View style={[styles.previewStage, { backgroundColor: colors.secondary }]}>
              <AvatarDisplay
                avatar={avatar}
                equipped={previewEquipped}
                catalog={byId}
                size="lg"
                focus={SLOT_FOCUS[preview.slot]}
              />
            </View>

            <View style={styles.previewHead}>
              <Text style={[styles.previewName, { color: colors.foreground }]}>{preview.name}</Text>
              <View
                style={[
                  styles.rarity,
                  {
                    backgroundColor: RARITY_COLORS[preview.rarity] + "22",
                    borderColor: RARITY_COLORS[preview.rarity],
                  },
                ]}
              >
                <Text style={[styles.rarityText, { color: RARITY_COLORS[preview.rarity] }]}>
                  {preview.rarity.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={[styles.previewDesc, { color: colors.mutedForeground }]}>
              {preview.description}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.previewBtn,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    busyId === preview.id || (!owned.has(preview.id) && balance < preview.price)
                      ? 0.45
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
              disabled={busyId === preview.id || (!owned.has(preview.id) && balance < preview.price)}
              onPress={async () => {
                if (owned.has(preview.id)) await handleToggleEquip(preview);
                else await handleBuy(preview);
                setPreview(null);
              }}
            >
              {busyId === preview.id ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.previewBtnText, { color: colors.primaryForeground }]}>
                  {owned.has(preview.id)
                    ? equipped[preview.slot] === preview.id
                      ? "Take it off"
                      : "Wear it"
                    : `Buy for ${preview.price.toLocaleString()}`}
                </Text>
              )}
            </Pressable>
            <CloseButton onPress={() => setPreview(null)} style={styles.previewClose} />
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingBottom: 12, gap: 10 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  tabList: { paddingHorizontal: 16, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16 },
  empty: { alignItems: "center", gap: 8, padding: 32, borderRadius: 16, borderWidth: 1, marginTop: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingTop: 14,
    gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 6 },
  previewClose: { position: "absolute", top: 12, right: 14 },
  previewStage: { borderRadius: 18, height: 300, overflow: "hidden" },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewName: { flex: 1, fontSize: 19, fontFamily: "Inter_700Bold" },
  rarity: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  rarityText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  previewDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: -6 },
  previewBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", marginTop: 4 },
  previewBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import ItemIcon from "@/components/avatar/ItemIcon";
import TokenBalance from "@/components/TokenBalance";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { SLOT_ICONS, SLOT_LABELS, SLOT_ORDER } from "@/types/catalog";
import type { Slot } from "@/types/avatar";

/**
 * Locker: your character, live, with what it's wearing. All editing happens
 * in the character creator (/customize), which commits a whole look at once.
 */
export default function LockerScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { profile, balance, inventory, error, clearError, bets } = useApp();
  const { byId } = useCatalog();
  const { signOut } = useAuth();

  const equipped = profile?.equipped ?? {};
  const owned = useMemo(
    () => inventory.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i),
    [inventory, byId]
  );
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b) => b.status === "won").length;
  const open = (category?: Slot | "body") =>
    router.push(category ? { pathname: "/customize", params: { category } } : "/customize");

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 24 : insets.top) + 12, borderBottomColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            Locker
          </Text>
          <Text style={[styles.handle, { color: c.mutedForeground }]} numberOfLines={1}>
            {profile?.displayName ?? "Player"}
            {profile?.username ? ` · @${profile.username}` : ""}
          </Text>
        </View>
        <TokenBalance tokens={balance} />
        <Pressable
          style={[styles.iconBtn, { backgroundColor: c.secondary, borderColor: c.border }]}
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <MaterialCommunityIcons name="logout" size={15} color={c.mutedForeground} />
        </Pressable>
      </View>

      <ErrorBanner message={error} onDismiss={clearError} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 84 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.stage, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.floor, { backgroundColor: c.secondary }]} />
          <View style={styles.stageInner}>
            <AvatarDisplay avatar={profile?.avatar} equipped={equipped} catalog={byId} size="lg" />
          </View>
          <View style={[styles.stageBar, { borderTopColor: c.border }]}>
            <Text style={[styles.stageHint, { color: c.mutedForeground }]}>Drag to turn · zoom to inspect</Text>
            <Button label="Customize" icon="tshirt-crew-outline" size="sm" onPress={() => open()} />
          </View>
        </View>

        <View style={styles.quickRow}>
          <Card onPress={() => router.push("/shop")} style={styles.quickCard} accessibilityLabel="Drip Shop">
            <MaterialCommunityIcons name="shopping-outline" size={20} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>Drip Shop</Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Preview, buy, wear</Text>
          </Card>
          <Card onPress={() => router.push("/prizes")} style={styles.quickCard} accessibilityLabel="Prize boxes">
            <MaterialCommunityIcons name="gift-outline" size={20} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>Prize boxes</Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Free credits</Text>
          </Card>
          <Card style={styles.quickCard}>
            <MaterialCommunityIcons name="chart-line" size={20} color={c.accent} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>
              {wins}–{settled.length - wins}
            </Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
              {settled.length ? `${Math.round((wins / settled.length) * 100)}% hit rate` : "No results yet"}
            </Text>
          </Card>
        </View>

        <Text style={[styles.section, { color: c.foreground }]}>Wearing</Text>
        <View style={styles.slots}>
          {SLOT_ORDER.map((slot) => {
            const item = equipped[slot] ? byId.get(equipped[slot]!) : undefined;
            return (
              <Pressable
                key={slot}
                onPress={() => open(slot)}
                accessibilityRole="button"
                accessibilityLabel={`${SLOT_LABELS[slot]}: ${item?.name ?? "nothing"}. Change`}
                style={({ pressed }) => [styles.slot, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={[styles.slotArt, { backgroundColor: c.secondary }]}>
                  {item ? <ItemIcon item={item} size={44} /> : <MaterialCommunityIcons name={SLOT_ICONS[slot] as never} size={20} color={c.subtleForeground} />}
                </View>
                <Text style={[styles.slotLabel, { color: c.mutedForeground }]}>{SLOT_LABELS[slot].toUpperCase()}</Text>
                <Text style={[styles.slotValue, { color: item ? c.foreground : c.subtleForeground }]} numberOfLines={1}>
                  {item?.name ?? "—"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.section, { color: c.foreground }]}>Wardrobe · {owned.length}</Text>
        <View style={styles.wardrobe}>
          {owned.map((item) => {
            const on = equipped[item.slot] === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => open(item.slot)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${on ? ", wearing" : ""}`}
                style={[styles.wItem, { backgroundColor: c.card, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1 }]}
              >
                <ItemIcon item={item} size={52} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  handle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14 },
  stage: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  floor: { position: "absolute", left: 0, right: 0, bottom: 52, height: 90 },
  stageInner: { height: 400 },
  stageBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  stageHint: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  quickRow: { flexDirection: "row", gap: 8 },
  quickCard: { flex: 1, gap: 4, padding: 12 },
  quickTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  quickSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { width: "31.5%", flexGrow: 1, borderRadius: 14, borderWidth: 1, padding: 10, gap: 4 },
  slotArt: { height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  slotValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  wardrobe: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  wItem: { width: 66, height: 66, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});

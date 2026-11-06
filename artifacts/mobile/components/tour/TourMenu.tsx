import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { usePathname } from "expo-router";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { CloseButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { openWalkthrough } from "@/lib/settings";
import { closeTourMenu, startTour } from "@/lib/tour/store";
import { TOURS } from "@/lib/tour/tours";

/** The "?" button: pick an interactive tutorial to (re)play. */
export default function TourMenu() {
  const c = useColors();
  const path = usePathname();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeTourMenu}>
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeTourMenu} haptic={false} />
        <View style={[styles.sheet, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.foreground }]}>Tutorials</Text>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>Hands-on walkthroughs. End one anytime.</Text>
            </View>
            <CloseButton onPress={closeTourMenu} />
          </View>
          <ScrollView contentContainerStyle={{ gap: 8 }} showsVerticalScrollIndicator={false}>
            {TOURS.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Start the ${t.title} tutorial`}
                onPress={() => {
                  closeTourMenu();
                  // Let the menu close before the spotlight goes up.
                  setTimeout(() => startTour(t, path), 300);
                }}
                style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={[styles.icon, { backgroundColor: c.alpha(c.primary, 0.15) }]}>
                  <MaterialCommunityIcons name={t.icon as never} size={20} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.foreground }]}>{t.title}</Text>
                  <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={2}>
                    {t.description}
                  </Text>
                </View>
                <MaterialCommunityIcons name="play-circle-outline" size={22} color={c.primary} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                closeTourMenu();
                setTimeout(openWalkthrough, 300);
              }}
              style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.icon, { backgroundColor: c.secondary }]}>
                <MaterialCommunityIcons name="book-open-variant" size={20} color={c.foreground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.foreground }]}>How it all works</Text>
                <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Credits, streaks, levels and leagues at a glance.</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={c.mutedForeground} />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "center", padding: 16 },
  sheet: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 14, maxHeight: "85%", width: "100%", maxWidth: 520, alignSelf: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontFamily: "Inter_900Black" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});

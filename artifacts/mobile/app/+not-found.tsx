import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const c = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Not Found", headerShown: false }} />
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ObsidianBackdrop />
        <LiquidGlass variant="hero" radius={28} style={styles.cardWrap} contentStyle={styles.card}>
          <GlassDomeSheen id="not_found" glowColor={c.primary} intensity={0.28} />
          <View style={[styles.iconWrap, { backgroundColor: c.alpha(c.primary, 0.16), borderColor: c.alpha(c.primary, 0.35) }]}>
            <MaterialCommunityIcons name="compass-off-outline" size={34} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>Screen Not Found</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            This page doesn&apos;t exist or moved. Let&apos;s get you back to the action.
          </Text>
          <Button label="Go Home" icon="home-variant-outline" onPress={() => router.replace("/(tabs)")} style={{ alignSelf: "stretch" }} />
        </LiquidGlass>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  cardWrap: { width: "100%", maxWidth: 360 },
  card: { padding: 24, alignItems: "center", gap: 10 },
  iconWrap: { width: 68, height: 68, borderRadius: 34, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Inter_900Black" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginBottom: 6 },
});

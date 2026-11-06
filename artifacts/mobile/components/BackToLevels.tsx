import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useColors } from "@/hooks/useColors";

/**
 * Back arrow for tab screens opened from an XP challenge on Levels
 * (`?from=levels`). Tabs have no back stack, so this returns there explicitly.
 * The param is cleared when the tab loses focus so it doesn't linger.
 */
export default function BackToLevels() {
  const c = useColors();
  const nav = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const active = from === "levels";

  useEffect(() => {
    if (!active) return;
    return nav.addListener("blur", () => nav.setParams({ from: undefined } as never));
  }, [active, nav]);

  if (!active) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Levels"
      hitSlop={10}
      onPress={() => {
        nav.setParams({ from: undefined } as never);
        router.navigate("/levels" as never);
      }}
      style={({ pressed }) => [styles.btn, { backgroundColor: c.secondary, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <MaterialCommunityIcons name="chevron-left" size={22} color={c.foreground} />
      <Text style={[styles.text, { color: c.foreground }]}>Levels</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", paddingLeft: 4, paddingRight: 10, height: 34, borderRadius: 17, borderWidth: 1, marginRight: 8 },
  text: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable } from "@/components/fx/Tap";
import { Card } from "@/components/ui";
import { recordXpReason } from "@/components/XpGainPopup";
import { SCHEMES, THEME_IDS, themeUnlockLevel } from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { setThemeId } from "@/lib/settings";

/** The app's colour theme, picked in the Locker. Themes unlock with level. */
export default function ThemePicker() {
  const c = useColors();
  const { progress } = useApp();
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="palette-outline" size={18} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground }]}>Theme</Text>
      </View>
      <View style={styles.themes}>
        {THEME_IDS.map((id) => {
          const p = c.isDark ? SCHEMES[id].dark : SCHEMES[id].light;
          const on = c.themeId === id;
          const needs = themeUnlockLevel(id);
          const locked = progress.level < needs && !on;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: locked }}
              accessibilityLabel={locked ? `${SCHEMES[id].label} theme, unlocks at level ${needs}` : `${SCHEMES[id].label} theme`}
              disabled={locked}
              onPress={() => {
                if (id !== c.themeId) {
                  // First change pays XP (the server ignores repeats); the popup says why.
                  recordXpReason("Changed the App Color", "palette-outline");
                  api.reportChallengeAction("theme");
                }
                setThemeId(id);
              }}
              style={[styles.theme, { backgroundColor: p.background, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1, opacity: locked ? 0.55 : 1 }]}
            >
              <View style={styles.themeDots}>
                <View style={[styles.themeDot, { backgroundColor: p.primary }]} />
                <View style={[styles.themeDot, { backgroundColor: p.accent }]} />
                <View style={[styles.themeDot, { backgroundColor: p.positive }]} />
              </View>
              <View style={[styles.themeBar, { backgroundColor: p.card, borderColor: p.border }]} />
              <Text style={[styles.themeLabel, { color: p.foreground }]} numberOfLines={1}>{locked ? `Level ${needs}` : SCHEMES[id].label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  themes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  theme: { width: "31%", flexGrow: 1, borderRadius: 12, padding: 10, gap: 6 },
  themeDots: { flexDirection: "row", gap: 4 },
  themeDot: { width: 14, height: 14, borderRadius: 7 },
  themeBar: { height: 14, borderRadius: 5, borderWidth: 1 },
  themeLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
});

import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ScreenHeader, useBottomPad } from "@/components/ui";
import { LEGAL_UPDATED, PRIVACY, PRIVACY_URL, TERMS, TERMS_URL } from "@/constants/legal";
import { useColors } from "@/hooks/useColors";

/** Terms of Service / Privacy Policy. Reachable signed out (from sign-up) and from Settings. */
export default function LegalScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const privacy = doc === "privacy";
  const sections = privacy ? PRIVACY : TERMS;
  const url = privacy ? PRIVACY_URL : TERMS_URL;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ScreenHeader back title={privacy ? "Privacy Policy" : "Terms of Service"} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
        <Text style={[styles.updated, { color: c.subtleForeground }]}>Last updated {LEGAL_UPDATED}</Text>
        {sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={[styles.heading, { color: c.foreground }]}>{s.heading}</Text>
            <Text style={[styles.body, { color: c.mutedForeground }]}>{s.body}</Text>
          </View>
        ))}
        {url ? <Button label="Open full version" variant="ghost" icon="open-in-new" onPress={() => void Linking.openURL(url)} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 16 },
  updated: { fontSize: 12, fontFamily: "Inter_500Medium" },
  section: { gap: 4 },
  heading: { fontSize: 15, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
});

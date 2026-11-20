import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, ScreenHeader, useBottomPad } from "@/components/ui";
import { ObsidianBackdrop } from "@/components/ui/LiquidGlass";
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
      <ObsidianBackdrop />
      <ScreenHeader back title={privacy ? "Privacy Policy" : "Terms of Service"} subtitle={`Last updated ${LEGAL_UPDATED}`} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
        {sections.map((s) => (
          <Card key={s.heading} style={styles.section}>
            <Text style={[styles.heading, { color: c.foreground }]}>{s.heading}</Text>
            <Text style={[styles.body, { color: c.mutedForeground }]}>{s.body}</Text>
          </Card>
        ))}
        {url ? <Button label="Open full version" variant="ghost" icon="open-in-new" onPress={() => void Linking.openURL(url)} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 12 },
  section: { gap: 6 },
  heading: { fontSize: 15, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
});

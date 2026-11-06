import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useColors } from "@/hooks/useColors";

/** "I agree to the Terms (incl. zero tolerance for abusive content) and Privacy Policy." */
export default function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        onPress={() => onChange(!checked)}
        hitSlop={8}
      >
        <MaterialCommunityIcons name={checked ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={checked ? c.primary : c.mutedForeground} />
      </Pressable>
      <Text style={[styles.text, { color: c.mutedForeground }]}>
        I agree to the{" "}
        <Text style={[styles.link, { color: c.primary }]} onPress={() => router.push({ pathname: "/legal", params: { doc: "terms" } })}>
          Terms of Service
        </Text>
        , including zero tolerance for abusive or objectionable content, and the{" "}
        <Text style={[styles.link, { color: c.primary }]} onPress={() => router.push({ pathname: "/legal", params: { doc: "privacy" } })}>
          Privacy Policy
        </Text>
        . Credits are virtual and have no cash value.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  text: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  link: { fontFamily: "Inter_700Bold", textDecorationLine: "underline" },
});

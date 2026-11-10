import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";
import RollingNumber from "@/components/fx/RollingNumber";
import EarnCreditsButton from "@/components/ads/EarnCreditsButton";
import { useColors } from "@/hooks/useColors";

interface Props {
  tokens: number;
  size?: "sm" | "md" | "lg";
  /** Show the watch-a-video "+100" pill beside the balance. */
  earn?: boolean;
}

export default function TokenBalance({ tokens, size = "md", earn }: Props) {
  const colors = useColors();

  const fontSize = size === "sm" ? 13 : size === "lg" ? 22 : 16;
  const iconSize = size === "sm" ? 14 : size === "lg" ? 22 : 17;

  const balance = (
    <View style={[styles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <MaterialCommunityIcons name="lightning-bolt" size={iconSize} color={colors.primary} />
      {/* Rolls up (green) on a win, a prize or a refund; down (red) on a stake or a purchase. */}
      <RollingNumber value={tokens} style={[styles.text, { color: colors.foreground, fontSize }]} upColor={colors.positive} downColor={colors.negative} accessibilityLabel={`${tokens.toLocaleString()} credits`} />
    </View>
  );
  if (!earn) return balance;
  return (
    <View style={styles.withEarn}>
      <EarnCreditsButton />
      {balance}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  withEarn: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: {
    fontFamily: "Inter_700Bold",
  },
});

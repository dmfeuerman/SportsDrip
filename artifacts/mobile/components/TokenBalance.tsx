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

/** Compact balance for the top bar: 8,593 → 8.5K, 2,450,000 → 2.4M (always rounded down). */
export function compactCredits(n: number): string {
  const v = Math.floor(Math.abs(n));
  const sign = n < 0 ? "-" : "";
  const cut = (x: number, unit: number, suffix: string) => {
    const t = Math.floor((x / unit) * 10) / 10;
    return `${sign}${t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}${suffix}`;
  };
  if (v >= 1_000_000) return cut(v, 1_000_000, "M");
  if (v >= 1_000) return cut(v, 1_000, "K");
  return `${sign}${v}`;
}

export default function TokenBalance({ tokens, size = "md", earn }: Props) {
  const colors = useColors();

  const fontSize = size === "sm" ? 13 : size === "lg" ? 22 : 16;
  const iconSize = size === "sm" ? 14 : size === "lg" ? 22 : 17;

  const balance = (
    <View style={[styles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <MaterialCommunityIcons name="lightning-bolt" size={iconSize} color={colors.primary} />
      {/* Rolls up (green) on a win, a prize or a refund; down (red) on a stake or a purchase. */}
      <RollingNumber value={tokens} format={compactCredits} style={[styles.text, { color: colors.foreground, fontSize }]} upColor={colors.positive} downColor={colors.negative} accessibilityLabel={`${tokens.toLocaleString()} credits`} />
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

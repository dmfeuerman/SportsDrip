import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  tokens: number;
  size?: "sm" | "md" | "lg";
}

export default function TokenBalance({ tokens, size = "md" }: Props) {
  const colors = useColors();

  const fontSize = size === "sm" ? 13 : size === "lg" ? 22 : 16;
  const iconSize = size === "sm" ? 14 : size === "lg" ? 22 : 17;

  return (
    <View style={[styles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <MaterialCommunityIcons name="lightning-bolt" size={iconSize} color={colors.primary} />
      <Text style={[styles.text, { color: colors.foreground, fontSize }]}>
        {tokens.toLocaleString()}
      </Text>
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
  text: {
    fontFamily: "Inter_700Bold",
  },
});

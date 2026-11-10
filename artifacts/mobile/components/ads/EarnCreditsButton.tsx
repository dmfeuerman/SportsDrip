import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { AD_REWARD_DISPLAY } from "@/constants/ads";
import { useColors } from "@/hooks/useColors";
import { useBonusVideo } from "@/hooks/useBonusVideo";

/**
 * "Watch a video for credits", wherever credits run short: a small pill next
 * to a balance, or a full-width row under a "not enough credits" message.
 * Renders nothing when ads are off or today's videos are used up.
 */
export default function EarnCreditsButton({
  variant = "pill",
  style,
}: {
  variant?: "pill" | "row";
  style?: StyleProp<ViewStyle>;
}) {
  const v = useBonusVideo();
  if (!v.available || (v.done && !v.note)) return null;
  return variant === "pill" ? <Pill v={v} style={style} /> : <Row v={v} style={style} />;
}

type V = ReturnType<typeof useBonusVideo>;

function Pill({ v, style }: { v: V; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const busy = v.crediting || (!v.ready && !v.button.onPress);
  return (
    <Pressable
      onPress={v.ready ? v.watch : v.button.onPress}
      disabled={!v.button.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Watch a video for ${AD_REWARD_DISPLAY.credits} free credits`}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: c.primarySoft, borderColor: c.alpha(c.primary, 0.45), opacity: pressed ? 0.7 : busy ? 0.6 : 1 },
        style,
      ]}
    >
      {v.crediting ? (
        <ActivityIndicator size="small" color={c.primary} />
      ) : (
        <MaterialCommunityIcons name="play-circle" size={15} color={c.primary} />
      )}
      <Text style={[styles.pillText, { color: c.primary }]}>+{AD_REWARD_DISPLAY.credits}</Text>
    </Pressable>
  );
}

function Row({ v, style }: { v: V; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const { button, note } = v;
  return (
    <View style={[styles.rowWrap, style]}>
      <Pressable
        onPress={button.onPress}
        disabled={button.disabled}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: c.primarySoft, borderColor: c.alpha(c.primary, 0.45), opacity: pressed ? 0.75 : button.disabled ? 0.6 : 1 },
        ]}
      >
        {button.loading ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <MaterialCommunityIcons name={v.done ? "check" : "play-circle"} size={18} color={c.primary} />
        )}
        <Text style={[styles.rowText, { color: c.primary }]}>
          {v.ready ? `Short on credits? Watch a video for +${AD_REWARD_DISPLAY.credits}` : button.label}
        </Text>
      </Pressable>
      {note ? (
        <Text style={[styles.note, { color: note.tone === "ok" ? c.positive : c.mutedForeground }]}>{note.text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  rowWrap: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  rowText: { fontSize: 13, fontFamily: "Inter_700Bold", flexShrink: 1 },
  note: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
});

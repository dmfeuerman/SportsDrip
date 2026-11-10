import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { AD_REWARD_DISPLAY } from "@/constants/ads";
import { useColors } from "@/hooks/useColors";
import { useBonusVideo } from "@/hooks/useBonusVideo";

/** Opt-in rewarded video on Home: watch to the end for bonus credits, a few times a day. */
export default function BonusVideoCard() {
  const v = useBonusVideo();
  if (!v.available) return null;
  return <BonusVideo v={v} />;
}

function BonusVideo({ v }: { v: ReturnType<typeof useBonusVideo> }) {
  const c = useColors();
  const { done, left, note, button } = v;
  return (
    <Card tone="money" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.primarySoft }]}>
          <MaterialCommunityIcons name="play-circle-outline" size={22} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>Bonus Credits</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {done
              ? "You've watched today's bonus videos."
              : `Watch a short video for +${AD_REWARD_DISPLAY.credits} credits · ${left} of ${AD_REWARD_DISPLAY.dailyLimit} left today`}
          </Text>
        </View>
      </View>
      <Button
        label={button.label}
        icon={done ? "check" : "play"}
        size="sm"
        variant={done ? "secondary" : "primary"}
        disabled={button.disabled}
        loading={button.loading}
        onPress={button.onPress}
      />
      {note ? (
        <Text style={[styles.note, { color: note.tone === "ok" ? c.positive : c.mutedForeground }]}>{note.text}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  note: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
});

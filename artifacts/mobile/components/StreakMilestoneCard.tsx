import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Burst from "@/components/fx/Burst";
import { Pressable } from "@/components/fx/Tap";
import { Button } from "@/components/ui";
import theme from "@/constants/theme";
import { useColors } from "@/hooks/useColors";
import { celebrate } from "@/lib/celebrate";
import { shareViewOrText } from "@/lib/shareCard";

/** 7 / 30 / 100-day streak moment: a shareable card on the streak_milestone rung. */
export default function StreakMilestoneCard({ days, name, onClose }: { days: number | null; name?: string; onClose: () => void }) {
  const c = useColors();
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const fx = celebrate("streak_milestone");
  if (!days) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        {fx.burst ? <Burst colors={[c.warning, c.accent, c.primary]} count={fx.burst.count} power={fx.burst.power} duration={fx.burst.duration} originY={0.4} /> : null}
        <View ref={ref} collapsable={false} accessibilityViewIsModal style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(c.warning, 0.6) }]}>
          <MaterialCommunityIcons name="fire" size={56} color={c.warning} />
          <Text style={[styles.big, { color: c.foreground }]}>{days}-day streak</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>{name ? `${name} on On The House` : "On The House Daily Pick"}</Text>
        </View>
        <View style={styles.actions}>
          {fx.shareCard ? (
            <Button
              label="Share"
              icon="share-variant"
              onPress={() =>
                void shareViewOrText({ viewRef: ref, kind: "streak", id: String(days), message: `🔥 ${days}-day Daily Pick streak on On The House` })
              }
            />
          ) : null}
          <Button label="Nice" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  card: { width: "100%", maxWidth: 340, borderWidth: 1.5, borderRadius: 24, padding: 28, alignItems: "center", gap: 8 },
  big: theme.type.title,
  sub: theme.type.caption,
  actions: { width: "100%", maxWidth: 340, gap: 8 },
});

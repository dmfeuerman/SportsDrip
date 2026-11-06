import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

/**
 * Soft pre-prompt shown after the first lock-in, before the iOS system dialog.
 * "Not now" never triggers the system prompt, so a decline here costs nothing.
 */
export default function PushPrimer({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const c = useColors();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDecline} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Animated.View entering={FadeIn.duration(180)} style={[styles.card, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <View style={[styles.icon, { backgroundColor: c.alpha(c.primary, 0.16) }]}>
            <MaterialCommunityIcons name="bell-ring-outline" size={28} color={c.primary} />
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
            Know the second it settles
          </Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            Get told when your pick wins, when the game swings, and when friends challenge you.
          </Text>
          <Button label="Turn on Notifications" size="lg" onPress={onAccept} style={{ alignSelf: "stretch" }} />
          <Button label="Not Now" variant="secondary" onPress={onDecline} style={{ alignSelf: "stretch" }} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  card: { width: "100%", maxWidth: 340, borderRadius: 22, borderWidth: 1, padding: 22, gap: 12, alignItems: "center" },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_900Black", textAlign: "center" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});

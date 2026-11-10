import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useOnline } from "@/lib/netcheck";

/** Blocks the app with a popup while the device has no internet connection. */
export default function ConnectionGate() {
  const c = useColors();
  const { online, recheck } = useOnline();
  if (online !== false) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
        <Card style={styles.card} accessibilityLabel="No internet connection">
          <MaterialCommunityIcons name="wifi-off" size={40} color={c.negative} />
          <Text style={[styles.title, { color: c.foreground }]}>No internet connection</Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            Connect to Wi-Fi or cellular data to keep playing. We'll reconnect automatically.
          </Text>
          <Button label="Try again" onPress={() => void recheck()} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 24 },
  card: { gap: 12, alignItems: "center" },
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
});

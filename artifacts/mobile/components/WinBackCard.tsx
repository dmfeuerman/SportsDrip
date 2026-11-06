import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";

/** Returning-player Prize Box, shown while users/{uid}.winBack.pending (scheduled/winBack.ts). */
export default function WinBackCard() {
  const c = useColors();
  const { profile } = useApp();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!profile?.winBack?.pending || done) return null;

  const claim = async () => {
    setBusy(true);
    try {
      const r = await api.claimWinBackBox({});
      haptic.celebrate();
      setDone(true);
      show({ kind: "win", title: "Welcome back!", body: "Your returning-player Prize Box is open.", amount: r.credits ? { value: r.credits, currency: "credits" } : undefined });
    } catch (e) {
      show({ kind: "warning", title: "Couldn't open the box", body: e instanceof Error ? e.message : "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="Welcome back Prize Box">
      <View style={styles.head}>
        <MaterialCommunityIcons name="gift-open-outline" size={22} color={c.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>Welcome back</Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>A returning-player Prize Box is waiting for you.</Text>
        </View>
      </View>
      <Button label="Open it" icon="gift-outline" onPress={() => void claim()} loading={busy} disabled={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 16, fontWeight: "800" },
  body: { fontSize: 13 },
});

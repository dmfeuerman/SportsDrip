import { router } from "expo-router";
import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { TERMS, TERMS_VERSION } from "@/constants/legal";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";

/**
 * Accounts created before the current Terms (or before terms existed) must
 * accept them — including the zero-tolerance Community Guidelines — before
 * they can keep using chat and the rest of the app.
 */
export default function TermsGate() {
  const c = useColors();
  const { profile } = useApp();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = !DEMO && !!profile?.uid && (profile.termsVersion ?? 0) < TERMS_VERSION && !accepted;
  if (!due) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptTerms({ version: TERMS_VERSION });
      setAccepted(true);
    } catch (e) {
      setError(api.friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const guidelines = TERMS.find((t) => t.heading.includes("Community"));
  return (
    <Modal visible transparent animationType="fade">
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <View style={[styles.card, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.foreground }]}>Updated Terms</Text>
          <ScrollView style={{ maxHeight: 260 }}>
            <Text style={[styles.body, { color: c.mutedForeground }]}>
              To keep playing, please accept our Terms of Service and Community Guidelines. Credits and items are virtual, have no cash value and can't be sold or traded.
            </Text>
            {guidelines ? <Text style={[styles.body, { color: c.foreground, marginTop: 10 }]}>{guidelines.body}</Text> : null}
          </ScrollView>
          <Button label="Read Terms" variant="ghost" onPress={() => router.push({ pathname: "/legal", params: { doc: "terms" } })} />
          <Button label="Read Privacy Policy" variant="ghost" onPress={() => router.push({ pathname: "/legal", params: { doc: "privacy" } })} />
          {error ? <Text style={[styles.body, { color: c.destructive }]}>{error}</Text> : null}
          <Button label={busy ? "Saving…" : "I Agree"} onPress={() => void accept()} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: 22, borderWidth: 1, padding: 20, gap: 10 },
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
});

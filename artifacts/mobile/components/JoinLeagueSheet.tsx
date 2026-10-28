import { MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import KeyboardSheet from "@/components/KeyboardSheet";
import { Amount, Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getDb } from "@/lib/firebase";

/**
 * Join by code. Looks the code up as you type so you see the league name and
 * buy-in *before* committing credits — the old sheet charged first and asked
 * questions later.
 */
export default function JoinLeagueSheet({
  visible,
  initialCode,
  balance,
  onClose,
  onJoin,
}: {
  visible: boolean;
  initialCode?: string;
  balance: number;
  onClose: () => void;
  onJoin: (code: string) => Promise<string | null>;
}) {
  const c = useColors();
  const [code, setCode] = useState(initialCode ?? "");
  const [preview, setPreview] = useState<{ leagueName: string; buyIn: number } | null | "missing">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCode((initialCode ?? "").toUpperCase());
      setError(null);
    }
  }, [visible, initialCode]);

  useEffect(() => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 6) {
      setPreview(null);
      return;
    }
    let alive = true;
    const db = getDb();
    if (!db) return;
    getDoc(doc(db, "leagueInvites", clean))
      .then((s) => {
        if (!alive) return;
        setPreview(s.exists() ? { leagueName: s.get("leagueName") as string, buyIn: (s.get("buyIn") as number) ?? 0 } : "missing");
      })
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [code]);

  const found = preview && preview !== "missing" ? preview : null;
  const short = found ? found.buyIn > balance : false;

  async function submit() {
    setBusy(true);
    setError(null);
    const err = await onJoin(code.trim().toUpperCase());
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <KeyboardSheet visible={visible} onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
        Join a league
      </Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>Enter the 6-character code a friend shared.</Text>
      <TextInput
        style={[styles.input, { color: c.foreground, borderColor: error ? c.negative : c.border, backgroundColor: c.secondary }]}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        placeholder="AB3CD7"
        placeholderTextColor={c.subtleForeground}
        maxLength={8}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus={!initialCode}
        accessibilityLabel="Invite code"
        returnKeyType="go"
        onSubmitEditing={() => {
          if (code.trim().length >= 6 && preview !== "missing" && !short && !busy) void submit();
        }}
      />
      {found ? (
        <View style={[styles.preview, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <MaterialCommunityIcons name="trophy-outline" size={20} color={c.league} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.pName, { color: c.foreground }]}>{found.leagueName}</Text>
            <Text style={[styles.pSub, { color: c.mutedForeground }]}>{found.buyIn > 0 ? "Buy-in, paid into the prize pot" : "Free to join"}</Text>
          </View>
          {found.buyIn > 0 ? <Amount value={found.buyIn} size="sm" /> : null}
        </View>
      ) : preview === "missing" ? (
        <Text style={[styles.pSub, { color: c.negative }]}>No league uses that code.</Text>
      ) : null}
      {short && <Text style={[styles.pSub, { color: c.negative }]}>You need {found!.buyIn.toLocaleString()} credits to join.</Text>}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.pSub, { color: c.negative }]}>
          {error}
        </Text>
      ) : null}
      <Button
        label={found && found.buyIn > 0 ? `Pay ${found.buyIn.toLocaleString()} & join` : "Join league"}
        size="lg"
        onPress={submit}
        loading={busy}
        disabled={code.trim().length < 6 || preview === "missing" || short}
      />
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Inter_900Black" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 24, letterSpacing: 6, fontFamily: "Inter_700Bold", textAlign: "center" },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  pName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  pSub: { fontSize: 13, fontFamily: "Inter_500Medium" },
});

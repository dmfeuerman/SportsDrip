import { MaterialCommunityIcons } from "@expo/vector-icons";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import type { LeagueMessage } from "@/constants/leagueTypes";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { chatText } from "@/lib/chatText";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

/**
 * Game thread: the league's chat, filtered to this game. Not a new chat
 * system: messages are ordinary league messages tagged with `gameId`, so they
 * also land in league chat. No push of its own.
 */
export default function GameThread({ gameId }: { gameId: string }) {
  const c = useColors();
  const { activeLeagues, sendMessage, uid } = useLeague();
  const [leagueId, setLeagueId] = useState<string | null>(activeLeagues[0]?.id ?? null);
  const [msgs, setMsgs] = useState<LeagueMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId && activeLeagues[0]) setLeagueId(activeLeagues[0].id);
  }, [activeLeagues, leagueId]);

  useEffect(() => {
    if (DEMO || !leagueId) return;
    const db = getDb();
    if (!db) return;
    return onSnapshot(
      query(collection(db, "leagues", leagueId, "messages"), where("gameId", "==", gameId), orderBy("at", "desc"), limit(40)),
      (snap) => setMsgs(snap.docs.map((d) => ({ ...(d.data() as LeagueMessage), id: d.id })).reverse()),
      () => {}
    );
  }, [leagueId, gameId]);

  if (!activeLeagues.length || !leagueId) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setErr(null);
    const e = await sendMessage(leagueId, text, undefined, gameId);
    if (e) {
      setErr(e);
      haptic.error();
    } else {
      setDraft("");
      haptic.tick();
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="forum-outline" size={16} color={c.league} />
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
          Game thread
        </Text>
      </View>
      {activeLeagues.length > 1 ? (
        <View style={styles.chips}>
          {activeLeagues.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityState={{ selected: l.id === leagueId }}
              onPress={() => setLeagueId(l.id)}
              style={[styles.chip, { borderColor: l.id === leagueId ? c.league : c.border, backgroundColor: l.id === leagueId ? c.leagueSoft : c.secondary }]}
            >
              <Text style={[styles.meta, { color: l.id === leagueId ? c.league : c.mutedForeground }]} numberOfLines={1}>
                {l.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {msgs.length === 0 ? (
        <Text style={[styles.meta, { color: c.mutedForeground }]}>No talk yet. Start the trash talk.</Text>
      ) : (
        msgs.map((m) => (
          <Text key={m.id} style={[styles.msg, { color: c.foreground }]}>
            <Text style={{ fontFamily: "Inter_700Bold", color: m.uid === uid ? c.primary : c.league }}>{m.name}: </Text>
            {chatText(m.text)}
          </Text>
        ))
      )}
      <View style={[styles.inputRow, { borderColor: c.border, backgroundColor: c.secondary }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something…"
          placeholderTextColor={c.subtleForeground}
          maxLength={500}
          style={[styles.input, { color: c.foreground }]}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} hitSlop={8}>
          <MaterialCommunityIcons name="send" size={20} color={draft.trim() ? c.primary : c.subtleForeground} />
        </Pressable>
      </View>
      {err ? <Text style={[styles.meta, { color: c.negative }]}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, maxWidth: 160 },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  msg: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 19 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
});

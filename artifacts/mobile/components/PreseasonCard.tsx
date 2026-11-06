import { MaterialCommunityIcons } from "@expo/vector-icons";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { isLeagueStarted, leagueStartsAt, MIN_LEAGUE_PLAYERS, type League } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

export interface Prediction {
  uid: string;
  name: string;
  text: string;
  at: number;
}

/** Members' Bold Predictions (leagues/{id}/predictions). */
export function usePredictions(leagueId: string | undefined): Prediction[] {
  const [list, setList] = useState<Prediction[]>([]);
  useEffect(() => {
    if (DEMO || !leagueId) return;
    const db = getDb();
    if (!db) return;
    return onSnapshot(
      collection(db, "leagues", leagueId, "predictions"),
      (s) => setList(s.docs.map((d) => d.data() as Prediction).sort((a, b) => a.at - b.at)),
      () => {}
    );
  }, [leagueId]);
  return list;
}

/** The squad goal shown before kickoff: more people make a better table. */
const SQUAD_GOAL = 4;

function countdown(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}d ${h}h ${m % 60}m` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/**
 * Pre-season: a live countdown to kickoff, a squad goal with the invite
 * button, and Bold Predictions everyone posts before it starts.
 */
export default function PreseasonCard({ league, uid, onInvite }: { league: League; uid: string | null; onInvite: () => void }) {
  const c = useColors();
  const now = useNow(30_000);
  const start = leagueStartsAt(league);
  const predictions = usePredictions(league.id);
  const mine = predictions.find((p) => p.uid === uid);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (isLeagueStarted(league, now)) return null;

  const members = league.memberIds.length;
  // Start time has passed but nobody else is in yet: it starts when the second player joins.
  const waiting = start <= now && members < MIN_LEAGUE_PLAYERS;
  const need = Math.max(0, SQUAD_GOAL - members);
  const myName = uid ? league.members?.[uid]?.displayName : undefined;

  const save = async () => {
    const text = draft.trim();
    if (!text || !uid || !myName) return;
    const db = getDb();
    if (!db) return;
    setSaving(true);
    setErr(null);
    try {
      await setDoc(doc(db, "leagues", league.id, "predictions", uid), { uid, name: myName, text, at: Date.now() });
      haptic.success();
      setEditing(false);
      setDraft("");
    } catch {
      setErr("Couldn't save. Predictions lock when the league starts.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card tone="league" style={{ gap: 12 }}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="timer-outline" size={18} color={c.league} />
        <Text style={[styles.kicker, { color: c.league }]}>PRE-SEASON</Text>
        <Text style={[styles.clock, { color: c.foreground }]}>{waiting ? "Needs 1 more" : countdown(start - now)}</Text>
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {waiting
          ? "A league needs at least 2 players. Invite a friend — it kicks off the moment they join."
          : members < MIN_LEAGUE_PLAYERS
            ? `Kicks off ${new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} if at least 2 players have joined. Get everyone in now.`
            : `Kicks off ${new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. The roster locks then — get everyone in now.`}
      </Text>

      <View style={{ gap: 6 }}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: c.foreground, flex: 1 }]}>
            {members} in{need > 0 ? ` · ${need} more for a full table` : " · full table"}
          </Text>
          <Button size="sm" variant="league" icon="account-plus-outline" label="Invite" onPress={onInvite} />
        </View>
        <View style={[styles.track, { backgroundColor: c.alpha(c.league, 0.18) }]}>
          <View style={[styles.fill, { width: `${Math.min(1, members / SQUAD_GOAL) * 100}%`, backgroundColor: c.league }]} />
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: c.border }]} />
      <View style={styles.row}>
        <MaterialCommunityIcons name="crystal-ball" size={18} color={c.accent} />
        <Text style={[styles.label, { color: c.foreground, flex: 1 }]}>Bold Predictions</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>{predictions.length}/{members}</Text>
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>Call your shot before kickoff. They lock at the start and stay on the league page all season.</Text>
      {predictions.map((p) => (
        <View key={p.uid} style={[styles.pred, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <Text style={[styles.predName, { color: p.uid === uid ? c.accent : c.foreground }]}>{p.uid === uid ? "You" : p.name}</Text>
          <Text style={[styles.predText, { color: c.foreground }]}>“{p.text}”</Text>
        </View>
      ))}
      {uid && (!mine || editing) ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={mine ? mine.text : "e.g. I finish first and Jake goes bankrupt by week 3"}
            placeholderTextColor={c.subtleForeground}
            maxLength={140}
            multiline
            style={[styles.input, { color: c.foreground, backgroundColor: c.background, borderColor: c.border }]}
          />
          {err ? <Text style={[styles.sub, { color: c.negative }]}>{err}</Text> : null}
          <Button size="sm" label={mine ? "Update Prediction" : "Lock In Prediction"} icon="crystal-ball" onPress={() => void save()} loading={saving} disabled={!draft.trim()} />
        </View>
      ) : uid ? (
        <Button
          size="sm"
          variant="ghost"
          label="Edit My Prediction"
          icon="pencil-outline"
          onPress={() => {
            setDraft(mine?.text ?? "");
            setEditing(true);
          }}
        />
      ) : null}
    </Card>
  );
}

/** After kickoff: the predictions, read-only (shown on the league's Info tab). */
export function PredictionsCard({ league }: { league: League }) {
  const c = useColors();
  const predictions = usePredictions(league.id);
  if (!predictions.length || !isLeagueStarted(league)) return null;
  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="crystal-ball" size={18} color={c.accent} />
        <Text style={[styles.label, { color: c.foreground, flex: 1 }]}>Bold Predictions</Text>
        <MaterialCommunityIcons name="lock-outline" size={14} color={c.mutedForeground} />
      </View>
      {predictions.map((p) => (
        <View key={p.uid} style={[styles.pred, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <Text style={[styles.predName, { color: c.foreground }]}>{p.name}</Text>
          <Text style={[styles.predText, { color: c.foreground }]}>“{p.text}”</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.4, fontFamily: "Inter_900Black" },
  clock: { fontSize: 18, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  label: { fontSize: 14, fontFamily: "Inter_700Bold" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  pred: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 2 },
  predName: { fontSize: 11, letterSpacing: 0.4, fontFamily: "Inter_800ExtraBold" },
  predText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 60, fontSize: 14, fontFamily: "Inter_500Medium", textAlignVertical: "top" },
});

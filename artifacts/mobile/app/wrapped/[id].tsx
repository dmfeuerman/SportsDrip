import { useExitBreakpoint } from "@/context/AdsContext";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Pressable } from "@/components/fx/Tap";
import { BackButton, Button, EmptyState, useTopPad } from "@/components/ui";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { shareViewOrText } from "@/lib/shareCard";

interface Wrapped {
  periodId: string;
  title: string;
  record: { w: number; l: number; p: number };
  bestCall: { label: string; odds: number } | null;
  worstBeat: { label: string; stake: number } | null;
  rival: { uid: string; name: string; games: number; w: number; l: number } | null;
  topTeam: { abbr: string; picks: number } | null;
  streakBest: number;
  level: number;
  achievements: number;
}

interface Story {
  key: string;
  kicker: string;
  big: string;
  sub: string;
  /** Private cards (a loss) are never offered for sharing. */
  shareable: boolean;
}

function storiesFor(w: Wrapped): Story[] {
  const out: Story[] = [
    { key: "record", kicker: w.title, big: `${w.record.w}–${w.record.l}${w.record.p ? `–${w.record.p}` : ""}`, sub: "Your record", shareable: true },
  ];
  if (w.bestCall) out.push({ key: "best", kicker: "Best call", big: `${w.bestCall.odds.toFixed(2)}x`, sub: w.bestCall.label, shareable: true });
  if (w.worstBeat) out.push({ key: "worst", kicker: "The one that got away", big: w.worstBeat.label, sub: "Only you can see this card", shareable: false });
  if (w.rival) out.push({ key: "rival", kicker: "Your rival", big: w.rival.name, sub: `${w.rival.w}–${w.rival.l} across ${w.rival.games} games`, shareable: true });
  if (w.topTeam) out.push({ key: "team", kicker: "Ride or die", big: w.topTeam.abbr, sub: `${w.topTeam.picks} picks`, shareable: true });
  out.push({ key: "streak", kicker: "Best streak", big: `${w.streakBest} days`, sub: `Level ${w.level} · ${w.achievements} achievements`, shareable: true });
  out.push({ key: "end", kicker: "That's a wrap", big: "See you next season", sub: "", shareable: true });
  return out;
}

/** Drip Wrapped in stories format: tap right to advance, left to go back. */
export default function WrappedScreen() {
  useExitBreakpoint("wrapped_exit");
  const c = useColors();
  const top = useTopPad();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useApp();
  const { byId } = useCatalog();
  const [w, setW] = useState<Wrapped | null | "missing">(null);
  const [i, setI] = useState(0);
  const ref = useRef<React.ComponentRef<typeof View> | null>(null);

  useEffect(() => {
    const db = getDb();
    if (!db || !profile?.uid || !id) return;
    return onSnapshot(
      doc(db, "users", profile.uid, "wrapped", id),
      (s) => setW(s.exists() ? (s.data() as Wrapped) : "missing"),
      () => setW("missing")
    );
  }, [profile?.uid, id]);

  if (w === "missing") {
    return (
      <View style={[styles.fill, { backgroundColor: c.background, paddingTop: top }]}>
        <BackButton />
        <EmptyState icon="gift-outline" title="Not Ready Yet" body="Your Wrapped shows up when the season ends." />
      </View>
    );
  }
  if (!w) return <View style={[styles.fill, { backgroundColor: c.background }]} />;

  const stories = storiesFor(w);
  const s = stories[Math.min(i, stories.length - 1)]!;
  const last = i >= stories.length - 1;
  const go = (d: number) => {
    haptic.tick();
    const n = i + d;
    if (n >= stories.length) router.back();
    else setI(Math.max(0, n));
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.background, paddingTop: top }]}>
      <View style={styles.bars}>
        {stories.map((x, k) => (
          <View key={x.key} style={[styles.bar, { backgroundColor: k <= i ? c.primary : c.secondary }]} />
        ))}
      </View>
      <View ref={ref} collapsable={false} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.kicker, { color: c.primary }]}>{s.kicker}</Text>
        <Text style={[styles.big, { color: c.foreground }]} accessibilityRole="header">
          {s.big}
        </Text>
        {s.sub ? <Text style={[styles.sub, { color: c.mutedForeground }]}>{s.sub}</Text> : null}
        {last && profile ? (
          <View style={styles.dance}>
            <AvatarDisplay avatar={profile.avatar} equipped={profile.equipped} catalog={byId} size="lg" interactive={false} move={{ id: profile.moves?.[0] ?? "cheer", n: 1 }} />
          </View>
        ) : null}
      </View>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.taps} pointerEvents="box-none">
          <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel="Previous card" onPress={() => go(-1)} />
          <Pressable style={{ flex: 2 }} accessibilityRole="button" accessibilityLabel={last ? "Close" : "Next card"} onPress={() => go(1)} />
        </View>
      </View>
      <View style={styles.actions}>
        {s.shareable ? (
          <Button
            label="Share"
            icon="share-variant"
            onPress={() => void shareViewOrText({ viewRef: ref, kind: "wrapped", id: `${w.periodId}_${s.key}`, message: `${s.kicker}: ${s.big} — SportDrip Wrapped` })}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 16 },
  bars: { flexDirection: "row", gap: 4, marginVertical: 12 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  card: { flex: 1, borderWidth: 1, borderRadius: 24, padding: 24, justifyContent: "center", alignItems: "center", gap: 10 },
  kicker: theme.type.overline,
  big: { ...theme.type.display, textAlign: "center" },
  sub: { ...theme.type.body, textAlign: "center" },
  dance: { width: "100%", height: 260 },
  taps: { flex: 1, flexDirection: "row", marginTop: 60, marginBottom: 90 },
  actions: { paddingVertical: 16, zIndex: 2 },
});

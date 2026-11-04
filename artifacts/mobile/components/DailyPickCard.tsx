import { MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Card, Pill } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { untilKickoff } from "@/lib/odds";

interface Team {
  abbreviation: string;
  name?: string;
  color?: string;
}
interface Featured {
  day: string;
  gameId: string;
  sport: string | null;
  startsAt: number;
  homeTeam: Team | null;
  awayTeam: Team | null;
}
interface MyPick {
  side: "home" | "away";
  teamAbbr: string | null;
  result: "won" | "lost" | "push" | null;
}

/** Today's date in America/New_York, matching the server's nyDay. */
function nyDay(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Daily Pick: one free call a day on the same featured game as everyone else.
 * No stake. Keeps the streak alive (with a banked freeze covering a missed day)
 * and pays XP. Losing a streak is shown as "best streak", never "streak lost".
 */
export default function DailyPickCard() {
  const c = useColors();
  const now = useNow(30_000);
  const { profile } = useApp();
  const { show } = useToast();
  const uid = profile?.uid ?? null;
  const day = nyDay(now);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [mine, setMine] = useState<MyPick | null>(null);
  const [busy, setBusy] = useState<"home" | "away" | null>(null);

  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    const a = onSnapshot(doc(db, "dailyPick", day), (s) => setFeatured(s.exists() ? (s.data() as Featured) : null), () => {});
    const b = onSnapshot(doc(db, "users", uid, "dailyPicks", day), (s) => setMine(s.exists() ? (s.data() as MyPick) : null), () => {});
    return () => {
      a();
      b();
    };
  }, [uid, day]);

  if (!featured?.homeTeam || !featured.awayTeam) return null;
  const locked = featured.startsAt <= now;
  const streak = profile?.streak;
  const alive = !!streak?.count;

  const pick = async (side: "home" | "away") => {
    if (locked || busy) return;
    haptic.tick();
    setBusy(side);
    try {
      const r = await api.makeDailyPick({ side });
      haptic.success();
      if (r.milestone) {
        show({ id: `streak_${r.milestone}`, kind: "win", icon: "fire", title: `${r.milestone}-day streak!`, body: "Keep it going tomorrow." });
      }
    } catch (e) {
      haptic.error();
      show({ kind: "warning", title: "Couldn't save your pick", body: api.friendlyError(e) });
    } finally {
      setBusy(null);
    }
  };

  const status = mine?.result
    ? mine.result === "won"
      ? { label: "Called it", tone: "positive" as const }
      : mine.result === "lost"
        ? { label: "Missed", tone: "negative" as const }
        : { label: "Push", tone: "neutral" as const }
    : mine
      ? { label: locked ? "Riding" : "Picked", tone: "accent" as const }
      : null;

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="Daily Pick">
      <View style={styles.head}>
        <MaterialCommunityIcons name="calendar-check" size={20} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground }]}>Daily Pick</Text>
        <Text style={[styles.sub, { color: c.mutedForeground, flex: 1 }]} numberOfLines={1}>
          Free · {locked ? "locked" : `locks ${untilKickoff(featured.startsAt, now)}`}
        </Text>
        {status ? <Pill label={status.label} tone={status.tone} /> : null}
      </View>
      <View style={styles.row}>
        {(["away", "home"] as const).map((side) => {
          const t = side === "home" ? featured.homeTeam! : featured.awayTeam!;
          const on = mine?.side === side;
          const tint = t.color || c.primary;
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: locked }}
              accessibilityLabel={`Pick ${t.name ?? t.abbreviation}`}
              disabled={locked || !!busy}
              onPress={() => pick(side)}
              style={({ pressed }) => [
                styles.team,
                {
                  borderColor: on ? tint : c.border,
                  backgroundColor: on ? c.alpha(tint, 0.18) : c.secondary,
                  opacity: locked && !on ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.abbr, { color: c.foreground }]}>{t.abbreviation}</Text>
              <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
                {busy === side ? "Saving…" : side === "home" ? "Home" : "Away"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {alive
          ? `🔥 ${streak!.count}-day streak${streak!.freezes ? " · 🧊 freeze banked" : ""}${mine ? "" : " — pick to keep it"}`
          : streak?.longest
            ? `Best streak ${streak.longest} days. Start a new one today.`
            : "Pick daily to build a streak. Every 7 days banks a freeze."}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", gap: 10 },
  team: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 2 },
  abbr: { fontSize: 20, fontFamily: "Inter_900Black", letterSpacing: -0.5 },
});

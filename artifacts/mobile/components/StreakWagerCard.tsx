import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card, Pill } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import { friendlyError, streakWager } from "@/lib/api";
import { haptic } from "@/lib/motion";
import { nyDayOf } from "@/lib/streakGrid";

/** Mirrors functions/src/lib/streakWager.ts. The server decides. */
const WAGER_DAYS = 7;
const STAKES = [50, 100, 250] as const;

const dayNum = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) : 0;
};

/**
 * Streak wager: stake credits that you'll add seven days to your pick streak.
 * Doubles if you get there. One at a time.
 */
export default function StreakWagerCard() {
  const c = useColors();
  const { profile, balance } = useApp();
  const { show } = useToast();
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wager = profile?.streakWager ?? null;
  const streak = profile?.streak ?? null;
  const today = nyDayOf(now);
  const gap = streak?.lastDay ? dayNum(today) - dayNum(streak.lastDay) : 99;
  const count = streak?.count ?? 0;
  const alive = count > 0 && (gap <= 1 || (gap === 2 && (streak?.freezes ?? 0) > 0));
  const days = wager ? Math.max(0, Math.min(WAGER_DAYS, count - wager.startCount)) : 0;

  // Decided (hit the target, or the streak lapsed): ask the server to grade it, once per state.
  const decided = !!wager && ((alive && count >= wager.target) || (!alive && !(wager.startCount === 0 && wager.startDay === today)) || (count < wager.startCount && streak?.repairPending?.day !== today));
  const asked = useRef("");
  useEffect(() => {
    if (!wager || !decided) return;
    const key = `${wager.startDay}:${count}:${today}`;
    if (asked.current === key) return;
    asked.current = key;
    streakWager({ action: "settle" })
      .then((res) => {
        if (res.state === "won") {
          haptic.success();
          show({ id: `wager_${wager.startDay}`, kind: "win", icon: "fire", title: "Streak wager won", body: `Seven more days banked. +${(res.credits ?? 0).toLocaleString()} credits.`, durationMs: 7000 });
        } else if (res.state === "lost") {
          show({ id: `wager_${wager.startDay}`, kind: "info", icon: "fire-off", title: "Streak wager ended", body: "The streak lapsed before day seven. Start a new one any time.", durationMs: 7000 });
        }
      })
      .catch(() => {});
  }, [wager, decided, count, today, show]);

  if (!profile) return null;

  const place = (stake: number) => {
    if (busy) return;
    haptic.medium();
    setBusy(true);
    setErr(null);
    streakWager({ action: "place", stake })
      .catch((e: unknown) => setErr(friendlyError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="fire" size={18} color={c.warning} />
        <Text style={[styles.title, { color: c.foreground }]}>Streak Wager</Text>
        {wager ? <Pill label={`Pays ${(wager.stake * 2).toLocaleString()}`} tone="money" /> : <Pill label="Doubles" tone="money" />}
      </View>
      {wager ? (
        <>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            {days} of {WAGER_DAYS} days banked. Make a pick every day to keep it alive.
          </Text>
          <View style={styles.pips}>
            {Array.from({ length: WAGER_DAYS }, (_, i) => (
              <View key={i} style={[styles.pip, { backgroundColor: i < days ? c.primary : c.secondary }]} />
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            Stake credits that you'll add {WAGER_DAYS} days to your pick streak{alive ? ` (now ${count})` : ""}. Get there and the stake comes back doubled.
            {alive ? "" : " Make a pick today to start it."}
          </Text>
          <View style={styles.row}>
            {STAKES.map((s) => (
              <Button key={s} label={String(s)} size="sm" variant="secondary" disabled={busy || balance < s} onPress={() => place(s)} style={{ flex: 1 }} />
            ))}
          </View>
        </>
      )}
      {err ? <Text style={[styles.body, { color: c.negative }]}>{err}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold", flex: 1 },
  body: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", gap: 8 },
  pips: { flexDirection: "row", gap: 5 },
  pip: { flex: 1, height: 6, borderRadius: 3 },
});

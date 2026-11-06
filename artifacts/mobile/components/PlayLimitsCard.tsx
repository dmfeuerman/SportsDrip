import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ActionChip, Card } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";

const CAPS: Array<number | null> = [null, 5, 10, 20];

/** Optional limits: a daily pick cap and "take a break". Enforced on the server. */
export default function PlayLimitsCard() {
  const c = useColors();
  const { profile, writeProfile } = useApp();
  const cap = profile?.limits?.dailyPicks ?? null;
  const breakUntil = profile?.limits?.breakUntil ?? 0;
  const onBreak = breakUntil > Date.now();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Instant: the chip flips now, the server saves it after (and undoes it with a toast if it refuses).
  const run = (args: Parameters<typeof api.setPlayLimits>[0]) => {
    setErr(null);
    const limits = { ...(profile?.limits ?? {}) };
    if ("dailyPicks" in args) limits.dailyPicks = args.dailyPicks ?? null;
    if (args.breakDays) limits.breakUntil = Date.now() + args.breakDays * 86_400_000;
    writeProfile({ limits }, () => api.setPlayLimits(args));
    haptic.success();
  };

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="Play limits">
      <View style={styles.head}>
        <MaterialCommunityIcons name="timer-sand" size={18} color={c.accent} />
        <Text style={[styles.title, { color: c.foreground }]}>Alerts & Limits</Text>
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {onBreak ? `On a break until ${new Date(breakUntil).toLocaleDateString()}.` : `Daily pick limit: ${cap ?? "none"}.`}
      </Text>
      <View style={styles.row}>
        {CAPS.map((v) => (
          <ActionChip
            key={String(v)}
            label={v === null ? "No limit" : `${v}/day`}
            chevron={false}
            tone={cap === v ? "accent" : "neutral"}
            disabled={busy || cap === v}
            onPress={() => run({ dailyPicks: v })}
          />
        ))}
      </View>
      {!onBreak ? (
        <View style={styles.row}>
          {([1, 7, 30] as const).map((d) => (
            <ActionChip key={d} label={`Break ${d}d`} icon="pause-circle-outline" chevron={false} disabled={busy} onPress={() => run({ breakDays: d })} />
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <ActionChip
          label={profile?.sweatAlerts ? "Live sweat alerts: on" : "Live sweat alerts: off"}
          icon="fire"
          chevron={false}
          tone={profile?.sweatAlerts ? "accent" : "neutral"}
          disabled={busy}
          onPress={() => {
            writeProfile({ sweatAlerts: !profile?.sweatAlerts }, () => api.setAlertPrefs({ sweat: !profile?.sweatAlerts }));
            haptic.tick();
          }}
        />
        <ActionChip
          label={profile?.quietHours === false ? "Quiet hours: off" : "Quiet hours: 11pm–8am"}
          icon="weather-night"
          chevron={false}
          tone={profile?.quietHours === false ? "neutral" : "accent"}
          disabled={busy}
          accessibilityLabel={profile?.quietHours === false ? "Turn quiet hours on" : "Turn quiet hours off"}
          onPress={() => {
            writeProfile({ quietHours: profile?.quietHours === false }, () => api.setAlertPrefs({ quietHours: profile?.quietHours === false }));
            haptic.tick();
          }}
        />
        <ActionChip
          label={profile?.muteTaunts ? "Taunts: muted" : "Taunts: on"}
          icon="human-handsup"
          chevron={false}
          tone={profile?.muteTaunts ? "neutral" : "accent"}
          disabled={busy}
          onPress={() => {
            writeProfile({ muteTaunts: !profile?.muteTaunts }, () => api.setMuteTaunts({ mute: !profile?.muteTaunts }));
            haptic.tick();
          }}
        />
      </View>
      {err ? <Text style={[styles.sub, { color: c.negative }]}>{err}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

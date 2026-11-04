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
  const { profile } = useApp();
  const cap = profile?.limits?.dailyPicks ?? null;
  const breakUntil = profile?.limits?.breakUntil ?? 0;
  const onBreak = breakUntil > Date.now();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (args: Parameters<typeof api.setPlayLimits>[0]) => {
    setBusy(true);
    setErr(null);
    try {
      await api.setPlayLimits(args);
      haptic.success();
    } catch (e) {
      setErr(api.friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="Play limits">
      <View style={styles.head}>
        <MaterialCommunityIcons name="timer-sand" size={18} color={c.accent} />
        <Text style={[styles.title, { color: c.foreground }]}>Alerts & limits</Text>
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
          onPress={async () => {
            setBusy(true);
            try {
              await api.setAlertPrefs({ sweat: !profile?.sweatAlerts });
              haptic.tick();
            } catch (e) {
              setErr(api.friendlyError(e));
            } finally {
              setBusy(false);
            }
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

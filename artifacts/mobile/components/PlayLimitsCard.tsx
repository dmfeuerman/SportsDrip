import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Card, ChoiceDialog, SegmentedControl } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
type Cap = "none" | "5" | "10" | "20";

const CAPS: Array<{ value: Cap; label: string }> = [
  { value: "none", label: "No limit" },
  { value: "5", label: "5/day" },
  { value: "10", label: "10/day" },
  { value: "20", label: "20/day" },
];

/** Optional limits: a daily pick cap and "take a break". Enforced on the server. */
export default function PlayLimitsCard() {
  const c = useColors();
  const { profile, writeProfile } = useApp();
  const cap = profile?.limits?.dailyPicks ?? null;
  const breakUntil = profile?.limits?.breakUntil ?? 0;
  const onBreak = breakUntil > Date.now();
  const [pickBreak, setPickBreak] = useState(false);

  // Instant: the control flips now, the server saves it after (and undoes it with a toast if it refuses).
  const run = (args: Parameters<typeof api.setPlayLimits>[0]) => {
    const limits = { ...(profile?.limits ?? {}) };
    if ("dailyPicks" in args) limits.dailyPicks = args.dailyPicks ?? null;
    if (args.breakDays) limits.breakUntil = Date.now() + args.breakDays * 86_400_000;
    writeProfile({ limits }, () => api.setPlayLimits(args));
    haptic.success();
  };

  const sweat = !!profile?.sweatAlerts;
  const quiet = profile?.quietHours !== false;
  const taunts = !profile?.muteTaunts;

  return (
    <Card style={styles.card} accessibilityLabel="Alerts and limits">
      <View style={styles.block}>
        <Text style={[styles.rowTitle, { color: c.foreground }]}>Daily Pick Limit</Text>
        <SegmentedControl
          value={cap === null ? "none" : (String(cap) as Cap)}
          onChange={(v) => {
            const next = v === "none" ? null : Number(v);
            if (next !== cap) run({ dailyPicks: next });
          }}
          options={CAPS}
        />
      </View>
      <Divider />
      <Row
        icon="pause-circle-outline"
        title="Take a Break"
        sub={onBreak ? `On a break until ${new Date(breakUntil).toLocaleDateString()}` : "Pause picks for 1, 7 or 30 days"}
        onPress={onBreak ? undefined : () => setPickBreak(true)}
      />
      <Divider />
      <ToggleRow
        icon="fire"
        title="Live Sweat Alerts"
        sub="Pings when a game you picked swings"
        value={sweat}
        onChange={(v) => {
          writeProfile({ sweatAlerts: v }, () => api.setAlertPrefs({ sweat: v }));
          haptic.tick();
        }}
      />
      <Divider />
      <ToggleRow
        icon="weather-night"
        title="Quiet Hours"
        sub="No alerts 11pm–8am"
        value={quiet}
        onChange={(v) => {
          writeProfile({ quietHours: v }, () => api.setAlertPrefs({ quietHours: v }));
          haptic.tick();
        }}
      />
      <Divider />
      <ToggleRow
        icon="human-handsup"
        title="Taunts"
        sub="Let friends send you taunts"
        value={taunts}
        onChange={(v) => {
          writeProfile({ muteTaunts: !v }, () => api.setMuteTaunts({ mute: !v }));
          haptic.tick();
        }}
      />

      <ChoiceDialog
        visible={pickBreak}
        title="Take a Break?"
        body="You won't be able to make picks until the break ends."
        actions={([1, 7, 30] as const).map((d) => ({
          label: d === 1 ? "1 Day" : `${d} Days`,
          variant: "secondary" as const,
          onPress: () => {
            setPickBreak(false);
            run({ breakDays: d });
          },
        }))}
        onCancel={() => setPickBreak(false)}
      />
    </Card>
  );
}

function Row({ icon, title, sub, onPress }: { icon: Icon; title: string; sub?: string; onPress?: () => void }) {
  const c = useColors();
  const body = (
    <>
      <MaterialCommunityIcons name={icon} size={20} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
        {sub ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{sub}</Text> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.secondary }]}>
      {body}
    </Pressable>
  );
}

function ToggleRow({ icon, title, sub, value, onChange }: { icon: Icon; title: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={icon} size={20} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
        {sub ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: c.border, true: c.primary }} accessibilityLabel={title} />
    </View>
  );
}

function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 46 }} />;
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  block: { gap: 8, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});

import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import ColorWheelSheet, { hsvToHex } from "@/components/avatar/ColorWheel";
import { useColors } from "@/hooks/useColors";

const tick = () => Haptics.selectionAsync().catch(() => {});

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

/** Five-stop slider for 0..1 traits. Big targets, no drag precision needed. */
export function Stops({ label, value, onChange, ends }: { label: string; value: number; onChange: (v: number) => void; ends?: [string, string] }) {
  const c = useColors();
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const active = stops.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(stops[best]! - value) ? i : best), 0);
  return (
    <Field label={label}>
      <View style={styles.stopRow} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 4, now: active }}>
        {stops.map((s, i) => (
          <Pressable
            key={s}
            accessibilityLabel={`${label} ${i + 1} of 5`}
            onPress={() => {
              tick();
              onChange(s);
            }}
            style={[
              styles.stop,
              { height: 18 + i * 5, backgroundColor: i === active ? c.primary : c.secondary, borderColor: i === active ? c.primary : c.border },
            ]}
          />
        ))}
      </View>
      {ends ? (
        <View style={styles.ends}>
          <Text style={[styles.endText, { color: c.subtleForeground }]}>{ends[0]}</Text>
          <Text style={[styles.endText, { color: c.subtleForeground }]}>{ends[1]}</Text>
        </View>
      ) : null}
    </Field>
  );
}

/**
 * Preset colours plus, last, a custom swatch that opens the colour wheel. A
 * value that isn't a preset shows in the custom swatch, selected.
 */
export function Swatches({ label, options, value, onChange, custom = true }: { label: string; options: string[]; value: string; onChange: (v: string) => void; custom?: boolean }) {
  const c = useColors();
  const [wheel, setWheel] = useState(false);
  const preset = options.some((o) => o.toLowerCase() === value.toLowerCase());
  return (
    <Field label={label}>
      <View style={styles.wrap}>
        {options.map((o) => {
          const on = o.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label} ${o}`}
              onPress={() => {
                tick();
                onChange(o);
              }}
              style={[styles.swatchRing, { borderColor: on ? c.primary : "transparent" }]}
            >
              <View style={[styles.swatch, { backgroundColor: o, borderColor: c.border }]} />
            </Pressable>
          );
        })}
        {custom ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !preset }}
            accessibilityLabel={`${label}: pick a custom colour`}
            onPress={() => {
              tick();
              setWheel(true);
            }}
            style={[styles.swatchRing, { borderColor: !preset ? c.primary : "transparent" }]}
          >
            <View style={styles.swatch}>
              <Svg width={34} height={34} pointerEvents="none">
                {RAINBOW.map((w, i) => (
                  <Path key={i} d={w.d} fill={w.fill} />
                ))}
                <Circle cx={17} cy={17} r={10} fill={preset ? c.card : value} stroke="#FFFFFF" strokeWidth={1.5} />
              </Svg>
              {preset ? (
                <View style={styles.plus} pointerEvents="none">
                  <MaterialCommunityIcons name="plus" size={14} color={c.foreground} />
                </View>
              ) : null}
            </View>
          </Pressable>
        ) : null}
      </View>
      {custom ? <ColorWheelSheet visible={wheel} title={label} value={value} onClose={() => setWheel(false)} onPick={onChange} /> : null}
    </Field>
  );
}

/** The custom swatch's rim: a small colour wheel. */
const RAINBOW = Array.from({ length: 24 }, (_, i) => {
  const R = 17;
  const p = (a: number) => `${(R + R * Math.cos(a)).toFixed(2)} ${(R + R * Math.sin(a)).toFixed(2)}`;
  const a0 = ((i - 0.6) / 24) * Math.PI * 2, a1 = ((i + 0.6) / 24) * Math.PI * 2;
  return { d: `M ${R} ${R} L ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)} Z`, fill: hsvToHex({ h: (i / 24) * 360, s: 0.85, v: 1 }) };
});

export function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <Field label={label}>
      <View style={styles.wrap}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                tick();
                onChange(o.id);
              }}
              style={[styles.chip, { backgroundColor: on ? c.primary : c.secondary, borderColor: on ? c.primary : c.border }]}
            >
              <Text style={[styles.chipText, { color: on ? c.primaryForeground : c.mutedForeground }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  stopRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  stop: { flex: 1, borderRadius: 8, borderWidth: 1 },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  endText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatchRing: { padding: 3, borderRadius: 24, borderWidth: 2 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  plus: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

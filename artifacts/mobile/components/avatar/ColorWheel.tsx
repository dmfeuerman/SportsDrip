import { haptic as buzz } from "@/lib/motion";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import KeyboardSheet from "@/components/KeyboardSheet";
import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

/* ── colour maths ───────────────────────────────────────────────────────── */

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const hex2 = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, "0").toUpperCase();

export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${hex2(f(5))}${hex2(f(3))}${hex2(f(1))}`;
}

export function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, v: 1 };
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export const normalizeHex = (t: string): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(t.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
};

/* ── wheel ──────────────────────────────────────────────────────────────── */

const WEDGES = 72;

/** Hue round the rim, saturation out from the centre (white), brightness as a dark veil. */
function Wheel({ size, hsv, onChange, onEnd }: { size: number; hsv: HSV; onChange: (h: HSV) => void; onEnd?: () => void }) {
  const R = size / 2;
  const wedges = useMemo(() => {
    const out: Array<{ d: string; fill: string }> = [];
    for (let i = 0; i < WEDGES; i++) {
      // Overlap each wedge a little so no hairline gaps show between them.
      const a0 = ((i - 0.6) / WEDGES) * Math.PI * 2;
      const a1 = ((i + 0.6) / WEDGES) * Math.PI * 2;
      const p = (a: number) => `${(R + R * Math.cos(a)).toFixed(2)} ${(R + R * Math.sin(a)).toFixed(2)}`;
      out.push({ d: `M ${R} ${R} L ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)} Z`, fill: hsvToHex({ h: (i / WEDGES) * 360, s: 1, v: 1 }) });
    }
    return out;
  }, [R]);

  const latest = useRef({ hsv, onChange, onEnd });
  latest.current = { hsv, onChange, onEnd };
  const pick = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.locationX - R;
    const dy = e.nativeEvent.locationY - R;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = clamp01(Math.hypot(dx, dy) / R);
    latest.current.onChange({ h, s, v: latest.current.hsv.v || 1 });
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the gesture: the sheet's swipe-to-dismiss must not steal it.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          buzz.tick();
          pick(e);
        },
        onPanResponderMove: pick,
        onPanResponderRelease: () => latest.current.onEnd?.(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [R]
  );

  const a = (hsv.h * Math.PI) / 180;
  const mx = R + Math.cos(a) * hsv.s * R;
  const my = R + Math.sin(a) * hsv.s * R;
  return (
    <View style={{ width: size, height: size }} {...pan.panHandlers} accessibilityLabel="Colour wheel" accessibilityHint="Drag to pick a hue and saturation">
      <Svg width={size} height={size} pointerEvents="none">
        <Defs>
          <RadialGradient id="white" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {wedges.map((w, i) => (
          <Path key={i} d={w.d} fill={w.fill} />
        ))}
        <Circle cx={R} cy={R} r={R} fill="url(#white)" />
        <Circle cx={R} cy={R} r={R} fill="#000000" opacity={1 - hsv.v} />
        <Circle cx={mx} cy={my} r={13} fill={hsvToHex(hsv)} stroke="#FFFFFF" strokeWidth={3} />
        <Circle cx={mx} cy={my} r={14.5} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
      </Svg>
    </View>
  );
}

/** Brightness: black → the picked hue at full value. */
function ValueBar({ hsv, onChange }: { hsv: HSV; onChange: (h: HSV) => void }) {
  const c = useColors();
  const [w, setW] = useState(1);
  const latest = useRef({ hsv, onChange, w });
  latest.current = { hsv, onChange, w };
  const pick = (e: GestureResponderEvent) => latest.current.onChange({ ...latest.current.hsv, v: clamp01(e.nativeEvent.locationX / latest.current.w) });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: pick,
        onPanResponderMove: pick,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  return (
    <View
      style={[styles.bar, { borderColor: c.border }]}
      onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}
      {...pan.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Brightness"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(hsv.v * 100) }}
    >
      <LinearGradient pointerEvents="none" colors={["#000000", hsvToHex({ ...hsv, v: 1 })]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
      <View pointerEvents="none" style={[styles.thumb, { left: hsv.v * w - 12, backgroundColor: hsvToHex(hsv) }]} />
    </View>
  );
}

/**
 * A full colour picker in a bottom sheet: wheel (hue + saturation), a
 * brightness bar and a hex field. Nothing is applied until "Use colour".
 */
export default function ColorWheelSheet({
  visible,
  title,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onPick: (hex: string) => void;
}) {
  const c = useColors();
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [text, setText] = useState(value.toUpperCase());
  useEffect(() => {
    if (!visible) return;
    setHsv(hexToHsv(value));
    setText(value.toUpperCase());
  }, [visible, value]);

  const hex = hsvToHex(hsv);
  const set = (h: HSV) => {
    setHsv(h);
    setText(hsvToHex(h));
  };
  const typed = normalizeHex(text);

  return (
    <KeyboardSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
          <View style={[styles.preview, { backgroundColor: hex, borderColor: c.border }]} />
        </View>
        <View style={styles.center}>
          <Wheel size={240} hsv={hsv} onChange={set} />
        </View>
        <ValueBar hsv={hsv} onChange={set} />
        <View style={styles.hexRow}>
          <Text style={[styles.hexLabel, { color: c.mutedForeground }]}>HEX</Text>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              const n = normalizeHex(t);
              if (n) setHsv(hexToHsv(n));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            placeholder="#A1B2C3"
            placeholderTextColor={c.subtleForeground}
            style={[styles.hexInput, { color: c.foreground, borderColor: typed ? c.border : c.negative, backgroundColor: c.secondary }]}
            accessibilityLabel="Hex colour"
          />
        </View>
        <Button
          label="Use Colour"
          onPress={() => {
            onPick(hex);
            onClose();
          }}
        />
      </View>
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16, paddingBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  preview: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  center: { alignItems: "center" },
  bar: { height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "visible", justifyContent: "center" },
  thumb: { position: "absolute", width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: "#FFFFFF" },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hexLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  hexInput: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

import { create } from "qrcode";
import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

/** Quiet zone in modules on every side; scanners need at least 4. */
const QUIET = 4;
/**
 * Fixed ink and paper rather than theme tokens: phone cameras expect dark
 * modules on a light ground, and an inverted code fails to scan in dark mode.
 */
const INK = "#0B0F19";
const PAPER = "#FFFFFF";

/** A QR code for an invite link, drawn as one SVG path (no native module). */
export default function InviteQR({ value, size = 176, accessibilityLabel }: { value: string; size?: number; accessibilityLabel?: string }) {
  const { d, extent } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    const n = modules.size;
    let path = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules.get(y, x)) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return { d: path, extent: n + QUIET * 2 };
  }, [value]);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? "QR code"} style={{ borderRadius: 12, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`}>
        <Rect x={0} y={0} width={extent} height={extent} fill={PAPER} />
        <Path d={d} fill={INK} />
      </Svg>
    </View>
  );
}

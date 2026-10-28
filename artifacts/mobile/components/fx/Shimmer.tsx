import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * A diagonal sheen that sweeps across its parent every few seconds — the
 * "this is the button" glint on primary CTAs and the first-place card.
 * Absolutely fills the parent; the parent should clip (overflow: hidden).
 */
export default function Shimmer({
  color = "#FFFFFF",
  intensity = 0.32,
  every = 2800,
  sweep = 900,
  style,
}: {
  color?: string;
  intensity?: number;
  /** Pause between sweeps, ms. */
  every?: number;
  /** Duration of one sweep, ms. */
  sweep?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [w, setW] = useState(0);
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!w || reduced) return;
    t.value = 0;
    t.value = withRepeat(withDelay(every, withTiming(1, { duration: sweep, easing: Easing.inOut(Easing.quad) })), -1, false);
    return () => cancelAnimation(t);
  }, [w, every, sweep, reduced, t]);
  const band = Math.max(60, w * 0.45);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: -band + t.value * (w + band * 2) }, { skewX: "-20deg" }] }));
  const rgba = (a: number) => hexA(color, a);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && !reduced ? (
        <Animated.View style={[{ position: "absolute", top: -10, bottom: -10, width: band }, anim]}>
          <LinearGradient colors={[rgba(0), rgba(intensity), rgba(0)] as const} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

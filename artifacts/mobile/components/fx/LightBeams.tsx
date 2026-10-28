import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";

/**
 * Slowly turning god-rays behind a reveal. Pure decoration: absolutely
 * centred in its parent, never takes touches.
 */
export default function LightBeams({ color, size = 420, beams = 14, opacity = 0.55 }: { color: string; size?: number; beams?: number; opacity?: number }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(withTiming(360, { duration: 14_000, easing: Easing.linear }), -1, false);
    breathe.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      cancelAnimation(turn);
      cancelAnimation(breathe);
    };
  }, [reduced, turn, breathe]);
  const anim = useAnimatedStyle(() => ({
    opacity: opacity * (0.75 + 0.25 * breathe.value),
    transform: [{ rotate: `${turn.value}deg` }, { scale: 0.94 + 0.08 * breathe.value }],
  }));

  const R = size / 2;
  const half = (Math.PI / beams) * 0.42;
  const d = Array.from({ length: beams }, (_, i) => {
    const a = (i / beams) * Math.PI * 2;
    const p = (ang: number) => `${(R + R * Math.cos(ang)).toFixed(1)} ${(R + R * Math.sin(ang)).toFixed(1)}`;
    return `M ${R} ${R} L ${p(a - half)} L ${p(a + half)} Z`;
  }).join(" ");

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      <Animated.View style={[{ width: size, height: size }, anim]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="beam" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity="0.95" />
              <Stop offset="0.55" stopColor={color} stopOpacity="0.35" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Path d={d} fill="url(#beam)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: "center", justifyContent: "center" } });

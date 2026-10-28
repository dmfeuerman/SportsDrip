import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

interface Particle {
  angle: number;
  speed: number;
  size: number;
  color: string;
  spin: number;
  round: boolean;
  drag: number;
}

/**
 * A confetti burst from a point. Every particle reads one shared progress
 * value, so a 48-piece burst is one animation on the UI thread, not 48.
 * Fires on mount and again whenever `trigger` changes.
 */
export default function Burst({
  colors,
  trigger = 0,
  count = 44,
  power = 1,
  duration = 1500,
  originY = 0.5,
}: {
  colors: string[];
  trigger?: number | string;
  count?: number;
  /** Scales how far the pieces fly. */
  power?: number;
  duration?: number;
  /** Vertical origin as a fraction of the container's height. */
  originY?: number;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  const parts = useMemo<Particle[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
        speed: (110 + Math.random() * 170) * power,
        size: 5 + Math.random() * 7,
        color: colors[i % colors.length]!,
        spin: (Math.random() - 0.5) * 900,
        round: Math.random() < 0.35,
        drag: 0.55 + Math.random() * 0.35,
      })),
    // A fresh scatter for every trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, power, colors.join(","), trigger]
  );
  useEffect(() => {
    if (reduced) return;
    p.value = 0;
    p.value = withTiming(1, { duration, easing: Easing.out(Easing.quad) });
  }, [trigger, duration, reduced, p]);

  if (reduced) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.origin, { top: `${originY * 100}%` }]}>
        {parts.map((pt, i) => (
          <Piece key={`${trigger}-${i}`} pt={pt} p={p} />
        ))}
      </View>
    </View>
  );
}

function Piece({ pt, p }: { pt: Particle; p: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = p.value;
    // Out fast, slowing under drag, then gravity pulls it down.
    const r = pt.speed * (1 - Math.pow(1 - t, 2)) * pt.drag;
    const x = Math.cos(pt.angle) * r;
    const y = Math.sin(pt.angle) * r + 260 * t * t;
    return {
      opacity: t === 0 ? 0 : 1 - Math.pow(t, 2.4),
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${pt.spin * t}deg` }, { scale: 1 - 0.35 * t }],
    };
  });
  return (
    <Animated.View
      style={[
        { position: "absolute", width: pt.size, height: pt.round ? pt.size : pt.size * 0.45, borderRadius: pt.round ? pt.size / 2 : 1.5, backgroundColor: pt.color, left: -pt.size / 2, top: -pt.size / 2 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  origin: { position: "absolute", left: "50%", width: 0, height: 0 },
});

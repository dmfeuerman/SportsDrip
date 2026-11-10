import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SPRING } from "@/lib/motion";

/**
 * Screen / card shake. `shake(1)` is a jolt; `shake(2)` the big-win rattle.
 */
export function useShake() {
  const x = useSharedValue(0);
  const r = useSharedValue(0);
  const reduced = useReducedMotion();
  const shake = useCallback(
    (intensity = 1) => {
      if (reduced) return;
      const a = 7 * intensity;
      x.value = withSequence(
        withTiming(-a, { duration: 45 }),
        withTiming(a, { duration: 70 }),
        withTiming(-a * 0.7, { duration: 65 }),
        withTiming(a * 0.45, { duration: 60 }),
        withTiming(-a * 0.2, { duration: 55 }),
        withSpring(0, SPRING.snappy)
      );
      r.value = withSequence(withTiming(-1.2 * intensity, { duration: 60 }), withTiming(1 * intensity, { duration: 90 }), withSpring(0, SPRING.snappy));
    },
    [reduced, x, r]
  );
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { rotate: `${r.value}deg` }] }));
  return { style, shake };
}

/**
 * Line-movement flash for a number that updates live (odds): a green pulse
 * and ▲ when it goes up, red and ▼ when it goes down, fading after ~2.5 s.
 */
export function useValueFlash(value: number, { up = "#2EE6A6", down = "#FF5A5F", rest = "rgba(0,0,0,0)" } = {}) {
  const prev = useRef(value);
  const pulse = useSharedValue(0);
  const dirSV = useSharedValue(0);
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (value === prev.current) return;
    const d = value > prev.current ? 1 : -1;
    prev.current = value;
    dirSV.value = d;
    setDir(d);
    pulse.value = reduced ? 0 : withSequence(withTiming(1, { duration: 120 }), withTiming(0.35, { duration: 260 }), withTiming(1, { duration: 200 }), withTiming(0, { duration: 1800 }));
    const t = setTimeout(() => setDir(0), 2600);
    return () => clearTimeout(t);
  }, [value, reduced, pulse, dirSV]);
  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(pulse.value, [0, 1], [rest, dirSV.value > 0 ? up : down]),
    shadowColor: dirSV.value > 0 ? up : down,
    shadowOpacity: pulse.value * 0.6,
    shadowRadius: 8 * pulse.value,
  }));
  return { style, dir };
}

/** A soft endless breathe (0 → 1 → 0) for idle prize boxes and glowing rings. */
export function useBreathe(active = true, period = 2200) {
  const t = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 200 });
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: period / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [active, period, reduced, t]);
  return t;
}

import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { EASE, haptic } from "@/lib/motion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * A slot-machine number: each digit is a reel that rolls to its new value,
 * the ones place first and the higher places a beat later, with a green or
 * red glow behind the number for a rise or a fall. All on the UI thread.
 *
 * The font size must be in `style` (it sizes the reels).
 */
export default function RollingNumber({
  value,
  style,
  prefix = "",
  duration = 750,
  flash = true,
  upColor = "#2EE6A6",
  downColor = "#FF4D63",
  accessibilityLabel,
  haptics = flash,
  format,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  prefix?: string;
  duration?: number;
  flash?: boolean;
  upColor?: string;
  downColor?: string;
  accessibilityLabel?: string;
  /** Tick-tick-click as the number climbs (increases only). Defaults to `flash`. */
  haptics?: boolean;
  /** Custom text for the value (e.g. compact 8.5K); defaults to a grouped integer. */
  format?: (value: number) => string;
}) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = flat.fontSize ?? 16;
  const lh = Math.round(fontSize * 1.22);
  const text = `${prefix}${format ? format(value) : Math.round(value).toLocaleString()}`;
  const chars = text.split("");

  const prev = useRef(value);
  const glow = useSharedValue(0);
  const dir = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (value === prev.current) return;
    dir.value = value > prev.current ? 1 : -1;
    if (haptics && value > prev.current) haptic.roll(duration);
    prev.current = value;
    if (flash && !reduced) glow.value = withSequence(withTiming(1, { duration: 140 }), withDelay(duration * 0.6, withTiming(0, { duration: 600 })));
  }, [value, flash, haptics, duration, reduced, glow, dir]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.28,
    backgroundColor: dir.value > 0 ? upColor : downColor,
  }));

  const textStyle: StyleProp<TextStyle> = [style, { lineHeight: lh, height: lh, fontVariant: ["tabular-nums"] }];
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? text} style={styles.row}>
      {flash ? <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} /> : null}
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        const d = DIGITS.indexOf(ch);
        // Keyed from the right so a reel keeps its identity when the number grows a digit.
        return d >= 0 ? (
          <Reel key={`r${fromRight}`} digit={d} lh={lh} delay={(fromRight - 1) * 55} duration={duration} reduced={reduced} style={textStyle} />
        ) : (
          <Text key={`s${fromRight}`} style={textStyle} importantForAccessibility="no">
            {ch}
          </Text>
        );
      })}
    </View>
  );
}

function Reel({ digit, lh, delay, duration, reduced, style }: { digit: number; lh: number; delay: number; duration: number; reduced: boolean; style: StyleProp<TextStyle> }) {
  const y = useSharedValue(-digit * lh);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      y.value = -digit * lh;
      return;
    }
    y.value = reduced ? -digit * lh : withDelay(delay, withTiming(-digit * lh, { duration, easing: EASE.out }));
  }, [digit, lh, delay, duration, reduced, y]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: lh, overflow: "hidden" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={anim}>
        {DIGITS.map((d) => (
          <Text key={d} style={style}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  glow: { position: "absolute", left: -6, right: -6, top: -2, bottom: -2, borderRadius: 8 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { Easing, useSharedValue, useAnimatedStyle, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { onSoonPill, type SoonPill } from "@/lib/soonPill";

const FADE_IN = 350;
const HOLD = 3200;
const FADE_OUT = 500;
/** Clears the tab bar. */
const TAB_BAR = 72;

/** One small pill at a time, above the tab bar. Never takes touches. */
export default function GameSoonPill() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<SoonPill | null>(null);
  const queue = useRef<SoonPill[]>([]);
  const busy = useRef(false);
  const opacity = useSharedValue(0);

  const next = () => {
    const p = queue.current.shift();
    if (!p) {
      busy.current = false;
      setCurrent(null);
      return;
    }
    busy.current = true;
    setCurrent(p);
    opacity.value = 0;
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN, easing: Easing.out(Easing.quad) }),
      withDelay(HOLD, withTiming(0, { duration: FADE_OUT, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(next);
      }))
    );
  };

  useEffect(
    () =>
      onSoonPill((p) => {
        queue.current.push(p);
        if (!busy.current) next();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!current) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.pill, { bottom: insets.bottom + TAB_BAR, backgroundColor: colors.elevated, borderColor: colors.border }, style]}
    >
      <MaterialCommunityIcons name={current.icon as never} size={13} color={colors.mutedForeground} />
      <Text style={[styles.league, { color: colors.mutedForeground }]}>{current.league}</Text>
      <Text style={[styles.teams, { color: colors.foreground }]}>
        {current.away} vs {current.home}
      </Text>
      <Text style={[styles.league, { color: colors.subtleForeground }]}>· {current.minutes}m</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 50,
  },
  league: { fontSize: 11, fontWeight: "600" },
  teams: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
});

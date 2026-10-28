import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import BetLockedOverlay from "@/components/fx/BetLockedOverlay";
import { Amount } from "@/components/ui";
import { useToast, type Toast, type ToastKind } from "@/context/ToastContext";
import { useColors, type Colors } from "@/hooks/useColors";
import { haptic, SPRING } from "@/lib/motion";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const KIND: Record<ToastKind, { icon: IconName; color: (c: Colors) => string; buzz: () => void }> = {
  win: { icon: "cash-multiple", color: (c) => c.positive, buzz: haptic.success },
  live: { icon: "fire", color: () => "#FF8A3D", buzz: haptic.medium },
  league: { icon: "trophy-outline", color: (c) => c.league, buzz: haptic.light },
  social: { icon: "account-group-outline", color: (c) => c.accent, buzz: haptic.light },
  loan: { icon: "hand-coin-outline", color: (c) => c.debt, buzz: haptic.light },
  warning: { icon: "alert-outline", color: (c) => c.warning, buzz: haptic.warning },
  info: { icon: "bell-outline", color: (c) => c.accent, buzz: haptic.tick },
};

const OFF = -180;

/**
 * Draws the toast queue: one banner at a time sliding down from the top,
 * with a draining progress bar for its timer. Swipe it up or sideways to
 * dismiss (the timer pauses while your finger is on it); tap to go to the
 * bet, league or profile it's about. Also hosts the "Bet locked in" overlay.
 */
export default function ToastHost() {
  const { current, queued, dismiss, locked, clearLocked } = useToast();
  return (
    <>
      {current ? <ToastCard key={current.id} toast={current} queued={queued} onGone={() => dismiss(current.id)} /> : null}
      {locked ? <BetLockedOverlay key={locked.key} bet={locked} onDone={clearLocked} /> : null}
    </>
  );
}

function ToastCard({ toast, queued, onGone }: { toast: Toast; queued: number; onGone: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const kind = KIND[toast.kind];
  const tone = toast.color ?? kind.color(c);

  const y = useSharedValue(OFF);
  const x = useSharedValue(0);
  const life = useSharedValue(1); // 1 → 0 as the timer runs out
  const held = useSharedValue(0);

  const startTimer = (fromLife: number) => {
    "worklet";
    life.value = withTiming(0, { duration: toast.durationMs * fromLife, easing: Easing.linear }, (done) => {
      if (done) {
        y.value = withTiming(OFF, { duration: 200 }, (ok) => {
          if (ok) scheduleOnRN(onGone);
        });
      }
    });
  };

  useEffect(() => {
    kind.buzz();
    AccessibilityInfo.announceForAccessibility(`${toast.title}${toast.body ? `. ${toast.body}` : ""}`);
    y.value = reduced ? 0 : withSpring(0, SPRING.pop);
    startTimer(1);
    return () => cancelAnimation(life);
    // Once per toast (the host keys the card by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hide = (dx = 0) => {
    cancelAnimation(life);
    if (dx) x.value = withTiming(dx, { duration: 180 }, (ok) => ok && scheduleOnRN(onGone));
    else y.value = withTiming(OFF, { duration: 180 }, (ok) => ok && scheduleOnRN(onGone));
  };

  const pan = usePanGesture({
    minDistance: 6,
    onBegin: () => {
      "worklet";
      held.value = withSpring(1, SPRING.snappy);
      cancelAnimation(life);
    },
    onUpdate: (e) => {
      "worklet";
      // Up moves freely; down only stretches a little (rubber band).
      y.value = e.translationY < 0 ? e.translationY : e.translationY * 0.18;
      x.value = e.translationX;
    },
    onDeactivate: (e) => {
      "worklet";
      if (y.value < -38 || e.velocityY < -600) {
        y.value = withTiming(OFF, { duration: 160 }, (ok) => {
          if (ok) scheduleOnRN(onGone);
        });
      } else if (Math.abs(x.value) > 110 || Math.abs(e.velocityX) > 900) {
        const out = (x.value > 0 || e.velocityX > 0 ? 1 : -1) * 520;
        x.value = withTiming(out, { duration: 170 }, (ok) => {
          if (ok) scheduleOnRN(onGone);
        });
      } else {
        x.value = withSpring(0, SPRING.pop);
        y.value = withSpring(0, SPRING.pop);
        startTimer(Math.max(0.35, life.value));
      }
    },
    onFinalize: () => {
      "worklet";
      held.value = withSpring(0, SPRING.snappy);
    },
  });

  const card = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(x.value) / 360) - Math.min(0.6, Math.max(0, -y.value - 60) / 200),
    transform: [{ translateY: y.value }, { translateX: x.value }, { scale: 1 - 0.025 * held.value }],
  }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: life.value }] }));

  const tappable = !!(toast.href || toast.onPress);
  const open = () => {
    hide();
    haptic.tick();
    if (toast.onPress) toast.onPress();
    else if (toast.href) router.navigate(toast.href);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(tone, 0.55), shadowColor: c.shadow }, card]}>
          <Pressable
            accessibilityRole={tappable ? "button" : "text"}
            accessibilityLabel={`${toast.title}${toast.body ? `. ${toast.body}` : ""}${toast.cta ? `. ${toast.cta}` : ""}`}
            accessibilityHint="Swipe up to dismiss"
            onPress={tappable ? open : undefined}
            style={styles.row}
          >
            <View style={[styles.icon, { backgroundColor: c.alpha(tone, 0.16), borderColor: c.alpha(tone, 0.4) }]}>
              <MaterialCommunityIcons name={toast.icon ?? kind.icon} size={20} color={tone} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
                {toast.title}
              </Text>
              {toast.body ? (
                <Text style={[styles.body, { color: c.mutedForeground }]} numberOfLines={2}>
                  {toast.body}
                </Text>
              ) : null}
            </View>
            {toast.amount ? (
              <Amount value={toast.amount.value} currency={toast.amount.currency} signed size="md" tone={toast.amount.value >= 0 ? "positive" : "negative"} />
            ) : toast.cta ? (
              <Text style={[styles.cta, { color: tone }]}>{toast.cta}</Text>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} onPress={() => hide()}>
              <MaterialCommunityIcons name="close" size={16} color={c.subtleForeground} />
            </Pressable>
          </Pressable>
          <View style={[styles.track, { backgroundColor: c.alpha(tone, 0.12) }]}>
            <Animated.View style={[styles.fill, { backgroundColor: tone }, bar]} />
          </View>
          {queued > 0 ? <View style={[styles.stack, { backgroundColor: c.card, borderColor: c.border }]} /> : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 10, right: 10, zIndex: 2000, elevation: 30 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "visible",
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },
  body: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
  cta: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  track: { height: 3, marginHorizontal: 14, marginBottom: 8, borderRadius: 2, overflow: "hidden" },
  // Scaled from the left edge as the timer drains.
  fill: { height: 3, width: "100%", transformOrigin: "left" },
  // A sliver of the next banner peeking out under this one.
  stack: { position: "absolute", left: 14, right: 14, bottom: -5, height: 8, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: 1, borderTopWidth: 0, zIndex: -1 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeIn, useReducedMotion, useSharedValue, useAnimatedStyle, withDelay, withSpring, withTiming, Easing } from "react-native-reanimated";
import Burst from "@/components/fx/Burst";
import { Button } from "@/components/ui";
import { GlassModalSurface } from "@/components/ui/LiquidGlass";
import { useColors } from "@/hooks/useColors";
import { useOverlayTurn, OVERLAY } from "@/lib/overlayTurns";
import { haptic, SPRING } from "@/lib/motion";

let fire: ((n: number) => void) | null = null;
/** Shows the "credits added" popup after a watched video is confirmed. */
export function showCreditsEarned(amount: number) {
  fire?.(amount);
}

/** Mounted once for a signed-in player (GlobalHosts). */
export default function CreditsEarnedPopup() {
  const [amount, setAmount] = useState<number | null>(null);
  const myTurn = useOverlayTurn("creditsEarned", amount !== null, OVERLAY.creditsEarned);
  useEffect(() => {
    fire = (n) => setAmount(n);
    return () => {
      fire = null;
    };
  }, []);
  if (amount === null || !myTurn) return null;
  return <CreditsEarned amount={amount} onClose={() => setAmount(null)} />;
}

function CreditsEarned({ amount, onClose }: { amount: number; onClose: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? amount : 0);
  const pop = useSharedValue(reduced ? 1 : 0);
  const spin = useSharedValue(0);
  const colors = useMemo(() => [c.primary, c.accent, "#FFC23D", "#FFFFFF"], [c.primary, c.accent]);

  useEffect(() => {
    haptic.celebrate(true);
    if (reduced) return;
    pop.value = withSpring(1, SPRING.bouncy);
    spin.value = withDelay(200, withTiming(4, { duration: 1100, easing: Easing.out(Easing.cubic) }));
    const start = Date.now();
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - start - 250) / 900);
      if (p <= 0) return;
      setShown(Math.round(amount * p));
      if (p >= 1) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [amount, reduced, pop, spin]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.5 + pop.value * 0.5 }], opacity: Math.min(1, pop.value * 1.5) }));
  const coinStyle = useAnimatedStyle(() => ({ transform: [{ rotateY: `${spin.value * 360}deg` }] }));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        {Platform.OS !== "web" ? (
          <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(4, 6, 12, 0.64)" }]} />
        <Burst colors={colors} count={44} power={1.1} duration={1500} originY={0.42} />
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <GlassModalSurface id="credits_earned" glowColor={c.primary} style={styles.card}>
            <Animated.View style={[styles.coin, { backgroundColor: c.primary }, coinStyle]}>
              <MaterialCommunityIcons name="lightning-bolt" size={34} color={c.primaryForeground} />
            </Animated.View>
            <Animated.Text entering={FadeInDown.delay(150).duration(320)} style={[styles.kicker, { color: c.primary }]}>
              CREDITS ADDED
            </Animated.Text>
            <Text style={[styles.amount, { color: c.foreground }]} accessibilityLiveRegion="polite">
              +{shown.toLocaleString("en-US")}
            </Text>
            <Animated.View entering={FadeIn.delay(700).duration(300)} style={{ alignSelf: "stretch" }}>
              <Button label="Nice" onPress={onClose} />
            </Animated.View>
          </GlassModalSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  cardWrap: { width: "100%", maxWidth: 340 },
  card: { padding: 24, alignItems: "center", gap: 10 },
  coin: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  kicker: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 1.8 },
  amount: { fontSize: 46, fontFamily: "Inter_900Black", letterSpacing: -1.5, fontVariant: ["tabular-nums"], marginBottom: 8 },
});

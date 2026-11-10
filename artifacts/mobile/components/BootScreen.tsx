import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import HouseLogo, { BRAND } from "@/components/brand/HouseLogo";
import { BOOT_WINDOW } from "@/constants/ads";
import { bootElapsed, evaluateBoot, isBootReady, useBootDone } from "@/lib/bootGate";
import { BootBanner } from "@/components/ads/BannerSlot";

const TIPS = [
  "Every bet is on the house — no real money, ever.",
  "Open the app daily for a free 100-credit bet.",
  "Watch a short video any time for bonus credits.",
  "Parlays pay more — and bust harder.",
  "Invite a friend with your code for a bonus.",
  "Prize boxes refill — check Home after every win.",
  "Your birthday month brings a 500-credit gift.",
];
const TIP_MS = 3_500;

/**
 * Launch loading screen, drawn over the whole app on a cold start. Holds for
 * at least 10s and at most 30s (lib/bootGate) while the app loads beneath it;
 * the launch app-open ad (AdsContext) is shown on top of it.
 */
export default function BootScreen() {
  const done = useBootDone();
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));

  // Ticker: decides when the window closes and walks the bar toward 95%.
  useEffect(() => {
    const id = setInterval(() => {
      if (evaluateBoot()) return clearInterval(id);
      const t = bootElapsed();
      const target = isBootReady()
        ? Math.min(0.95, t / BOOT_WINDOW.minMs)
        : Math.min(0.9, (t / BOOT_WINDOW.maxMs) * 1.6);
      Animated.timing(bar, { toValue: target, duration: 240, easing: Easing.linear, useNativeDriver: false }).start();
    }, 250);
    return () => clearInterval(id);
  }, [bar]);

  useEffect(() => {
    const id = setInterval(() => setTip((i) => (i + 1) % TIPS.length), TIP_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!done) return;
    Animated.sequence([
      Animated.timing(bar, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start(() => setGone(true));
  }, [done, bar, fade]);

  if (gone) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]} pointerEvents={done ? "none" : "auto"}>
      <HouseLogo size={128} variant="dark" />
      <View style={styles.bottom}>
        <View style={styles.track}>
          <Animated.View
            style={[styles.fill, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
          />
        </View>
        <Text style={styles.tip} numberOfLines={2}>
          {TIPS[tip]}
        </Text>
      </View>
      <BootBanner />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BRAND.deepFelt, alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000 },
  bottom: { position: "absolute", left: 40, right: 40, bottom: 96, alignItems: "center", gap: 14 },
  track: { width: "100%", height: 6, borderRadius: 3, backgroundColor: "rgba(245,197,66,0.18)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: BRAND.gold },
  tip: { color: BRAND.muted, fontSize: 14, lineHeight: 20, textAlign: "center", fontFamily: "Inter_500Medium", minHeight: 40 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { LevelBadge } from "@/components/LevelBar";
import { Button } from "@/components/ui";
import { levelFromXp, progressOf } from "@/constants/progression";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import { OVERLAY, useOverlayTurn } from "@/lib/overlayTurns";

type Gain = { from: number; to: number };
const KEY = (uid: string) => `sportdrip.xpSeen.v1.${uid}`;
const STEPS = 80;
const COINS = 10;

let push: ((g: Gain) => void) | null = null;

/**
 * Watches the server-owned XP. When it rises (a win, a purchase, a prize box),
 * the screen greys out and the XP bar grows while coins fly into it. Plays once
 * per gain and remembers per account what it has shown, like the level-up.
 */
export default function XpGainHost() {
  const { profile } = useApp();
  const uid = profile?.uid ?? null;
  const xp = typeof profile?.xp === "number" ? profile.xp : null;
  const [seen, setSeen] = useState<number | null>(null);
  const [gain, setGain] = useState<Gain | null>(null);
  const myTurn = useOverlayTurn("xpGain", !!gain, OVERLAY.xpGain);

  useEffect(() => {
    push = (g) => setGain(g);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    AsyncStorage.getItem(KEY(uid))
      .then((v) => live && setSeen(v === null ? -1 : Number(v) || 0))
      .catch(() => live && setSeen(-1));
    return () => {
      live = false;
    };
  }, [uid]);

  useEffect(() => {
    if (!uid || seen === null || xp === null || gain) return;
    if (seen < 0) {
      setSeen(xp);
      AsyncStorage.setItem(KEY(uid), String(xp)).catch(() => {});
    } else if (xp > seen) setGain({ from: seen, to: xp });
    else if (xp < seen) {
      setSeen(xp);
      AsyncStorage.setItem(KEY(uid), String(xp)).catch(() => {});
    }
  }, [uid, seen, xp, gain]);

  const close = () => {
    if (uid && gain) AsyncStorage.setItem(KEY(uid), String(gain.to)).catch(() => {});
    if (gain) setSeen(gain.to);
    setGain(null);
  };

  if (!gain || !myTurn) return null;
  return <XpGain from={gain.from} to={gain.to} onClose={close} />;
}

export function XpGain({ from, to, onClose }: Gain & { onClose: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const gained = to - from;
  const duration = Math.min(2600, 900 + gained * 4);

  // Pre-computed bar fill and XP at each step, so the worklet only interpolates.
  const { inRange, pcts, xps } = useMemo(() => {
    const inRange: number[] = [];
    const pcts: number[] = [];
    const xps: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const v = Math.round(from + (gained * i) / STEPS);
      inRange.push(i / STEPS);
      pcts.push(progressOf(v).pct);
      xps.push(v);
    }
    return { inRange, pcts, xps };
  }, [from, gained]);

  const t = useSharedValue(reduced ? 1 : 0);
  const [shownXp, setShownXp] = useState(reduced ? to : from);
  const [done, setDone] = useState(!!reduced);

  useEffect(() => {
    haptic.tick();
    if (reduced) return;
    t.value = withDelay(
      350,
      withTiming(1, { duration, easing: Easing.out(Easing.quad) }, (fin) => {
        if (fin) {
          runOnJS(setDone)(true);
        }
      })
    );
  }, [reduced, t, duration]);

  useAnimatedReaction(
    () => Math.round(t.value * STEPS),
    (idx, prev) => {
      if (idx !== prev) runOnJS(setShownXp)(xps[idx]!);
    },
    [xps]
  );

  const barStyle = useAnimatedStyle(() => ({ width: `${interpolate(t.value, inRange, pcts) * 100}%` }));

  const p = progressOf(shownXp);
  const crossed = levelFromXp(to) > levelFromXp(from);
  const coins = useMemo(
    () => Array.from({ length: COINS }, (_, i) => ({ x: (Math.random() - 0.5) * 280, y: -170 - Math.random() * 130, delay: 380 + i * 70 })),
    []
  );

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={done ? onClose : undefined}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Animated.Text entering={FadeIn.duration(250)} style={[styles.kicker, { color: c.primary }]}>
            XP EARNED
          </Animated.Text>
          <Text style={[styles.gain, { color: c.foreground }]}>+{gained.toLocaleString("en-US")} XP</Text>

          <View style={styles.levelRow}>
            <LevelBadge level={p.level} size={56} glow />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.level, { color: c.foreground }]}>
                {p.maxed ? "Max level" : `Level ${p.level}`}
                {crossed && done ? "  ·  LEVEL UP" : ""}
              </Text>
              <View>
                <View style={[styles.track, { backgroundColor: c.alpha(c.foreground, 0.12) }]}>
                  <Animated.View style={[styles.fill, { backgroundColor: c.primary }, barStyle]} />
                </View>
                {reduced
                  ? null
                  : coins.map((k, i) => <Coin key={i} x={k.x} y={k.y} delay={k.delay} duration={640} />)}
              </View>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                {p.maxed ? `${p.xp.toLocaleString("en-US")} XP` : `${p.into.toLocaleString("en-US")} / ${p.needed.toLocaleString("en-US")} XP`}
              </Text>
            </View>
          </View>

          <View style={{ alignSelf: "stretch", marginTop: 8, minHeight: 48 }}>
            {done ? (
              <Animated.View entering={FadeIn.duration(260)}>
                <Button label="Nice" onPress={onClose} />
              </Animated.View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Coin({ x, y, delay, duration }: { x: number; y: number; delay: number; duration: number }) {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withDelay(delay, withTiming(1, { duration, easing: Easing.in(Easing.cubic) }));
  }, [delay, duration, k]);
  const style = useAnimatedStyle(() => ({
    opacity: k.value < 0.92 ? 1 : (1 - k.value) * 12,
    transform: [{ translateX: x * (1 - k.value) }, { translateY: y * (1 - k.value) }, { scale: 1 - k.value * 0.5 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.coin, style]}>
      <MaterialCommunityIcons name="lightning-bolt" size={13} color="#4A2E00" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(4, 5, 8, 0.8)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 360, gap: 14, alignItems: "center", paddingVertical: 8 },
  kicker: { fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 3 },
  gain: { fontSize: 40, fontFamily: "Inter_900Black", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 14, alignSelf: "stretch", marginTop: 6 },
  level: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  track: { height: 14, borderRadius: 7, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 7 },
  sub: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  coin: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    backgroundColor: "#FFC23D",
    borderWidth: 2,
    borderColor: "#FFE38A",
    alignItems: "center",
    justifyContent: "center",
  },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import RollingNumber from "@/components/fx/RollingNumber";
import Shimmer from "@/components/fx/Shimmer";
import { Button, CloseButton } from "@/components/ui";
import type { BoxTier } from "@/lib/api";
import { BOX_DISPLAY } from "@/constants/prizeTypes";
import { CHARGE_MS } from "@/components/PrizeBox";
import { useColors } from "@/hooks/useColors";
import { useBreathe, useShake } from "@/hooks/useMotion";
import { EASE, haptic, REWARD_RARITY, rewardRarity, SPRING } from "@/lib/motion";

interface Props {
  visible: boolean;
  tier: BoxTier;
  /**
   * The reward the SERVER decided, in credits. Null while the claim callable is
   * still in flight. The wheel is pure theatre: it spins to whatever the
   * server already committed to the ledger (the client never picks a prize).
   */
  rewardCredits: number | null;
  error: string | null;
  onClose: () => void;
  /** Opening: the box rattles in the middle of the overlay until the server's result is in. */
  charging?: boolean;
}

const SIZE = 290;
const C = SIZE / 2;
const R = SIZE / 2 - 14;
const SPIN_MS = 5600;
/** Even deceleration: the last quarter-turn takes ~1/5 of the spin, not most of it. */
const WHEEL_EASE = Easing.bezier(0.2, 0.6, 0.35, 1);
const WIND_MS = 420;

function arcPath(index: number, slice: number): string {
  const start = ((index * slice - 90) * Math.PI) / 180;
  const end = (((index + 1) * slice - 90) * Math.PI) / 180;
  const x1 = C + R * Math.cos(start);
  const y1 = C + R * Math.sin(start);
  const x2 = C + R * Math.cos(end);
  const y2 = C + R * Math.sin(end);
  return `M ${C} ${C} L ${x1} ${y1} A ${R} ${R} 0 ${slice > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

function textPos(index: number, slice: number) {
  const midDeg = index * slice + slice / 2 - 90;
  const midRad = (midDeg * Math.PI) / 180;
  return { x: C + R * 0.64 * Math.cos(midRad), y: C + R * 0.64 * Math.sin(midRad), rotation: midDeg + 90 };
}

/**
 * The prize wheel, in three acts:
 *
 *  1. Anticipation — the wheel sits in a pulsing halo; it winds back a
 *     notch, then launches.
 *  2. The spin — an even bezier deceleration (WHEEL_EASE). The pointer flicks
 *     and the phone ticks on every peg it passes, from the UI thread. It stops
 *     near the centre of the winning wedge — no staged near misses.
 *  3. The reveal — beams, a confetti burst and a shake coloured by how good
 *     the prize was for this box (blue common, purple rare, gold epic), the
 *     amount rolling up, and a Collect button.
 *
 * Skip jumps straight to the reveal; the credits are already in the ledger
 * either way, so closing at any point loses nothing.
 */
export default function SpinWheel({ visible, tier, rewardCredits, error, onClose, charging = false }: Props) {
  const c = useColors();
  const reduced = useReducedMotion();
  const display = BOX_DISPLAY[tier];
  const n = display.segments.length;
  const slice = 360 / n;
  const table = useMemo(() => display.segments.map((s) => s.credits), [display.segments]);

  const [phase, setPhase] = useState<"ready" | "spinning" | "reveal">("ready");
  const rot = useSharedValue(0);
  const peg = useSharedValue(0);
  const target = useRef(0);
  const halo = useBreathe(phase !== "reveal", 1300);
  const { style: shakeStyle, shake } = useShake();

  // Peg ticks: throttled so the fast start doesn't turn into one long buzz.
  const lastTick = useRef(0);
  const tick = useCallback(() => {
    const t = Date.now();
    if (t - lastTick.current < 42) return;
    lastTick.current = t;
    haptic.tick();
  }, []);

  useAnimatedReaction(
    // A peg sits on every wedge boundary: the pointer passes one each time the turn crosses a multiple of the slice.
    () => Math.floor(rot.value / slice),
    (cur, prev) => {
      if (prev === null || cur === prev) return;
      peg.value = withSequence(withTiming(1, { duration: 35 }), withTiming(0, { duration: 160 }));
      scheduleOnRN(tick);
    }
  );

  const reveal = useCallback(() => {
    setPhase("reveal");
    haptic.success();
    setTimeout(() => haptic.heavy(), 120);
  }, []);

  const start = useCallback(() => {
    if (rewardCredits === null) return;
    // Wedges showing the awarded amount. If the display table ever drifts from
    // the server's, the wheel still lands and the reveal shows the real number.
    const wins = display.segments.map((s, i) => (s.credits === rewardCredits ? i : -1)).filter((i) => i >= 0);
    // Prefer a winning wedge that isn't next to the top prize (no staged near-miss).
    const top = Math.max(...display.segments.map((s) => s.credits));
    const nearTop = (i: number) =>
      rewardCredits !== top && (display.segments[(i + 1) % n]!.credits === top || display.segments[(i - 1 + n) % n]!.credits === top);
    const safe = wins.filter((i) => !nearTop(i));
    const pool = safe.length ? safe : wins;
    const winner = pool.length ? pool[Math.floor(Math.random() * pool.length)]! : 0;
    // Land near the winning wedge's centre (± jitter), never on an edge next to a bigger prize.
    const f = 0.5 + (Math.random() - 0.5) * 0.4;
    const land = (360 - (winner + f) * slice + 3600) % 360;
    const from = rot.value % 360;
    target.current = rot.value - from + 7 * 360 + land;
    setPhase("spinning");
    haptic.heavy();
    if (reduced) {
      rot.value = target.current;
      reveal();
      return;
    }
    rot.value = withSequence(
      withTiming(rot.value - 16, { duration: WIND_MS, easing: Easing.inOut(Easing.quad) }),
      withTiming(target.current, { duration: SPIN_MS, easing: WHEEL_EASE }, (done) => {
        if (done) scheduleOnRN(reveal);
      })
    );
  }, [rewardCredits, display.segments, n, slice, rot, reduced, reveal]);

  const skip = useCallback(() => {
    cancelAnimation(rot);
    rot.value = target.current;
    reveal();
  }, [rot, reveal]);

  // Launch as soon as the server result is in: one tap ("Open!") on the box, not two.
  useEffect(() => {
    if (!visible || charging || rewardCredits === null || phase !== "ready") return;
    const t = setTimeout(start, 350);
    return () => clearTimeout(t);
  }, [visible, charging, rewardCredits, phase, start]);

  const rarity = rewardCredits !== null ? rewardRarity(rewardCredits, table) : "common";
  const look = REWARD_RARITY[rarity];
  useEffect(() => {
    if (phase !== "reveal" || rewardCredits === null) return;
    shake(rarity === "epic" ? 2.2 : rarity === "rare" ? 1.4 : 0.8);
    AccessibilityInfo.announceForAccessibility(`${look.label}. You won ${rewardCredits} credits.`);
  }, [phase, rarity, rewardCredits, shake, look.label]);

  // The amount rolls up from zero once the reveal card is in.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (phase !== "reveal" || rewardCredits === null) return;
    const t = setTimeout(() => setShown(rewardCredits), 250);
    return () => clearTimeout(t);
  }, [phase, rewardCredits]);

  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const pointerStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-22 * peg.value}deg` }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.25 + 0.45 * halo.value, transform: [{ scale: 1 + 0.05 * halo.value }] }));

  const pegs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = ((i * slice - 90) * Math.PI) / 180;
        return { x: C + (R + 1) * Math.cos(a), y: C + (R + 1) * Math.sin(a) };
      }),
    [n, slice]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
        <Animated.View style={[styles.sheet, { backgroundColor: c.elevated, borderColor: phase === "reveal" ? look.color : c.border }, shakeStyle]}>
          {phase === "reveal" ? <LightBeams color={look.color} size={520} opacity={0.4} /> : null}
          <View style={styles.headRow}>
            <Text style={[styles.title, { color: display.color }]}>{display.label}</Text>
            {phase === "reveal" || error ? <CloseButton onPress={onClose} /> : null}
          </View>

          {charging ? (
            <ChargingBox tier={tier} />
          ) : error ? (
            <View style={styles.errorWrap}>
              <MaterialCommunityIcons name="alert-circle-outline" size={40} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text>
              <Button label="Close" onPress={onClose} style={{ alignSelf: "stretch" }} />
            </View>
          ) : phase !== "reveal" ? (
            <>
              <View style={styles.wheelWrap}>
                <Animated.View pointerEvents="none" style={[styles.halo, { borderColor: display.glowColor, shadowColor: display.glowColor }, haloStyle]} />
                <Animated.View style={wheelStyle}>
                  <Svg width={SIZE} height={SIZE}>
                    <Circle cx={C} cy={C} r={R + 10} fill={c.card} stroke={display.color} strokeWidth={4} />
                    <G>
                      {display.segments.map((seg, i) => {
                        const p = textPos(i, slice);
                        return (
                          <G key={i}>
                            <Path d={arcPath(i, slice)} fill={seg.color} stroke="#00000033" strokeWidth={1} />
                            <SvgText x={p.x} y={p.y} fill="#FFFFFF" fontSize={seg.credits >= 1000 ? 13 : 15} fontWeight="bold" textAnchor="middle" transform={`rotate(${p.rotation}, ${p.x}, ${p.y})`}>
                              {seg.credits.toLocaleString()}
                            </SvgText>
                          </G>
                        );
                      })}
                    </G>
                    {pegs.map((pt, i) => (
                      <Circle key={i} cx={pt.x} cy={pt.y} r={4} fill="#FFFFFF" stroke={display.color} strokeWidth={1.5} />
                    ))}
                    <Circle cx={C} cy={C} r={30} fill={c.elevated} stroke={display.color} strokeWidth={3} />
                  </Svg>
                </Animated.View>
                <View pointerEvents="none" style={styles.hub}>
                  <Text style={styles.hubEmoji}>{display.emoji}</Text>
                </View>
                <Animated.View style={[styles.pointerWrap, pointerStyle]}>
                  <View style={[styles.pointer, { borderTopColor: display.glowColor }]} />
                </Animated.View>
              </View>
              <View style={styles.footer}>
                <Text style={[styles.status, { color: c.mutedForeground }]}>
                  {rewardCredits === null ? "Opening…" : phase === "spinning" ? "Come on…" : "Here we go…"}
                </Text>
                {phase === "spinning" ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Skip to result" hitSlop={10} onPress={skip}>
                    <Text style={[styles.skip, { color: c.mutedForeground }]}>Skip</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : rewardCredits !== null ? (
            <View style={styles.reveal}>
              <Burst colors={look.confetti} count={rarity === "epic" ? 64 : rarity === "rare" ? 50 : 36} power={rarity === "epic" ? 1.5 : 1.15} originY={0.38} />
              <Animated.View entering={ZoomIn.springify().damping(SPRING.bouncy.damping).stiffness(SPRING.bouncy.stiffness)} style={[styles.rarity, { backgroundColor: look.color }]}>
                <MaterialCommunityIcons name={rarity === "epic" ? "crown" : rarity === "rare" ? "diamond-stone" : "star-four-points"} size={14} color="#0A0A0A" />
                <Text style={styles.rarityText}>{look.label}</Text>
              </Animated.View>
              <Animated.View entering={ZoomIn.delay(120).springify().damping(10).stiffness(180)} style={[styles.prize, { borderColor: look.color, shadowColor: look.color, backgroundColor: c.alpha(look.color, 0.12) }]}>
                <Text style={[styles.prizeLabel, { color: c.mutedForeground }]}>YOU WON</Text>
                <View style={styles.prizeRow}>
                  <MaterialCommunityIcons name="lightning-bolt" size={34} color={c.primary} />
                  <RollingNumber value={shown} style={[styles.prizeValue, { color: c.foreground }]} duration={1100} flash={false} haptics accessibilityLabel={`${rewardCredits.toLocaleString()} credits`} />
                </View>
                <Text style={[styles.prizeNote, { color: c.mutedForeground }]}>credits · already in your balance</Text>
              </Animated.View>
              <Animated.View entering={FadeIn.delay(500)} style={{ alignSelf: "stretch" }}>
                <View style={styles.collectWrap}>
                  <Button label="Collect" icon="hand-coin" size="lg" onPress={onClose} haptic={false} />
                  <Shimmer intensity={0.45} every={1500} style={{ borderRadius: 14 }} />
                </View>
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The box, big and rattling harder and harder while it opens (CHARGE_MS), over the dimmed screen. */
function ChargingBox({ tier }: { tier: BoxTier }) {
  const display = BOX_DISPLAY[tier];
  const c = useColors();
  const reduced = useReducedMotion();
  const rattle = useSharedValue(0);
  const grow = useSharedValue(0.6);
  useEffect(() => {
    grow.value = withSpring(1, { damping: 11, stiffness: 170 });
    if (reduced) return;
    let alive = true;
    const t0 = Date.now();
    const step = () => {
      if (!alive) return;
      const k = Math.min(1, (Date.now() - t0) / CHARGE_MS);
      const amp = 4 + 14 * k;
      rattle.value = withSequence(withTiming(amp, { duration: 45 }), withTiming(-amp, { duration: 90 }), withTiming(0, { duration: 45 }));
      if (k > 0.4) haptic.tick();
      setTimeout(step, 190 - 90 * k);
    };
    step();
    return () => {
      alive = false;
    };
  }, [reduced, rattle, grow]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: grow.value }, { rotate: `${rattle.value}deg` }] }));
  return (
    <View style={styles.chargeWrap} accessibilityLabel={`Opening the ${display.label}`}>
      <Animated.View style={[styles.chargeTile, { backgroundColor: display.color + "22", borderColor: display.color, shadowColor: display.glowColor }, style]}>
        <Text style={styles.chargeEmoji}>{display.emoji}</Text>
      </Animated.View>
      <Text style={[styles.chargeText, { color: c.mutedForeground }]}>Opening…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chargeWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 36, gap: 18 },
  chargeTile: { width: 170, height: 170, borderRadius: 36, borderWidth: 3, alignItems: "center", justifyContent: "center", shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
  chargeEmoji: { fontSize: 96 },
  chargeText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 26, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 14, width: "100%", maxWidth: 400, overflow: "hidden" },
  headRow: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", justifyContent: "center", minHeight: 36 },
  title: { fontSize: 20, fontFamily: "Inter_900Black", flex: 1, textAlign: "center" },
  wheelWrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  halo: { position: "absolute", width: SIZE + 18, height: SIZE + 18, borderRadius: (SIZE + 18) / 2, borderWidth: 6, shadowOpacity: 0.9, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } },
  hub: { position: "absolute", width: 60, height: 60, alignItems: "center", justifyContent: "center" },
  hubEmoji: { fontSize: 26 },
  pointerWrap: { position: "absolute", top: -10, width: 30, height: 34, alignItems: "center", transformOrigin: "50% 20%" },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderTopWidth: 28,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, minHeight: 24 },
  status: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  skip: { fontSize: 13, fontFamily: "Inter_700Bold", textDecorationLine: "underline" },
  errorWrap: { alignItems: "center", gap: 12, paddingVertical: 24, alignSelf: "stretch" },
  errorText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  reveal: { alignItems: "center", gap: 16, alignSelf: "stretch", paddingVertical: 8 },
  rarity: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  rarityText: { fontSize: 12, fontFamily: "Inter_900Black", letterSpacing: 1.4, color: "#0A0A0A" },
  prize: { alignItems: "center", gap: 4, paddingVertical: 20, paddingHorizontal: 28, borderRadius: 22, borderWidth: 2, shadowOpacity: 0.7, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  prizeLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.4 },
  prizeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  prizeValue: { fontSize: 46, fontFamily: "Inter_900Black", letterSpacing: -1.5 },
  prizeNote: { fontSize: 12, fontFamily: "Inter_500Medium" },
  collectWrap: { borderRadius: 14, overflow: "hidden" },
});

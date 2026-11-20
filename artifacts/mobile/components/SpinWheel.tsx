import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Platform, StyleSheet, Text, View } from "react-native";
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
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import PressableScale from "@/components/fx/PressableScale";
import RollingNumber from "@/components/fx/RollingNumber";
import Shimmer from "@/components/fx/Shimmer";
import { Button, CloseButton } from "@/components/ui";
import type { BoxTier } from "@/lib/api";
import { BOX_DISPLAY } from "@/constants/prizeTypes";
import { CHARGE_MS } from "@/components/PrizeBox";
import PrizeBoxArt, { PRIZE_BOX_THEME } from "@/components/PrizeBoxArt";
import { useColors } from "@/hooks/useColors";
import { useBreathe, useShake } from "@/hooks/useMotion";
import { haptic, REWARD_RARITY, rewardRarity, SPRING } from "@/lib/motion";
import { OVERLAY, useHoldOverlay } from "@/lib/overlayTurns";

interface Props {
  visible: boolean;
  tier: BoxTier;
  /**
   * The total reward the SERVER decided, in credits (base box roll + returning streak bonus).
   * Null while the claim callable is still in flight. The wheel is pure theatre: it spins to
   * whatever the server already committed to the ledger (the client never picks a prize).
   */
  rewardCredits: number | null;
  /** Base wedge rolled on the wheel before any returning/streak bonus. */
  baseCredits?: number | null;
  /** Extra credits added from the returning streak bonus. */
  streakBonus?: number;
  /** Active returning streak day count that earned the bonus. */
  streakDays?: number;
  error: string | null;
  onClose: () => void;
  /** Opening: the box rattles in the middle of the overlay until the server's result is in. */
  charging?: boolean;
}

const SIZE = 296;
const C = SIZE / 2;
const R = SIZE / 2 - 16;
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
  return { x: C + R * 0.66 * Math.cos(midRad), y: C + R * 0.66 * Math.sin(midRad), rotation: midDeg + 90 };
}

/**
 * 2026 Liquid Glass Prize Wheel & Reveal, in three acts:
 *
 *  1. Anticipation — the 3D metallic box floats & rattles over pulsing radial glass rings.
 *  2. The spin — dark frosted glass & metallic gradient wheel with refractive rim, glowing pegs,
 *     and custom teardrop pointer with UI-thread haptic ticks.
 *  3. The reveal — Liquid Glass reward spotlight with rarity badge, rolling credit counter,
 *     returning-streak breakdown, confetti burst, and shimmering Collect CTA.
 */
export default function SpinWheel({
  visible,
  tier,
  rewardCredits,
  baseCredits = null,
  streakBonus = 0,
  streakDays = 0,
  error,
  onClose,
  charging = false,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wheelCredits = baseCredits ?? rewardCredits;
  const c = useColors();
  const reduced = useReducedMotion();
  const display = BOX_DISPLAY[tier];
  const theme = PRIZE_BOX_THEME[tier];
  const n = display.segments.length;
  const slice = 360 / n;
  const table = useMemo(() => display.segments.map((s) => s.credits), [display.segments]);
  const topPrize = useMemo(() => Math.max(...table), [table]);
  const midPrize = useMemo(() => {
    const uniq = Array.from(new Set(table)).sort((a, b) => a - b);
    return uniq[Math.max(0, uniq.length - 2)] ?? topPrize;
  }, [table, topPrize]);

  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => {
        if (mounted) setReduceTransparency(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceTransparencyChanged", (v) => setReduceTransparency(v));
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  // Hold the global overlay lock while the wheel modal is open so XP/level popups
  // never mount a second iOS Modal on top of the wheel or while it is dismissing.
  useHoldOverlay("prizeWheel", visible, OVERLAY.prizeWheel);

  const [phase, setPhase] = useState<"ready" | "spinning" | "reveal">("ready");
  const rot = useSharedValue(0);
  const peg = useSharedValue(0);
  const isSpinningSV = useSharedValue(false);
  const target = useRef(0);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heavyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const halo = useBreathe(visible && phase !== "reveal", 1400);
  const { style: shakeStyle, shake } = useShake();

  useEffect(() => {
    return () => {
      isSpinningSV.value = false;
      cancelAnimation(rot);
      cancelAnimation(peg);
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      if (heavyTimerRef.current) clearTimeout(heavyTimerRef.current);
    };
  }, [rot, peg, isSpinningSV]);

  // Peg ticks: throttled so the fast start doesn't turn into one long buzz.
  const lastTick = useRef(0);
  const tick = useCallback(() => {
    const t = Date.now();
    if (t - lastTick.current < 42) return;
    lastTick.current = t;
    haptic.tick();
  }, []);

  useAnimatedReaction(
    () => (isSpinningSV.value ? Math.floor(rot.value / slice) : null),
    (cur, prev) => {
      if (cur === null || prev === null || cur === prev || !isSpinningSV.value) return;
      peg.value = withSequence(withTiming(1, { duration: 35 }), withTiming(0, { duration: 160 }));
      scheduleOnRN(tick);
    }
  );

  const reveal = useCallback(() => {
    isSpinningSV.value = false;
    cancelAnimation(peg);
    peg.value = 0;
    setPhase((prev) => {
      if (prev === "reveal") return prev;
      haptic.success();
      if (heavyTimerRef.current) clearTimeout(heavyTimerRef.current);
      heavyTimerRef.current = setTimeout(() => haptic.heavy(), 120);
      return "reveal";
    });
  }, [isSpinningSV, peg]);

  const computeTarget = useCallback(() => {
    if (wheelCredits === null) return 0;
    const wins = display.segments.map((s, i) => (s.credits === wheelCredits ? i : -1)).filter((i) => i >= 0);
    const top = Math.max(...display.segments.map((s) => s.credits));
    const nearTop = (i: number) =>
      wheelCredits !== top && (display.segments[(i + 1) % n]!.credits === top || display.segments[(i - 1 + n) % n]!.credits === top);
    const safe = wins.filter((i) => !nearTop(i));
    const pool = safe.length ? safe : wins;
    const winner = pool.length ? pool[Math.floor(Math.random() * pool.length)]! : 0;
    const f = 0.5 + (Math.random() - 0.5) * 0.4;
    const land = (360 - (winner + f) * slice + 3600) % 360;
    const from = rot.value % 360;
    return rot.value - from + 7 * 360 + land;
  }, [wheelCredits, display.segments, n, slice, rot]);

  const start = useCallback(() => {
    if (rewardCredits === null) return;
    target.current = computeTarget();
    setPhase("spinning");
    haptic.heavy();
    if (reduced) {
      isSpinningSV.value = false;
      rot.value = target.current;
      reveal();
      return;
    }
    isSpinningSV.value = true;
    rot.value = withSequence(
      withTiming(rot.value - 16, { duration: WIND_MS, easing: Easing.inOut(Easing.quad) }),
      withTiming(target.current, { duration: SPIN_MS, easing: WHEEL_EASE }, (done) => {
        if (done) {
          isSpinningSV.value = false;
          scheduleOnRN(reveal);
        }
      })
    );
  }, [rewardCredits, computeTarget, rot, reduced, reveal, isSpinningSV]);

  const skip = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    isSpinningSV.value = false;
    cancelAnimation(rot);
    cancelAnimation(peg);
    peg.value = 0;
    if (!target.current && rewardCredits !== null) {
      target.current = computeTarget();
    }
    rot.value = target.current;
    reveal();
  }, [rot, peg, isSpinningSV, rewardCredits, computeTarget, reveal]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    isSpinningSV.value = false;
    cancelAnimation(rot);
    cancelAnimation(peg);
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    if (heavyTimerRef.current) clearTimeout(heavyTimerRef.current);
    onClose();
  }, [isSpinningSV, rot, peg, onClose]);

  useEffect(() => {
    if (!visible || charging || rewardCredits === null || phase !== "ready") return;
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      start();
    }, 350);
    return () => {
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [visible, charging, rewardCredits, phase, start]);

  const rarity = wheelCredits !== null ? rewardRarity(wheelCredits, table) : "common";
  const look = REWARD_RARITY[rarity];
  const domeColor = phase === "reveal" ? look.color : theme.glow;
  const rimColor = phase === "reveal" ? look.color : theme.rim;

  useEffect(() => {
    if (phase !== "reveal" || rewardCredits === null) return;
    shake(rarity === "epic" ? 2.2 : rarity === "rare" ? 1.4 : 0.8);
    const bonusMsg = streakBonus > 0 ? `, including plus ${streakBonus} returning bonus` : "";
    AccessibilityInfo.announceForAccessibility(`${look.label}. You won ${rewardCredits} credits${bonusMsg}.`);
  }, [phase, rarity, rewardCredits, streakBonus, shake, look.label]);

  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (phase !== "reveal" || rewardCredits === null) return;
    const t = setTimeout(() => setShown(rewardCredits), 250);
    return () => clearTimeout(t);
  }, [phase, rewardCredits]);

  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const pointerStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-22 * peg.value}deg` }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + 0.34 * halo.value,
    transform: [{ scale: 0.98 + 0.05 * halo.value }],
  }));

  const pegs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = ((i * slice - 90) * Math.PI) / 180;
        return { x: C + (R + 2) * Math.cos(a), y: C + (R + 2) * Math.sin(a) };
      }),
    [n, slice]
  );

  const id = (name: string) => `sw_${uid}_${name}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.overlay}>
        {!reduceTransparency && Platform.OS !== "web" ? (
          <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: reduceTransparency ? "rgba(6, 10, 18, 0.74)" : "rgba(4, 8, 15, 0.48)" },
          ]}
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: reduceTransparency ? "#121722" : "rgba(18, 22, 32, 0.80)",
              borderColor: phase === "reveal" ? look.color + "88" : "rgba(255, 255, 255, 0.19)",
            },
            shakeStyle,
          ]}
        >
          {!reduceTransparency && Platform.OS !== "web" ? (
            <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          ) : null}

          {/* Liquid Glass Radial Dome + Top Specular Rim */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
              <Defs>
                <RadialGradient id={id("dome")} cx="50%" cy="18%" rx="80%" ry="58%">
                  <Stop offset="0" stopColor={domeColor} stopOpacity="0.34" />
                  <Stop offset="0.52" stopColor={domeColor} stopOpacity="0.10" />
                  <Stop offset="1" stopColor={domeColor} stopOpacity="0" />
                </RadialGradient>
                <RadialGradient id={id("spec")} cx="50%" cy="0%" rx="55%" ry="26%">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width="100" height="100" fill={`url(#${id("dome")})`} />
              <Rect x="0" y="0" width="100" height="100" fill={`url(#${id("spec")})`} />
            </Svg>
            <LinearGradient
              colors={["transparent", rimColor, "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.topRim}
            />
          </View>

          {phase === "reveal" ? <LightBeams color={look.color} size={520} opacity={0.34} /> : null}

          <View style={styles.headRow}>
            <View style={[styles.tierBadge, { backgroundColor: theme.pillBg, borderColor: theme.pillBorder }]}>
              <Text style={[styles.tierBadgeText, { color: theme.pillText }]}>
                {display.label.toUpperCase()}
              </Text>
            </View>
            {phase === "reveal" || error ? <CloseButton onPress={handleClose} style={styles.closeAbs} /> : null}
          </View>

          {charging ? (
            <ChargingBox tier={tier} />
          ) : error ? (
            <View style={styles.errorWrap}>
              <MaterialCommunityIcons name="alert-circle-outline" size={40} color={c.destructive} />
              <Text style={[styles.errorText, { color: c.destructive }]}>{error}</Text>
              <Button label="Close" onPress={handleClose} style={{ alignSelf: "stretch" }} />
            </View>
          ) : phase !== "reveal" ? (
            <>
              <View style={styles.wheelWrap}>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.halo, { borderColor: theme.glow, shadowColor: theme.glow }, haloStyle]}
                />
                <Animated.View style={wheelStyle}>
                  <Svg width={SIZE} height={SIZE}>
                    <Defs>
                      <SvgLinearGradient id={id("bezel")} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.45" />
                        <Stop offset="0.35" stopColor={theme.accent} stopOpacity="0.85" />
                        <Stop offset="0.7" stopColor="#1E293B" stopOpacity="0.95" />
                        <Stop offset="1" stopColor={theme.glow} stopOpacity="0.75" />
                      </SvgLinearGradient>
                      <SvgLinearGradient id={id("sliceDark")} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0" stopColor="#1A2436" />
                        <Stop offset="1" stopColor="#0E1524" />
                      </SvgLinearGradient>
                      <SvgLinearGradient id={id("sliceSlate")} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0" stopColor="#243248" />
                        <Stop offset="1" stopColor="#141D2E" />
                      </SvgLinearGradient>
                      <SvgLinearGradient id={id("sliceMid")} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0" stopColor={theme.accent} stopOpacity="0.50" />
                        <Stop offset="1" stopColor="#1A2233" />
                      </SvgLinearGradient>
                      <SvgLinearGradient id={id("sliceTop")} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0" stopColor="#FFF3C4" />
                        <Stop offset="0.45" stopColor={theme.buttonBg} />
                        <Stop offset="1" stopColor={theme.glow} />
                      </SvgLinearGradient>
                      <RadialGradient id={id("glassGloss")} cx="50%" cy="24%" rx="64%" ry="54%">
                        <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
                        <Stop offset="0.65" stopColor="#FFFFFF" stopOpacity="0.03" />
                        <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                      </RadialGradient>
                    </Defs>

                    {/* Outer Liquid Glass Metallic Bezel */}
                    <Circle cx={C} cy={C} r={R + 11} fill="#0B101B" stroke={`url(#${id("bezel")})`} strokeWidth={3.5} />

                    {/* Modern Dark Glass & Tier-Metallic Wedges */}
                    <G>
                      {display.segments.map((seg, i) => {
                        const p = textPos(i, slice);
                        const isJackpot = seg.credits === topPrize;
                        const isMid = !isJackpot && seg.credits >= midPrize;
                        const fillUrl = isJackpot
                          ? `url(#${id("sliceTop")})`
                          : isMid
                            ? `url(#${id("sliceMid")})`
                            : i % 2 === 0
                              ? `url(#${id("sliceDark")})`
                              : `url(#${id("sliceSlate")})`;
                        const labelColor = isJackpot ? "#150F03" : "#F8FAFC";
                        return (
                          <G key={i}>
                            <Path
                              d={arcPath(i, slice)}
                              fill={fillUrl}
                              stroke="rgba(255,255,255,0.14)"
                              strokeWidth={1}
                            />
                            <SvgText
                              x={p.x}
                              y={p.y}
                              fill={labelColor}
                              fontSize={seg.credits >= 10000 ? 12.5 : seg.credits >= 1000 ? 13.5 : 14.5}
                              fontWeight="800"
                              textAnchor="middle"
                              transform={`rotate(${p.rotation}, ${p.x}, ${p.y})`}
                            >
                              {seg.credits.toLocaleString()}
                            </SvgText>
                          </G>
                        );
                      })}
                    </G>

                    {/* Subtle specular glass dome sheen over wheel face */}
                    <Circle cx={C} cy={C} r={R} fill={`url(#${id("glassGloss")})`} />

                    {/* Rim Pegs */}
                    {pegs.map((pt, i) => (
                      <Circle
                        key={i}
                        cx={pt.x}
                        cy={pt.y}
                        r={3.6}
                        fill="#FFFFFF"
                        stroke={theme.accent}
                        strokeWidth={1.2}
                      />
                    ))}

                    {/* Center Frosted Glass Hub */}
                    <Circle cx={C} cy={C} r={34} fill="#101725" stroke="rgba(255,255,255,0.24)" strokeWidth={1.5} />
                    <Circle cx={C} cy={C} r={30} fill="none" stroke={theme.accent} strokeWidth={1.5} opacity={0.7} />
                  </Svg>
                </Animated.View>

                <View pointerEvents="none" style={styles.hub}>
                  <PrizeBoxArt tier={tier} size={44} />
                </View>

                {/* Modern Teardrop Glass Pointer */}
                <Animated.View style={[styles.pointerWrap, pointerStyle]}>
                  <Svg width={32} height={36} viewBox="0 0 32 36">
                    <Defs>
                      <SvgLinearGradient id={id("ptr")} x1="0%" y1="0%" x2="0%" y2="100%">
                        <Stop offset="0" stopColor="#FFFFFF" />
                        <Stop offset="0.45" stopColor={theme.accent} />
                        <Stop offset="1" stopColor={theme.glow} />
                      </SvgLinearGradient>
                    </Defs>
                    <Path
                      d="M 16 34 L 5 12 A 11 11 0 1 1 27 12 Z"
                      fill={`url(#${id("ptr")})`}
                      stroke="rgba(255,255,255,0.85)"
                      strokeWidth={1.4}
                    />
                    <Circle cx="16" cy="12" r="4" fill="#0B101B" opacity="0.72" />
                  </Svg>
                </Animated.View>
              </View>

              <View style={styles.footer}>
                <Text style={styles.status}>
                  {rewardCredits === null ? "Unlocking prize…" : phase === "spinning" ? "Spinning…" : "Get ready…"}
                </Text>
                {rewardCredits !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Skip to result"
                    hitSlop={10}
                    onPress={skip}
                    style={({ pressed }) => [styles.skipPill, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={styles.skipText}>Skip</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : rewardCredits !== null ? (
            <View style={styles.reveal}>
              <Burst
                colors={look.confetti}
                count={rarity === "epic" ? 64 : rarity === "rare" ? 50 : 36}
                power={rarity === "epic" ? 1.5 : 1.15}
                originY={0.38}
              />
              <Animated.View
                entering={ZoomIn.springify().damping(SPRING.bouncy.damping).stiffness(SPRING.bouncy.stiffness)}
                style={[styles.rarity, { backgroundColor: look.color }]}
              >
                <MaterialCommunityIcons
                  name={rarity === "epic" ? "crown" : rarity === "rare" ? "diamond-stone" : "star-four-points"}
                  size={14}
                  color="#0A0A0A"
                />
                <Text style={styles.rarityText}>{look.label}</Text>
              </Animated.View>

              <Animated.View
                entering={ZoomIn.delay(120).springify().damping(10).stiffness(180)}
                style={[
                  styles.prize,
                  {
                    borderColor: look.color + "77",
                    shadowColor: look.color,
                    backgroundColor: "rgba(255, 255, 255, 0.06)",
                  },
                ]}
              >
                <Text style={styles.prizeLabel}>YOU WON</Text>
                <View style={styles.prizeRow}>
                  <MaterialCommunityIcons name="lightning-bolt" size={34} color={theme.accent} />
                  <RollingNumber
                    value={shown}
                    style={styles.prizeValue}
                    duration={1100}
                    flash={false}
                    haptics
                    accessibilityLabel={`${rewardCredits.toLocaleString()} credits`}
                  />
                </View>
                {streakBonus > 0 ? (
                  <View style={styles.bonusBreakdown}>
                    <Text style={styles.bonusBase}>
                      {(baseCredits ?? rewardCredits - streakBonus).toLocaleString()} box
                    </Text>
                    <Text style={styles.bonusPlus}>+</Text>
                    <View style={styles.bonusPill}>
                      <MaterialCommunityIcons name="fire" size={14} color="#FF8A3D" />
                      <Text style={styles.bonusPillText}>
                        +{streakBonus.toLocaleString()} streak{streakDays > 0 ? ` (${streakDays}d)` : ""}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <Text style={styles.prizeNote}>credits · added to your balance</Text>
              </Animated.View>

              <Animated.View entering={FadeIn.delay(450)} style={{ alignSelf: "stretch" }}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Collect credits"
                  scaleTo={0.96}
                  onPress={handleClose}
                  style={[styles.collectBtn, { backgroundColor: theme.buttonBg }]}
                >
                  <Shimmer intensity={0.42} every={1600} />
                  <MaterialCommunityIcons name="hand-coin" size={18} color={theme.buttonText} />
                  <Text style={[styles.collectBtnText, { color: theme.buttonText }]}>Collect</Text>
                </PressableScale>
              </Animated.View>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Floating 3D metallic box rattling over pulsing radial glass energy rings while opening. */
function ChargingBox({ tier }: { tier: BoxTier }) {
  const display = BOX_DISPLAY[tier];
  const theme = PRIZE_BOX_THEME[tier];
  const reduced = useReducedMotion();
  const rattle = useSharedValue(0);
  const grow = useSharedValue(0.65);
  const pulse = useBreathe(true, 900);

  useEffect(() => {
    grow.value = withSpring(1, { damping: 11, stiffness: 170 });
    if (reduced) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const t0 = Date.now();
    const step = () => {
      if (!alive) return;
      const k = Math.min(1, (Date.now() - t0) / CHARGE_MS);
      const amp = 4 + 14 * k;
      rattle.value = withSequence(
        withTiming(amp, { duration: 45 }),
        withTiming(-amp, { duration: 90 }),
        withTiming(0, { duration: 45 })
      );
      if (k > 0.4) haptic.tick();
      timer = setTimeout(step, 190 - 90 * k);
    };
    step();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      cancelAnimation(rattle);
      cancelAnimation(grow);
    };
  }, [reduced, rattle, grow]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: grow.value }, { rotate: `${rattle.value}deg` }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + 0.35 * pulse.value,
    transform: [{ scale: 0.92 + 0.22 * pulse.value }],
  }));

  return (
    <View style={styles.chargeWrap} accessibilityLabel={`Opening the ${display.label}`}>
      <View style={styles.chargeStage}>
        <Animated.View
          pointerEvents="none"
          style={[styles.chargeRing, { borderColor: theme.accent, backgroundColor: theme.glow + "22" }, ringStyle]}
        />
        <Animated.View style={boxStyle}>
          <PrizeBoxArt tier={tier} size={156} />
        </Animated.View>
      </View>
      <Text style={styles.chargeText}>Opening {display.label}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: {
    borderRadius: 32,
    borderWidth: 1,
    padding: 20,
    paddingTop: 16,
    alignItems: "center",
    gap: 14,
    width: "100%",
    maxWidth: 368,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.55,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  topRim: { position: "absolute", top: 0, left: 24, right: 24, height: 1.5 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    minHeight: 34,
  },
  tierBadge: {
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.2,
  },
  closeAbs: {
    position: "absolute",
    right: 0,
  },
  chargeWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 28, gap: 16 },
  chargeStage: { width: 184, height: 184, alignItems: "center", justifyContent: "center" },
  chargeRing: {
    position: "absolute",
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1.5,
  },
  chargeText: { color: "rgba(226, 232, 240, 0.80)", fontSize: 14.5, fontFamily: "Inter_700Bold" },
  wheelWrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  halo: {
    position: "absolute",
    width: SIZE + 10,
    height: SIZE + 10,
    borderRadius: (SIZE + 10) / 2,
    borderWidth: 2,
    shadowOpacity: 0.65,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  hub: { position: "absolute", width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  pointerWrap: { position: "absolute", top: -12, width: 32, height: 36, alignItems: "center", transformOrigin: "50% 25%" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    minHeight: 34,
    marginTop: 2,
  },
  status: { color: "rgba(226, 232, 240, 0.78)", fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  skipPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  skipText: { color: "#FFFFFF", fontSize: 12.5, fontFamily: "Inter_700Bold" },
  errorWrap: { alignItems: "center", gap: 12, paddingVertical: 24, alignSelf: "stretch" },
  errorText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  reveal: { alignItems: "center", gap: 15, alignSelf: "stretch", paddingVertical: 6 },
  rarity: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999 },
  rarityText: { fontSize: 11.5, fontFamily: "Inter_900Black", letterSpacing: 1.4, color: "#0A0A0A" },
  prize: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: 4,
    paddingVertical: 20,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 1,
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  prizeLabel: { color: "rgba(226, 232, 240, 0.68)", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.4 },
  prizeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  prizeValue: { color: "#FFFFFF", fontSize: 46, fontFamily: "Inter_900Black", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  bonusBreakdown: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 2 },
  bonusBase: { color: "rgba(226, 232, 240, 0.72)", fontSize: 12, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  bonusPlus: { color: "rgba(226, 232, 240, 0.72)", fontSize: 12, fontFamily: "Inter_700Bold" },
  bonusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255, 122, 26, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 138, 61, 0.50)",
  },
  bonusPillText: { color: "#FFB26B", fontSize: 12, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  prizeNote: { color: "rgba(226, 232, 240, 0.65)", fontSize: 12, fontFamily: "Inter_500Medium" },
  collectBtn: {
    height: 50,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  collectBtnText: {
    fontSize: 16,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.2,
  },
});

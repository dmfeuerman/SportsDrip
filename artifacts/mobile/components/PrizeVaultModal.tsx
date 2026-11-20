import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import DailyPickCard from "@/components/DailyPickCard";
import PressableScale from "@/components/fx/PressableScale";
import Shimmer from "@/components/fx/Shimmer";
import { Pressable } from "@/components/fx/Tap";
import { CHARGE_MS } from "@/components/PrizeBox";
import PrizeBoxArt, { PRIZE_BOX_THEME } from "@/components/PrizeBoxArt";
import SpinWheel from "@/components/SpinWheel";
import { STREAK_BONUS_MAX_DAYS, STREAK_BONUS_PER_DAY } from "@/components/StreakBanner";
import WinBackCard from "@/components/WinBackCard";
import { recordXpReason } from "@/components/XpGainPopup";
import { BOX_DISPLAY, BOX_ODDS, BOX_TIERS } from "@/constants/prizeTypes";
import { useAds } from "@/context/AdsContext";
import { useApp, type ClaimBoxResult, type PrizeBoxState } from "@/context/AppContext";
import { useBreathe } from "@/hooks/useMotion";
import type { BoxTier } from "@/lib/api";
import { haptic } from "@/lib/motion";
import { nyDayOf } from "@/lib/streakGrid";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Ready";
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Option 1 ("Luminous Spotlight") — 2026 Liquid Glass Prize Box Popup.
 *
 * Centered dark frosted Liquid Glass modal with:
 *  1. Dimmed & blurred backdrop preserving home screen spatial context
 *  2. Concentric rounded floating glass surface with tier-tinted radial dome glow + specular top rim
 *  3. Swipeable 3D metallic Prize Box hero slides (Bronze, Silver, Gold) with explicit countdown & progress bar
 *  4. Clear swipe affordance: tappable left/right glass chevrons, tier indicator, swipe hint, and pagination dots
 *  5. Split dual-action footer (`Close` | primary action)
 */
export default function PrizeVaultModal({ visible, onClose }: Props) {
  const { width: winW } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { profile, bets, prizeBoxes, openBox, claimBox, resetBox, error } = useApp();
  const { breakpoint } = useAds();

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

  const [activeIndex, setActiveIndex] = useState(0);
  const [subView, setSubView] = useState<"boxes" | "freeBet" | "odds">("boxes");
  const [spinning, setSpinning] = useState<BoxTier | null>(null);
  const [reward, setReward] = useState<ClaimBoxResult | null>(null);
  const [busy, setBusy] = useState<BoxTier | null>(null);
  const [charging, setCharging] = useState<BoxTier | null>(null);
  const [now, setNow] = useState(Date.now());

  const pagerRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const opening = useRef(false);

  // Optimistic box states so taps feel instant while server commits.
  const [local, setLocal] = useState<Partial<Record<BoxTier, PrizeBoxState>>>({});
  const timers = useRef<Partial<Record<BoxTier, ReturnType<typeof setTimeout>>>>({});
  const drop = useCallback((tier: BoxTier) => {
    clearTimeout(timers.current[tier]);
    setLocal((l) => {
      if (!l[tier]) return l;
      const { [tier]: _x, ...rest } = l;
      return rest;
    });
  }, []);
  const assume = useCallback(
    (tier: BoxTier, next: PrizeBoxState) => {
      setLocal((l) => ({ ...l, [tier]: next }));
      clearTimeout(timers.current[tier]);
      timers.current[tier] = setTimeout(() => drop(tier), 15_000);
    },
    [drop]
  );

  useEffect(() => {
    for (const t of BOX_TIERS) if (local[t] && prizeBoxes[t].state === local[t]!.state) drop(t);
  }, [prizeBoxes, local, drop]);
  useEffect(() => () => BOX_TIERS.forEach((t) => clearTimeout(timers.current[t])), []);

  const boxes = useMemo(() => {
    const out = { ...prizeBoxes };
    for (const t of BOX_TIERS) if (local[t]) out[t] = local[t]!;
    return out;
  }, [prizeBoxes, local]);

  // Tick 1s while modal is open and any box is counting down.
  const anyWaiting = BOX_TIERS.some((t) => {
    const b = boxes[t];
    return b.state === "waiting" && (b.readyAt ?? 0) > now;
  });
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    if (!anyWaiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, anyWaiting]);

  // Card inner width for paging math.
  const cardWidth = Math.min(358, Math.max(288, winW - 40));

  // When opening the popup, focus the most actionable tier (ready -> idle -> soonest waiting).
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setSubView("boxes");
      const tNow = Date.now();
      const readyIdx = BOX_TIERS.findIndex((t) => {
        const b = boxes[t];
        return (b.state === "waiting" || b.state === "ready") && (b.readyAt ?? 0) <= tNow;
      });
      const idleIdx = BOX_TIERS.findIndex((t) => boxes[t].state === "idle");
      let bestIdx = readyIdx >= 0 ? readyIdx : idleIdx >= 0 ? idleIdx : 0;
      if (readyIdx < 0 && idleIdx < 0) {
        let soonest = Number.POSITIVE_INFINITY;
        BOX_TIERS.forEach((t, idx) => {
          const rAt = boxes[t].readyAt ?? Number.POSITIVE_INFINITY;
          if (rAt < soonest) {
            soonest = rAt;
            bestIdx = idx;
          }
        });
      }
      setActiveIndex(bestIdx);
      requestAnimationFrame(() => {
        pagerRef.current?.scrollTo({ x: bestIdx * cardWidth, animated: false });
      });
    }
    wasVisible.current = visible;
  }, [visible, boxes, cardWidth]);

  const jumpTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(BOX_TIERS.length - 1, idx));
      haptic.tick();
      setActiveIndex(clamped);
      pagerRef.current?.scrollTo({ x: clamped * cardWidth, animated: true });
    },
    [cardWidth]
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
      const clamped = Math.max(0, Math.min(BOX_TIERS.length - 1, idx));
      if (clamped !== activeIndex) {
        haptic.tick();
        setActiveIndex(clamped);
      }
    },
    [cardWidth, activeIndex]
  );

  const handleOpen = useCallback(
    async (tier: BoxTier) => {
      const t = Date.now();
      assume(tier, {
        ...prizeBoxes[tier],
        state: "waiting",
        openedAt: t,
        readyAt: t + BOX_DISPLAY[tier].waitHours * 3600_000,
        rewardCredits: null,
      });
      setNow(t);
      if (!(await openBox(tier))) drop(tier);
    },
    [openBox, prizeBoxes, assume, drop]
  );

  const handleReset = useCallback(
    async (tier: BoxTier) => {
      assume(tier, { ...prizeBoxes[tier], state: "idle", openedAt: null, readyAt: null, rewardCredits: null });
      await resetBox(tier);
    },
    [resetBox, prizeBoxes, assume]
  );

  const handleClaim = useCallback(
    async (tier: BoxTier) => {
      if (opening.current) return;
      opening.current = true;
      setBusy(tier);
      setReward(null);
      recordXpReason(`Opened ${BOX_DISPLAY[tier].label}`, "gift-outline");
      setCharging(tier);
      setSpinning(tier);
      try {
        const [result] = await Promise.all([claimBox(tier), new Promise((r) => setTimeout(r, CHARGE_MS))]);
        setReward(result);
      } finally {
        setCharging(null);
        setBusy(null);
      }
    },
    [claimBox]
  );

  const closeWheel = useCallback(async () => {
    const tier = spinning;
    const won = reward !== null;
    setSpinning(null);
    setReward(null);
    setCharging(null);
    setBusy(null);
    opening.current = false;
    if (tier && won) {
      breakpoint("prize_claimed");
      await handleReset(tier);
    }
  }, [spinning, reward, handleReset, breakpoint]);

  const activeTier = BOX_TIERS[activeIndex] ?? "bronze";
  const activeDisplay = BOX_DISPLAY[activeTier];
  const activeState = boxes[activeTier];
  const activeTheme = PRIZE_BOX_THEME[activeTier];

  const today = nyDayOf(now);
  const streakAlive =
    (profile?.streak?.count ?? 0) > 0 &&
    (profile?.streak?.lastDay === today || profile?.streak?.lastDay === nyDayOf(now - 86_400_000));
  const streakDays = streakAlive ? Math.min(STREAK_BONUS_MAX_DAYS, profile?.streak?.count ?? 0) : 0;

  const freeBetReady = !bets.some((b) => b.freeBet && b.freeDay === today && b.status !== "cancelled");
  const hasWinBack = !!profile?.winBack?.pending;

  // Derive active slide status & primary CTA
  const readyAt = activeState.readyAt ?? 0;
  const remainingMs = Math.max(0, readyAt - now);
  const isWaiting = activeState.state === "waiting" && now < readyAt;
  const isReady = (activeState.state === "waiting" || activeState.state === "ready") && now >= readyAt;
  const isClaimed = activeState.state === "claimed";
  const isIdle = activeState.state === "idle";
  const isBusy = busy === activeTier;
  const isCharging = charging === activeTier;

  // If current box is waiting, check if another box is actionable so CTA stays useful.
  const otherActionableIdx = useMemo(() => {
    if (!isWaiting) return -1;
    const rIdx = BOX_TIERS.findIndex((t, i) => {
      if (i === activeIndex) return false;
      const b = boxes[t];
      return (b.state === "waiting" || b.state === "ready") && (b.readyAt ?? 0) <= now;
    });
    if (rIdx >= 0) return rIdx;
    return BOX_TIERS.findIndex((t, i) => i !== activeIndex && boxes[t].state === "idle");
  }, [isWaiting, activeIndex, boxes, now]);

  const primaryLabel = isCharging
    ? "Opening…"
    : isReady
      ? "Open Box"
      : isIdle
        ? "Start Timer"
        : isClaimed
          ? "Open Again"
          : otherActionableIdx >= 0
            ? `Go to ${BOX_DISPLAY[BOX_TIERS[otherActionableIdx]!].label.replace(" Box", "")}`
            : `${formatCountdown(remainingMs)} left`;

  const primaryDisabled = isBusy || isCharging || (isWaiting && otherActionableIdx < 0);

  const onPrimaryPress = () => {
    if (primaryDisabled) return;
    haptic.medium();
    if (isReady) {
      void handleClaim(activeTier);
    } else if (isIdle) {
      void handleOpen(activeTier);
    } else if (isClaimed) {
      void handleReset(activeTier);
    } else if (otherActionableIdx >= 0) {
      jumpTo(otherActionableIdx);
    }
  };

  const handleClose = () => {
    if (charging || busy) return;
    haptic.tick();
    onClose();
  };

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < BOX_TIERS.length - 1;
  const nextTierLabel = canNext
    ? BOX_DISPLAY[BOX_TIERS[activeIndex + 1]!].label.replace(" Box", "")
    : BOX_DISPLAY[BOX_TIERS[activeIndex - 1]!].label.replace(" Box", "");

  const showPopup = visible && !spinning;

  return (
    <>
      <Modal
        visible={showPopup}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View style={styles.backdrop}>
          {!reduceTransparency && Platform.OS !== "web" ? (
            <BlurView intensity={34} tint="dark" style={StyleSheet.absoluteFill} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Prize Vault"
            onPress={handleClose}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: reduceTransparency ? "rgba(6, 10, 18, 0.72)" : "rgba(5, 9, 16, 0.42)" },
            ]}
          />

          {/* Centered Liquid Glass Dialog Card */}
          <View
            style={[
              styles.card,
              {
                width: cardWidth,
                backgroundColor: reduceTransparency ? "#121722" : "rgba(18, 22, 32, 0.78)",
                borderColor: reduceTransparency ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.19)",
              },
            ]}
          >
            {!reduceTransparency && Platform.OS !== "web" ? (
              <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
            ) : null}

            {/* Directional Radial Dome Glow + Specular Top Rim */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                <Defs>
                  <RadialGradient id="pv_dome" cx="50%" cy="20%" rx="78%" ry="56%">
                    <Stop offset="0" stopColor={activeTheme.glow} stopOpacity="0.34" />
                    <Stop offset="0.52" stopColor={activeTheme.glow} stopOpacity="0.11" />
                    <Stop offset="1" stopColor={activeTheme.glow} stopOpacity="0" />
                  </RadialGradient>
                  <RadialGradient id="pv_spec" cx="50%" cy="0%" rx="54%" ry="28%">
                    <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
                    <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="100" height="100" fill="url(#pv_dome)" />
                <Rect x="0" y="0" width="100" height="100" fill="url(#pv_spec)" />
              </Svg>
              <LinearGradient
                colors={["transparent", activeTheme.rim, "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.topRim}
              />
            </View>

            {/* Top utility row: Odds + Box counter + optional Free Bet chip */}
            <View style={styles.topRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={subView === "odds" ? "Back to Prize Boxes" : "View drop odds"}
                hitSlop={8}
                onPress={() => {
                  haptic.tick();
                  setSubView((v) => (v === "odds" ? "boxes" : "odds"));
                }}
                style={({ pressed }) => [styles.topChip, { opacity: pressed ? 0.72 : 1 }]}
              >
                <MaterialCommunityIcons
                  name={subView === "odds" ? "arrow-left" : "information-outline"}
                  size={13}
                  color="rgba(255,255,255,0.78)"
                />
                <Text style={styles.topChipText}>{subView === "odds" ? "Boxes" : "Odds"}</Text>
              </Pressable>

              {subView === "boxes" ? (
                <Text style={styles.counterLabel}>
                  BOX {activeIndex + 1} OF {BOX_TIERS.length}
                </Text>
              ) : null}

              {freeBetReady || hasWinBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={subView === "freeBet" ? "Back to Prize Boxes" : "Open Daily Free Bet"}
                  hitSlop={8}
                  onPress={() => {
                    haptic.tick();
                    setSubView((v) => (v === "freeBet" ? "boxes" : "freeBet"));
                  }}
                  style={({ pressed }) => [
                    styles.topChip,
                    subView === "freeBet" ? styles.topChipActive : styles.topChipAccent,
                    { opacity: pressed ? 0.78 : 1 },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={subView === "freeBet" ? "gift-outline" : "fire"}
                    size={13}
                    color={subView === "freeBet" ? "#FFFFFF" : "#FCE092"}
                  />
                  <Text
                    style={[
                      styles.topChipText,
                      { color: subView === "freeBet" ? "#FFFFFF" : "#FCE092" },
                    ]}
                  >
                    {subView === "freeBet" ? "Prize Boxes" : hasWinBack ? "Bonus Ready" : "Free Bet"}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.topRowSpacer} />
              )}
            </View>

            {subView === "freeBet" ? (
              <ScrollView
                style={styles.subScroll}
                contentContainerStyle={styles.subScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <WinBackCard />
                <DailyPickCard />
              </ScrollView>
            ) : subView === "odds" ? (
              <View style={styles.oddsWrap}>
                <Text style={styles.oddsTitle}>{activeDisplay.label} Odds</Text>
                <Text style={styles.oddsSub}>Server-verified payouts · {activeDisplay.waitHours}h timer</Text>
                <View style={styles.oddsList}>
                  {BOX_ODDS[activeTier].map((row) => (
                    <View key={row.credits} style={styles.oddsRow}>
                      <Text style={styles.oddsCredits}>{row.credits.toLocaleString()} credits</Text>
                      <Text style={[styles.oddsPct, { color: activeTheme.accent }]}>{row.pct.toFixed(1)}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <>
                {/* Swipeable Prize Box Hero Carousel + Tappable Side Chevrons */}
                <View style={styles.carouselWrap}>
                  <ScrollView
                    ref={pagerRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={onMomentumEnd}
                    scrollEventThrottle={16}
                    bounces={false}
                  >
                    {BOX_TIERS.map((tier) => (
                      <BoxSlide
                        key={tier}
                        tier={tier}
                        state={boxes[tier]}
                        now={now}
                        width={cardWidth}
                        streakBonus={streakDays * STREAK_BONUS_PER_DAY[tier]}
                        charging={charging === tier}
                        reduced={!!reduced}
                      />
                    ))}
                  </ScrollView>

                  {canPrev ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Previous box: ${BOX_DISPLAY[BOX_TIERS[activeIndex - 1]!].label}`}
                      hitSlop={10}
                      onPress={() => jumpTo(activeIndex - 1)}
                      style={({ pressed }) => [styles.navArrow, styles.navArrowLeft, { opacity: pressed ? 0.65 : 1 }]}
                    >
                      <MaterialCommunityIcons name="chevron-left" size={20} color="rgba(255,255,255,0.88)" />
                    </Pressable>
                  ) : null}

                  {canNext ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Next box: ${BOX_DISPLAY[BOX_TIERS[activeIndex + 1]!].label}`}
                      hitSlop={10}
                      onPress={() => jumpTo(activeIndex + 1)}
                      style={({ pressed }) => [styles.navArrow, styles.navArrowRight, { opacity: pressed ? 0.65 : 1 }]}
                    >
                      <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.88)" />
                    </Pressable>
                  ) : null}
                </View>

                {/* Explicit Swipe Cue + Pagination Dots (Element 3) */}
                <View style={styles.pagerFooter}>
                  <View style={styles.dotsRow} accessibilityRole="tablist">
                    {BOX_TIERS.map((tier, idx) => {
                      const active = idx === activeIndex;
                      const b = boxes[tier];
                      const tierReady = (b.state === "waiting" || b.state === "ready") && (b.readyAt ?? 0) <= now;
                      return (
                        <Pressable
                          key={tier}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${BOX_DISPLAY[tier].label}${tierReady ? ", ready to open" : ""}`}
                          hitSlop={10}
                          onPress={() => jumpTo(idx)}
                        >
                          <View
                            style={[
                              styles.dot,
                              active
                                ? { width: 22, backgroundColor: PRIZE_BOX_THEME[tier].dotActive }
                                : {
                                    width: 7,
                                    backgroundColor: tierReady ? "rgba(255, 255, 255, 0.68)" : "rgba(255, 255, 255, 0.28)",
                                  },
                            ]}
                          />
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Swipe or tap to view ${nextTierLabel} box`}
                    onPress={() => jumpTo(canNext ? activeIndex + 1 : activeIndex - 1)}
                    style={({ pressed }) => [styles.swipeHintRow, { opacity: pressed ? 0.65 : 1 }]}
                  >
                    {!canNext ? (
                      <MaterialCommunityIcons name="chevron-double-left" size={14} color="rgba(226, 232, 240, 0.56)" />
                    ) : null}
                    <Text style={styles.swipeHintText}>
                      {canNext ? `Swipe for ${nextTierLabel} Box` : `Swipe back for ${nextTierLabel} Box`}
                    </Text>
                    {canNext ? (
                      <MaterialCommunityIcons name="chevron-double-right" size={14} color="rgba(226, 232, 240, 0.56)" />
                    ) : null}
                  </Pressable>
                </View>

                {/* Split Dual-Action Footer (Element 4) */}
                <View style={styles.footerRow}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    scaleTo={0.96}
                    onPress={handleClose}
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>Close</Text>
                  </PressableScale>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${activeDisplay.label}: ${primaryLabel}`}
                    accessibilityState={{ disabled: primaryDisabled, busy: isBusy || isCharging }}
                    scaleTo={0.96}
                    onPress={onPrimaryPress}
                    disabled={primaryDisabled}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: primaryDisabled ? "rgba(255, 255, 255, 0.12)" : activeTheme.buttonBg,
                        opacity: primaryDisabled ? 0.65 : 1,
                      },
                    ]}
                  >
                    {isReady && !isCharging ? <Shimmer intensity={0.42} every={2000} /> : null}
                    {isBusy && !isCharging ? (
                      <ActivityIndicator size="small" color={activeTheme.buttonText} />
                    ) : (
                      <Text
                        style={[
                          styles.primaryBtnText,
                          { color: primaryDisabled ? "rgba(255, 255, 255, 0.68)" : activeTheme.buttonText },
                        ]}
                        numberOfLines={1}
                      >
                        {primaryLabel}
                      </Text>
                    )}
                  </PressableScale>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {spinning ? (
        <SpinWheel
          visible
          tier={spinning}
          charging={charging === spinning}
          rewardCredits={reward?.rewardCredits ?? null}
          baseCredits={reward?.baseCredits ?? null}
          streakBonus={reward?.streakBonus ?? 0}
          streakDays={reward?.streakDays ?? 0}
          error={reward === null && !busy && !charging ? error : null}
          onClose={closeWheel}
        />
      ) : null}
    </>
  );
}

function BoxSlide({
  tier,
  state,
  now,
  width,
  streakBonus,
  charging,
  reduced,
}: {
  tier: BoxTier;
  state: PrizeBoxState;
  now: number;
  width: number;
  streakBonus: number;
  charging: boolean;
  reduced: boolean;
}) {
  const display = BOX_DISPLAY[tier];
  const theme = PRIZE_BOX_THEME[tier];

  const readyAt = state.readyAt ?? 0;
  const totalWaitMs = display.waitHours * 3_600_000;
  const openedAt = state.openedAt ?? Math.max(0, readyAt - totalWaitMs);
  const remainingMs = Math.max(0, readyAt - now);
  const progressPct =
    totalWaitMs > 0 ? Math.min(100, Math.max(6, Math.round(((now - openedAt) / totalWaitMs) * 100))) : 0;

  const waiting = state.state === "waiting" && now < readyAt;
  const ready = (state.state === "waiting" || state.state === "ready") && now >= readyAt;
  const claimed = state.state === "claimed";

  const breathe = useBreathe(!waiting && !charging, ready ? 1700 : 2600);
  const charge = useSharedValue(0);
  const phase = useSharedValue(0);
  const rattle = useFrameCallback((f) => {
    phase.value += (f.timeSincePreviousFrame ?? 16) * (0.045 + 0.06 * charge.value);
  }, false);

  useEffect(() => {
    if (!charging || reduced) {
      rattle.setActive(false);
      cancelAnimation(charge);
      charge.value = withTiming(0, { duration: 150 });
      return;
    }
    charge.value = 0;
    charge.value = withTiming(1, { duration: CHARGE_MS, easing: Easing.in(Easing.quad) });
    rattle.setActive(true);
    return () => {
      rattle.setActive(false);
    };
  }, [charging, reduced, charge, rattle]);

  const boxAnim = useAnimatedStyle(() => {
    const amp = 2 + 10 * charge.value;
    return {
      transform: [
        { translateY: -5 * breathe.value },
        { translateX: Math.sin(phase.value * 1.7) * amp * 0.35 * charge.value },
        { rotate: `${Math.sin(phase.value) * amp * (charge.value > 0.01 ? 1 : 0)}deg` },
        { scale: 1 + 0.03 * breathe.value + 0.1 * charge.value },
      ],
    };
  });

  const haloAnim = useAnimatedStyle(() => ({
    opacity: ready ? 0.34 + 0.28 * breathe.value : 0.16 + 0.1 * breathe.value,
    transform: [{ scale: 0.94 + 0.16 * breathe.value }],
  }));

  const min = Math.min(...display.segments.map((s) => s.credits));
  const max = Math.max(...display.segments.map((s) => s.credits));

  const statusSuffix = ready
    ? "Ready to open"
    : waiting
      ? `${display.waitHours}h timer active`
      : claimed && state.rewardCredits !== null
        ? `Won +${state.rewardCredits.toLocaleString()}`
        : `${display.waitHours}h unlock timer`;

  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.heroStage}>
        <Animated.View
          pointerEvents="none"
          style={[styles.heroHalo, { backgroundColor: theme.glow }, haloAnim]}
        />
        <Animated.View style={boxAnim}>
          <PrizeBoxArt tier={tier} size={138} />
        </Animated.View>
      </View>

      <Text style={styles.slideTitle}>{display.label.replace(" Box", " Prize Box")}</Text>
      <Text style={styles.slideSub} numberOfLines={1}>
        {min.toLocaleString()} – {max.toLocaleString()} Credits ·{" "}
        <Text style={{ color: ready ? "#FFFFFF" : "rgba(226, 232, 240, 0.78)" }}>{statusSuffix}</Text>
      </Text>

      {/* Explicit Countdown + Progress Track whenever timer is active */}
      {waiting ? (
        <View style={styles.timerCard}>
          <View style={styles.timerRow}>
            <MaterialCommunityIcons name="timer-outline" size={14} color={theme.accent} />
            <Text style={styles.timerLabel}>Time left</Text>
            <Text style={[styles.timerValue, { color: theme.pillText }]}>{formatCountdown(remainingMs)}</Text>
          </View>
          <View style={styles.timerTrack}>
            <View
              style={[
                styles.timerFill,
                { width: `${progressPct}%`, backgroundColor: theme.accent },
              ]}
            />
          </View>
        </View>
      ) : null}

      {/* Streak Bonus or Ready/Idle Status Pill */}
      <View style={styles.pillRow}>
        {streakBonus > 0 ? (
          <View style={[styles.pill, { backgroundColor: theme.pillBg, borderColor: theme.pillBorder }]}>
            <Text style={[styles.pillText, { color: theme.pillText }]}>
              🔥 +{streakBonus.toLocaleString()} Streak Bonus
            </Text>
          </View>
        ) : !waiting ? (
          <View style={[styles.pill, { backgroundColor: theme.pillBg, borderColor: theme.pillBorder }]}>
            <MaterialCommunityIcons
              name={ready ? "star-four-points" : "clock-outline"}
              size={13}
              color={theme.pillText}
            />
            <Text style={[styles.pillText, { color: theme.pillText }]}>
              {ready ? "Ready now · Tap Open Box" : `Start ${display.waitHours}h timer to unlock`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 32,
    borderWidth: 1,
    overflow: "hidden",
    paddingTop: 14,
    paddingBottom: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.55,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  topRim: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1.5,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 4,
    zIndex: 2,
  },
  topRowSpacer: {
    width: 58,
  },
  counterLabel: {
    color: "rgba(226, 232, 240, 0.62)",
    fontSize: 10.5,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    fontVariant: ["tabular-nums"],
  },
  topChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  topChipAccent: {
    backgroundColor: "rgba(245, 196, 81, 0.14)",
    borderColor: "rgba(245, 196, 81, 0.36)",
  },
  topChipActive: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderColor: "rgba(255, 255, 255, 0.32)",
  },
  topChipText: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 11.5,
    fontFamily: "Inter_600SemiBold",
  },
  carouselWrap: {
    position: "relative",
    justifyContent: "center",
  },
  navArrow: {
    position: "absolute",
    top: 56,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
    zIndex: 4,
  },
  navArrowLeft: {
    left: 14,
  },
  navArrowRight: {
    right: 14,
  },
  slide: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 2,
    paddingBottom: 6,
  },
  heroStage: {
    width: 152,
    height: 144,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroHalo: {
    position: "absolute",
    width: 114,
    height: 114,
    borderRadius: 57,
  },
  slideTitle: {
    color: "#FFFFFF",
    fontSize: 23,
    lineHeight: 27,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  slideSub: {
    color: "rgba(226, 232, 240, 0.72)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  timerCard: {
    width: "100%",
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    gap: 7,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerLabel: {
    flex: 1,
    color: "rgba(226, 232, 240, 0.74)",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  timerValue: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
  },
  timerTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
  },
  timerFill: {
    height: 5,
    borderRadius: 999,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    minHeight: 28,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  pagerFooter: {
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    marginBottom: 16,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  dot: {
    height: 7,
    borderRadius: 999,
  },
  swipeHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  swipeHintText: {
    color: "rgba(226, 232, 240, 0.58)",
    fontSize: 11.5,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  secondaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.1,
  },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  primaryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.1,
  },
  subScroll: {
    maxHeight: 440,
    paddingHorizontal: 14,
    marginTop: 6,
  },
  subScrollContent: {
    gap: 12,
    paddingBottom: 6,
  },
  oddsWrap: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
  },
  oddsTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontFamily: "Inter_800ExtraBold",
    textAlign: "center",
  },
  oddsSub: {
    color: "rgba(226, 232, 240, 0.68)",
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 8,
  },
  oddsList: {
    gap: 8,
  },
  oddsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  oddsCredits: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  oddsPct: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
    fontVariant: ["tabular-nums"],
  },
});

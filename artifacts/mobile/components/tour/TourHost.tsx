import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, usePathname } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import TourMenu from "@/components/tour/TourMenu";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { haptic as buzz } from "@/lib/motion";
import { useOverlayTurn } from "@/lib/overlayTurns";
import { endTour, getTarget, nextTourStep, prevTourStep, startTour, tourDone, useTourState, type TourCtx } from "@/lib/tour/store";
import { STARTER_ITEMS, STARTER_TOUR } from "@/lib/tour/tours";

type Rect = { x: number; y: number; w: number; h: number };
const TABS = ["index", "games", "leagues", "friends", "avatar"];
const PAD = 6;
/** How long a press step waits for its target before offering "Next" so nobody gets stuck. */
const MISSING_MS = 2500;

/**
 * Draws the running tutorial over the whole app: dims everything but the
 * spotlit control, makes it glow, and shows the explaining popup. On a
 * "press" step only the control itself can be touched.
 */
export default function TourHost() {
  const c = useColors();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const { tour, step, menu } = useTourState();
  const { inventory, profile } = useApp();
  const cart = useCart();
  const ctx = useMemo<TourCtx>(() => ({ path, owned: new Set(inventory), cart: new Set(cart.ids) }), [path, inventory, cart.ids]);
  const s = tour?.steps[step];
  const myTurn = useOverlayTurn("tour", !!tour, 100);

  // First visit to Home wearing nothing and owning none of the starter kit: walk them
  // through buying it. Waits a moment so the inventory snapshot has landed.
  const autoChecked = useRef(false);
  const latest = useRef({ ctx, equipped: profile?.equipped });
  latest.current = { ctx, equipped: profile?.equipped };
  useEffect(() => {
    if (autoChecked.current || tour || !profile?.uid || path !== "/") return;
    const t = setTimeout(() => {
      autoChecked.current = true;
      const { ctx: now, equipped } = latest.current;
      if (STARTER_ITEMS.some((id) => now.owned.has(id)) || Object.values(equipped ?? {}).some(Boolean)) return;
      void tourDone(STARTER_TOUR.id).then((d) => {
        if (!d) startTour(STARTER_TOUR);
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [tour, profile?.uid, path]);

  // Already satisfied / just satisfied: move on.
  useEffect(() => {
    if (!s) return;
    if (s.skipWhen?.(ctx) || s.doneWhen?.(ctx)) nextTourStep();
  }, [s, ctx]);

  // Open the step's screen when it starts.
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    if (s?.route && pathRef.current !== s.route) router.navigate(s.route as never);
  }, [tour?.id, step, s?.route]);

  // Track the target on screen (it moves with scrolling, keyboards, layout).
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setRect(null);
    setMissing(false);
    if (!s?.target || !myTurn) return;
    const target = s.target;
    let lastScroll = 0;
    let alive = true;
    const since = Date.now();
    const found = (r: Rect | null) => {
      if (!alive) return;
      setRect((p) => (r && p && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - r.y) < 1 && Math.abs(p.w - r.w) < 1 && Math.abs(p.h - r.h) < 1 ? p : r));
      setMissing(!r && Date.now() - since > MISSING_MS);
    };
    const tick = () => {
      if (target.startsWith("tab:")) {
        const i = TABS.indexOf(target.slice(4));
        const barH = isLiquidGlassAvailable() ? 49 + insets.bottom : Platform.OS === "web" ? 72 : 64;
        found(i < 0 ? null : { x: (W / TABS.length) * i, y: H - barH, w: W / TABS.length, h: Math.min(barH, 58) });
        return;
      }
      const t = getTarget(target);
      const node = t?.ref.current;
      if (!node) return found(null);
      node.measureInWindow((x, y, w, h) => {
        if (!w && !h) return found(null);
        const off = y < insets.top + 40 || y + h > H * 0.7;
        if (off && t.scrollBy && Date.now() - lastScroll > 1200) {
          lastScroll = Date.now();
          t.scrollBy(y - H * 0.28);
        }
        found({ x, y, w, h });
      });
    };
    tick();
    const id = setInterval(tick, 200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [s, myTurn, W, H, insets.top, insets.bottom]);

  useEffect(() => {
    if (s?.press) buzz.light();
  }, [s]);

  if (!tour || !s) return menu ? <TourMenu /> : null;
  if (!myTurn) return null;

  const hole = rect ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 } : null;
  const pressing = !!s.press && !!hole;
  const below = hole ? hole.y + hole.h / 2 < H * 0.5 : false;
  const gap = pressing ? 54 : 16;
  const calloutPos = hole
    ? below
      ? { top: Math.min(hole.y + hole.h + gap, H - 240) }
      : { bottom: Math.min(H - hole.y + gap, H - insets.top - 220) }
    : { top: H * 0.3 };
  const last = step === tour.steps.length - 1;
  const canNext = !s.press || missing;

  const r = 14;
  const dim = hole
    ? `M0 0H${W}V${H}H0Z M${hole.x + r} ${hole.y}H${hole.x + hole.w - r}Q${hole.x + hole.w} ${hole.y} ${hole.x + hole.w} ${hole.y + r}V${hole.y + hole.h - r}Q${hole.x + hole.w} ${hole.y + hole.h} ${hole.x + hole.w - r} ${hole.y + hole.h}H${hole.x + r}Q${hole.x} ${hole.y + hole.h} ${hole.x} ${hole.y + hole.h - r}V${hole.y + r}Q${hole.x} ${hole.y} ${hole.x + r} ${hole.y}Z`
    : `M0 0H${W}V${H}H0Z`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={dim} fill="rgba(0,0,0,0.62)" fillRule="evenodd" />
      </Svg>

      {/* Touch: only the spotlit control on a press step; nothing underneath otherwise. */}
      {pressing && hole ? (
        <>
          <Blocker style={{ left: 0, top: 0, width: W, height: Math.max(0, hole.y) }} />
          <Blocker style={{ left: 0, top: hole.y + hole.h, width: W, height: Math.max(0, H - hole.y - hole.h) }} />
          <Blocker style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h }} />
          <Blocker style={{ left: hole.x + hole.w, top: hole.y, width: Math.max(0, W - hole.x - hole.w), height: hole.h }} />
        </>
      ) : (
        <Blocker style={StyleSheet.absoluteFill} />
      )}

      {hole ? <Glow hole={hole} color={c.primary} /> : null}
      {pressing && hole ? <PressHint hole={hole} below={below} color={c.primary} fg={c.primaryForeground} /> : null}

      <Animated.View
        key={`${tour.id}:${step}`}
        entering={FadeIn.duration(220)}
        style={[styles.callout, calloutPos, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.6) }]}
      >
        <View style={styles.row}>
          <Text style={[styles.count, { color: c.primary }]}>
            {tour.title.toUpperCase()} · {step + 1}/{tour.steps.length}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="End tutorial" hitSlop={10} onPress={endTour}>
            <Text style={[styles.end, { color: c.mutedForeground }]}>End tutorial</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: c.foreground }]}>{s.title}</Text>
        <Text style={[styles.body, { color: c.mutedForeground }]}>{s.body}</Text>
        {s.press && !missing ? (
          <View style={styles.row}>
            <MaterialCommunityIcons name="gesture-tap" size={16} color={c.primary} />
            <Text style={[styles.hint, { color: c.primary }]}>{hole ? "Press the glowing button to keep going" : "Getting there…"}</Text>
          </View>
        ) : null}
        {canNext ? (
          <View style={[styles.row, { justifyContent: "flex-end", gap: 10 }]}>
            {step > 0 && !tour.steps[step - 1]?.press ? (
              <Pressable accessibilityRole="button" onPress={prevTourStep} style={[styles.btn, { borderColor: c.border }]}>
                <Text style={[styles.btnText, { color: c.foreground }]}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={last ? endTour : nextTourStep}
              style={[styles.btn, { backgroundColor: c.primary, borderColor: c.primary }]}
            >
              <Text style={[styles.btnText, { color: c.primaryForeground }]}>{last ? "Finish" : step === 0 ? "Let's go" : "Next"}</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Blocker({ style }: { style: object }) {
  return <View style={[styles.abs, style]} onStartShouldSetResponder={() => true} />;
}

function Glow({ hole, color }: { hole: Rect; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [p]);
  const a = useAnimatedStyle(() => ({
    opacity: 0.55 + p.value * 0.45,
    transform: [{ scale: 1 + p.value * 0.04 }],
    shadowOpacity: 0.5 + p.value * 0.5,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.abs,
        styles.glow,
        { left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderColor: color, shadowColor: color },
        Platform.OS === "web" ? ({ boxShadow: `0 0 18px 4px ${color}` } as object) : null,
        a,
      ]}
    />
  );
}

function PressHint({ hole, below, color, fg }: { hole: Rect; below: boolean; color: string; fg: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withSequence(withTiming(below ? 6 : -6, { duration: 420 }), withTiming(0, { duration: 420 })), -1);
  }, [y, below]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const { width: W } = useWindowDimensions();
  const left = Math.max(12, Math.min(W - 192, hole.x + hole.w / 2 - 90));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, styles.pill, { left, backgroundColor: color }, below ? { top: hole.y + hole.h + 10 } : { top: hole.y - 44 }, a]}
    >
      <MaterialCommunityIcons name={below ? "hand-pointing-up" : "hand-pointing-down"} size={18} color={fg} />
      <Text style={[styles.pillText, { color: fg }]}>Press this button</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  glow: { borderWidth: 3, borderRadius: 14, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  pill: { width: 180, height: 34, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  pillText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  callout: { position: "absolute", left: 16, right: 16, borderRadius: 18, borderWidth: 1.5, padding: 16, gap: 8, maxWidth: 520, alignSelf: "center", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 20, elevation: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  count: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, flex: 1 },
  end: { fontSize: 12, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  title: { fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  hint: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  btnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});

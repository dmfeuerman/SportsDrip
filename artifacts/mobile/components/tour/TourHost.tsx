import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, usePathname } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, ZoomIn, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import TourMenu from "@/components/tour/TourMenu";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { haptic as buzz } from "@/lib/motion";
import { useOverlayTurn } from "@/lib/overlayTurns";
import { endTour, getTarget, nextTourStep, popTourLayer, prevTourStep, pushTourLayer, startTour, tourDone, useTopTourLayer, useTourState, type TourCtx } from "@/lib/tour/store";
import * as api from "@/lib/api";
import { CHARGE_MS } from "@/components/PrizeBox";
import AvatarDisplay from "@/components/AvatarDisplay";
import { useCatalog } from "@/hooks/useCatalog";
import { FIRST_BET_TOUR, STARTER_ITEMS, STARTER_TOUR } from "@/lib/tour/tours";
import { nyDayOf } from "@/lib/streakGrid";
import { useGames } from "@/hooks/useGames";
import { quoteMarket } from "@/lib/markets";
import { useToast } from "@/context/ToastContext";

type Rect = { x: number; y: number; w: number; h: number };
const TABS = ["index", "games", "leagues", "friends", "avatar"];
const PAD = 6;
/** How long a press step waits for its target before offering "Next" so nobody gets stuck. */
const MISSING_MS = 2500;
/** Wait this long after a step starts (sheet slide-up, layout) before spotlighting. */
const SETTLE_MS = 500;

/**
 * Draws the running tutorial over the whole app: dims everything but the
 * spotlit control, makes it glow, and shows the explaining popup. On a
 * "press" step only the control itself can be touched.
 */
/** The free 10-credit prize box is only for players who have never placed a bet (the server checks too). */
const neverBet = (p: { stats?: { betsPlaced?: number } }, betCount: number) => betCount === 0 && (p.stats?.betsPlaced ?? 0) === 0;

export default function TourHost() {
  const path = usePathname();
  const { tour, step, menu, ended } = useTourState();
  const { inventory, inventoryLoaded, profile, bets } = useApp();
  const cart = useCart();
  const betCount = bets.length;
  const today = nyDayOf(Date.now());
  const freeBetToday = bets.some((b) => b.freeBet && b.freeDay === today && b.status !== "cancelled");
  const ctx = useMemo<TourCtx>(
    () => ({ path, owned: new Set(inventory), cart: new Set(cart.ids), betCount, freeBetToday }),
    [path, inventory, cart.ids, betCount, freeBetToday]
  );
  const s = tour?.steps[step];
  const myTurn = useOverlayTurn("tour", !!tour, 100);

  // First-run only. Until the starter kit is bought, opening Home starts its
  // tutorial (once per app launch, so ending it doesn't loop). Once the kit is
  // bought, the first-bet tutorial follows — but only for an account that
  // hasn't had its tutorial prize box yet. Waits for the inventory to land.
  const autoChecked = useRef(false);
  const latest = useRef({ ctx, profile });
  latest.current = { ctx, profile };
  useEffect(() => {
    if (autoChecked.current || tour || !profile?.uid || !inventoryLoaded || path !== "/") return;
    const t = setTimeout(() => {
      autoChecked.current = true;
      const { ctx: now, profile: p } = latest.current;
      if (!STARTER_ITEMS.every((id) => now.owned.has(id))) return startTour(STARTER_TOUR, "/");
      if (p && !p.tutorialGiftAt && neverBet(p, now.betCount)) {
        void tourDone(STARTER_TOUR.id).then((starterRan) => {
          if (starterRan) startTour(FIRST_BET_TOUR, "/");
        });
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [tour, profile?.uid, inventoryLoaded, path]);

  // The starter kit tutorial hands straight on to the first bet.
  // Ending the first-bet tutorial before betting places the 10-credit bet for the player.
  const [autoBet, setAutoBet] = useState(false);
  const chained = useRef(0);
  useEffect(() => {
    if (!ended || ended.n === chained.current) return;
    chained.current = ended.n;
    if (ended.id === FIRST_BET_TOUR.id && !ended.finished && profile && neverBet(profile, ctx.betCount)) setAutoBet(true);
    if (ended.id === STARTER_TOUR.id && STARTER_ITEMS.every((id) => ctx.owned.has(id)) && profile && !profile.tutorialGiftAt && neverBet(profile, ctx.betCount)) {
      setTimeout(() => startTour(FIRST_BET_TOUR, "/"), 900);
    }
  }, [ended, ctx.owned, ctx.betCount, profile]);

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

  useEffect(() => {
    if (s?.press) buzz.light();
  }, [s]);

  const layer = useTopTourLayer();
  const auto = tour?.id === FIRST_BET_TOUR.id || autoBet ? <AutoFirstBet run={autoBet} onDone={() => setAutoBet(false)} /> : null;
  if (!tour || !s) return <>{auto}{menu ? <TourMenu /> : null}</>;
  if (!myTurn || layer) return auto;
  return <>{auto}<TourOverlay /></>;
}

/**
 * The first-bet tutorial was ended early: open the prize box if it wasn't,
 * put 10 credits on the soonest open game's favourite, say so, remind them
 * about the free daily bet, and go Home.
 */
function AutoFirstBet({ run, onDone }: { run: boolean; onDone: () => void }) {
  const { upcoming } = useGames(["upcoming"]);
  const { profile, placeBet } = useApp();
  const { show } = useToast();
  const latest = useRef({ upcoming, balance: profile?.balance ?? 0 });
  latest.current = { upcoming, balance: profile?.balance ?? 0 };
  const started = useRef(false);
  const [popup, setPopup] = useState<{ auto: boolean; close: () => void } | null>(null);
  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;
    const stake = FIRST_BET_TOUR.stake ?? 10;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      try {
        if (!profile?.tutorialGiftAt) await api.claimTutorialGift({}).catch(() => {});
        // Wait for the board and the prize credits to land.
        for (let i = 0; i < 40 && (latest.current.balance < stake || !latest.current.upcoming.length); i++) await wait(250);
        const now = Date.now() + 5 * 60_000;
        const game = latest.current.upcoming.find((g) => g.priced && !g.disrupted && g.startsAt > now);
        const qs = game ? (["home", "away"] as const).map((sd) => quoteMarket(game, "ml", sd)).filter((q) => q.odds) : [];
        const q = qs.sort((a, b) => (a.odds ?? 99) - (b.odds ?? 99))[0];
        const ok =
          !!game && !!q && latest.current.balance >= stake
            ? await placeBet({
                gameId: game.id,
                side: q.side ?? undefined,
                market: "ml",
                selection: q.selection,
                stake,
                idempotencyKey: api.newIdempotencyKey(),
                expectedOdds: q.odds!,
                preview: {
                  gameId: game.id,
                  sport: game.sport,
                  side: q.side ?? "home",
                  market: "ml",
                  selection: q.selection,
                  line: null,
                  label: q.label,
                  startsAt: game.startsAt,
                  voidReason: null,
                  teamName: q.teamName,
                  teamAbbr: q.teamAbbr,
                  teamColor: q.teamColor,
                  opponentAbbr: q.opponentAbbr,
                  odds: q.odds!,
                  potentialPayout: Math.round(stake * q.odds!),
                  opponentUid: null,
                },
              })
            : false;
        router.navigate("/" as never);
        if (ok && game && q) {
          buzz.success();
          await new Promise<void>((resolve) => setPopup({ auto: true, close: resolve }));
          setPopup(null);
        }
        show({
          id: "tour_freebet_reminder",
          kind: "info",
          icon: "gift-outline",
          title: "Don't forget your free bet",
          body: "You get a free 100-credit bet every day. Place it from Daily Free Bet on Home.",
          durationMs: 8000,
        });
      } finally {
        onDone();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  if (!popup) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.sceneWrap, { backgroundColor: "rgba(4,10,24,0.92)" }]}>
      <PlacedScene auto onDone={popup.close} />
    </View>
  );
}

/** Full-screen "first bet placed" card: the ticket, what it pays, and a big button on. */
function PlacedScene({ onDone, auto }: { onDone: () => void; auto?: boolean }) {
  const c = useColors();
  const { bets } = useApp();
  const bet = useMemo(
    () => bets.filter((b) => !b.freeBet && b.status !== "cancelled").sort((a, b) => (b.placedAt?.seconds ?? 0) - (a.placedAt?.seconds ?? 0))[0],
    [bets]
  );
  const pop = useSharedValue(0.6);
  useEffect(() => {
    buzz.success();
    pop.value = withSequence(withSpring(1.12, { damping: 6 }), withSpring(1, { damping: 10 }));
  }, [pop]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View entering={ZoomIn.duration(260)} style={[styles.placedCard, { backgroundColor: c.elevated, borderColor: c.primary }]}>
      <Animated.View style={[styles.placedIcon, { backgroundColor: c.alpha(c.primary, 0.15), borderColor: c.primary }, a]}>
        <MaterialCommunityIcons name="ticket-confirmation" size={72} color={c.primary} />
      </Animated.View>
      <Text style={[styles.brr, { color: c.primary, textAlign: "center" }]}>{auto ? "BET PLACED" : "YOU'RE ON THE BOARD!"}</Text>
      <Text style={[styles.title, { color: c.foreground, textAlign: "center" }]}>
        {auto ? "We placed your first bet for you" : "Your first bet is in"}
      </Text>
      {bet ? (
        <View style={[styles.placedTicket, { borderColor: bet.teamColor || c.border, backgroundColor: c.alpha(bet.teamColor || c.primary, 0.12) }]}>
          <Text style={[styles.placedTeam, { color: c.foreground }]} numberOfLines={1}>{bet.label || bet.teamName}</Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>vs {bet.opponentAbbr} · {bet.odds?.toFixed(2)}x</Text>
          <View style={styles.row}>
            <Text style={[styles.body, { color: c.mutedForeground }]}>Stake {bet.stake.toLocaleString()}</Text>
            <Text style={[styles.placedWin, { color: c.primary }]}>Returns {bet.potentialPayout.toLocaleString()}</Text>
          </View>
        </View>
      ) : null}
      <Text style={[styles.body, { color: c.mutedForeground, textAlign: "center" }]}>
        It's under My Bets on Home. Results pop up the moment the game goes final.
      </Text>
      <Pressable accessibilityRole="button" onPress={onDone} style={[styles.btn, styles.wide, { backgroundColor: c.primary, borderColor: c.primary }]}>
        <Text style={[styles.btnText, { color: c.primaryForeground, textAlign: "center" }]}>{auto ? "Got it" : "Next: your free bet"}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Mounted inside a Modal (bet slip, create league) so the spotlight can draw over it. */
export function TourModalLayer() {
  const [id] = useState(() => ({ n: 0 }));
  const top = useTopTourLayer();
  const { tour } = useTourState();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    id.n = pushTourLayer();
    const t = setTimeout(() => setOpen(true), 450);
    return () => {
      clearTimeout(t);
      popTourLayer(id.n);
    };
  }, [id]);
  if (!tour || !id.n || top !== id.n || !open) return null;
  return <TourOverlay />;
}

/** The spotlight, glow and popup for the current step. */
function TourOverlay() {
  const c = useColors();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { tour, step, pending } = useTourState();
  const s = tour?.steps[step];
  const myTurn = true;

  // Keep the popup above the keyboard.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [glows, setGlows] = useState<Rect[]>([]);
  const kbRef = useRef(0);
  kbRef.current = kb;

  // Track the target on screen (it moves with scrolling, keyboards, layout).
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  // measureInWindow is in window space; the overlay may not sit at the window's
  // origin (modal sheets, safe-area/status-bar offsets), so subtract its own origin.
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const origin = useRef({ x: 0, y: 0 });
  useEffect(() => {
    setRect(null);
    setMissing(false);
    setGlows([]);
    if (!s?.target || !myTurn) return;
    const target = s.target;
    let lastScroll = 0;
    let alive = true;
    const since = Date.now();
    // Sheets slide up and lists re-lay out after a pick: only spotlight once the
    // step has settled and the target has measured the same twice in a row.
    let prev: Rect | null = null;
    const found = (r: Rect | null) => {
      if (!alive) return;
      const same = !!r && !!prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 && Math.abs(prev.w - r.w) < 1 && Math.abs(prev.h - r.h) < 1;
      prev = r;
      if (!r && s.optional && Date.now() - since > SETTLE_MS + 700) {
        alive = false;
        nextTourStep();
        return;
      }
      if (r && (!same || Date.now() - since < SETTLE_MS)) return;
      setRect((p) => (r && p && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - r.y) < 1 && Math.abs(p.w - r.w) < 1 && Math.abs(p.h - r.h) < 1 ? p : r));
      setMissing(!r && Date.now() - since > MISSING_MS);
    };
    const tick = () => {
      rootRef.current?.measureInWindow((ox, oy) => {
        origin.current = { x: ox || 0, y: oy || 0 };
      });
      if (target.startsWith("tab:")) {
        const i = TABS.indexOf(target.slice(4));
        const barH = isLiquidGlassAvailable() ? 49 + insets.bottom : Platform.OS === "web" ? 72 : 64;
        found(i < 0 ? null : { x: (W / TABS.length) * i, y: H - barH, w: W / TABS.length, h: Math.min(barH, 58) });
        return;
      }
      const t = getTarget(target);
      const node = t?.ref.current;
      if (!node) return found(null);
      node.measureInWindow((wx, wy, w, h) => {
        if (!w && !h) return found(null);
        const x = wx - origin.current.x;
        const y = wy - origin.current.y;
        const off = y < insets.top + 40 || y + h > (kbRef.current ? H - kbRef.current - 16 : H * 0.7);
        if (off && t.scrollBy && Date.now() - lastScroll > 1200) {
          lastScroll = Date.now();
          t.scrollBy(kbRef.current ? y + h - (H - kbRef.current - 24) : y - H * 0.28);
        }
        found({ x, y, w, h });
      });
      if (s.glow?.length) {
        const out: Rect[] = [];
        let left = s.glow.length;
        s.glow.forEach((g) => {
          const n = getTarget(g)?.ref.current;
          if (!n) return void (--left || setGlows(out.slice()));
          n.measureInWindow((gx, gy, gw, gh) => {
            if (gw || gh) out.push({ x: gx - origin.current.x - PAD, y: gy - origin.current.y - PAD, w: gw + PAD * 2, h: gh + PAD * 2 });
            if (!--left && alive)
              setGlows((p) => (p.length === out.length && p.every((q, i) => Math.abs(q.x - out[i].x) < 1 && Math.abs(q.y - out[i].y) < 1) ? p : out.slice()));
          });
        });
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [s, myTurn, W, H, insets.top, insets.bottom]);

  if (!tour || !s) return null;
  if (s.scene) return <Scene scene={s.scene} tourTitle={tour.title} step={step} total={tour.steps.length} />;

  const hole = rect ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 } : null;
  const pressing = !!s.press && !!hole;
  const below = hole ? hole.y + hole.h / 2 < H * 0.5 : false;
  const gap = pressing ? 54 : 16;
  const calloutPos = s.noDim
    ? { top: insets.top + 12 }
    : kb
    ? hole
      ? hole.y - insets.top > 200
        ? { bottom: H - hole.y + 12 }
        : { top: hole.y + hole.h + 12, maxHeight: Math.max(120, H - kb - hole.y - hole.h - 24) }
      : { top: insets.top + 12 }
    : hole
    ? below
      ? { top: Math.min(hole.y + hole.h + gap, H - 240) }
      : { bottom: Math.min(H - hole.y + gap, H - insets.top - 220) }
    : { top: H * 0.3 };
  const last = step === tour.steps.length - 1;
  const canNext = !s.press || missing;
  // Don't flash the popup in the middle before the target has been found.
  const waiting = !!s.target && !hole && !missing && !s.noDim;

  const r = 14;
  const dim = hole
    ? `M0 0H${W}V${H}H0Z M${hole.x + r} ${hole.y}H${hole.x + hole.w - r}Q${hole.x + hole.w} ${hole.y} ${hole.x + hole.w} ${hole.y + r}V${hole.y + hole.h - r}Q${hole.x + hole.w} ${hole.y + hole.h} ${hole.x + hole.w - r} ${hole.y + hole.h}H${hole.x + r}Q${hole.x} ${hole.y + hole.h} ${hole.x} ${hole.y + hole.h - r}V${hole.y + r}Q${hole.x} ${hole.y} ${hole.x + r} ${hole.y}Z`
    : `M0 0H${W}V${H}H0Z`;

  return (
    <View ref={rootRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={dim} fill={s.noDim ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.62)"} fillRule="evenodd" />
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

      {hole && glows.length ? glows.map((g, i) => <Glow key={i} hole={g} color={c.primary} />) : hole ? <Glow hole={hole} color={c.primary} /> : null}
      {pressing && hole && !kb ? <PressHint hole={hole} below={below} color={c.primary} fg={c.primaryForeground} label={s.pressLabel ?? "Press this button"} /> : null}

      {waiting ? null : <Animated.View
        key={`${tour.id}:${step}`}
        entering={FadeIn.duration(220)}
        style={[styles.callout, calloutPos, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.6) }]}
      >
        <View style={styles.row}>
          <Text style={[styles.count, { color: c.primary }]}>
            {tour.title.toUpperCase()} · {step + 1}/{tour.steps.length}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="End tutorial" hitSlop={10} onPress={() => endTour()}>
            <Text style={[styles.end, { color: c.mutedForeground }]}>End tutorial</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: c.foreground }]}>{s.title}</Text>
        <Text style={[styles.body, { color: c.mutedForeground }]}>{s.body}</Text>
        {pending ? (
          <View style={[styles.row, { justifyContent: "flex-end" }]}>
            <Pressable accessibilityRole="button" onPress={() => Keyboard.dismiss()} style={[styles.btn, { backgroundColor: c.primary, borderColor: c.primary }]}>
              <Text style={[styles.btnText, { color: c.primaryForeground }]}>Done</Text>
            </Pressable>
          </View>
        ) : s.press && !missing ? (
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
              onPress={() => (last ? endTour(true) : nextTourStep())}
              style={[styles.btn, { backgroundColor: c.primary, borderColor: c.primary }]}
            >
              <Text style={[styles.btnText, { color: c.primaryForeground }]}>{last ? "Finish" : step === 0 ? "Let's go" : "Next"}</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>}
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

function PressHint({ hole, below, color, fg, label }: { hole: Rect; below: boolean; color: string; fg: string; label: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withSequence(withTiming(below ? 6 : -6, { duration: 420 }), withTiming(0, { duration: 420 })), -1);
  }, [y, below]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const { width: W } = useWindowDimensions();
  const left = Math.max(12, Math.min(W - 212, hole.x + hole.w / 2 - 100));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, styles.pill, { left, backgroundColor: color }, below ? { top: hole.y + hole.h + 10 } : { top: hole.y - 44 }, a]}
    >
      <MaterialCommunityIcons name={below ? "hand-pointing-up" : "hand-pointing-down"} size={18} color={fg} />
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

/* ── full-screen moments ─────────────────────────────────────────────────── */

function Scene({ scene, tourTitle, step, total }: { scene: "cold" | "prize" | "placed"; tourTitle: string; step: number; total: number }) {
  const c = useColors();
  if (scene === "placed")
    return (
      <View style={[StyleSheet.absoluteFill, styles.sceneWrap, { backgroundColor: "rgba(4,10,24,0.92)" }]}>
        <PlacedScene onDone={nextTourStep} />
      </View>
    );
  return (
    <View style={[StyleSheet.absoluteFill, styles.sceneWrap, { backgroundColor: "rgba(4,10,24,0.88)" }]}>
      <Animated.View entering={FadeIn.duration(260)} style={[styles.sceneCard, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.6) }]}>
        <View style={styles.row}>
          <Text style={[styles.count, { color: c.primary }]}>
            {tourTitle.toUpperCase()} · {step + 1}/{total}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="End tutorial" hitSlop={10} onPress={() => endTour()}>
            <Text style={[styles.end, { color: c.mutedForeground }]}>End tutorial</Text>
          </Pressable>
        </View>
        {scene === "cold" ? <ColdScene /> : <PrizeScene />}
      </Animated.View>
    </View>
  );
}

/** "BRRRRR" — the bare character shivering in the snow. */
function ColdScene() {
  const c = useColors();
  const { profile } = useApp();
  const { byId } = useCatalog();
  const shake = useSharedValue(0);
  const fall = useSharedValue(0);
  useEffect(() => {
    shake.value = withRepeat(withSequence(withTiming(1, { duration: 55 }), withTiming(-1, { duration: 55 })), -1, true);
    fall.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false);
    buzz.medium();
  }, [shake, fall]);
  const shiver = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value * 3 }, { rotate: `${shake.value * 1.2}deg` }] }));
  const text = useAnimatedStyle(() => ({ transform: [{ translateX: -shake.value * 2 }, { translateY: shake.value }] }));
  const flakes = useAnimatedStyle(() => ({ transform: [{ translateY: fall.value * 260 - 40 }] }));
  return (
    <View style={{ gap: 12, alignItems: "center" }}>
      <View style={[styles.coldStage, { backgroundColor: c.alpha("#7FC8FF", 0.14), borderColor: c.alpha("#7FC8FF", 0.4) }]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flakes]}>
          {FLAKES.map((f, i) => (
            <MaterialCommunityIcons key={i} name="snowflake" size={f.s} color="#CFEAFF" style={{ position: "absolute", left: `${f.x}%`, top: f.y, opacity: 0.85 }} />
          ))}
        </Animated.View>
        <Animated.View style={[styles.coldAvatar, shiver]}>
          <AvatarDisplay avatar={profile?.avatar} equipped={{}} catalog={byId} size="lg" interactive={false} />
        </Animated.View>
      </View>
      <Animated.Text style={[styles.brr, { color: "#9AD4FF" }, text]}>BRRRRR</Animated.Text>
      <Text style={[styles.title, { color: c.foreground, textAlign: "center" }]}>You must be cold. Let's buy some clothes.</Text>
      <Text style={[styles.body, { color: c.mutedForeground, textAlign: "center" }]}>
        The starter kit — tee, shorts and trainers — is free. We'll walk you to it.
      </Text>
      <Pressable accessibilityRole="button" onPress={nextTourStep} style={[styles.btn, styles.wide, { backgroundColor: c.primary, borderColor: c.primary }]}>
        <Text style={[styles.btnText, { color: c.primaryForeground, textAlign: "center" }]}>Let's go shopping</Text>
      </Pressable>
    </View>
  );
}

const FLAKES = [
  { x: 8, y: 0, s: 14 }, { x: 22, y: 60, s: 10 }, { x: 40, y: 20, s: 16 }, { x: 58, y: 80, s: 11 },
  { x: 72, y: 10, s: 13 }, { x: 86, y: 50, s: 15 }, { x: 15, y: 120, s: 12 }, { x: 64, y: 140, s: 10 },
  { x: 33, y: 170, s: 13 }, { x: 80, y: 190, s: 11 },
];

/** The first-bet prize box: tap to open, 10 credits from the server (once per account). */
const COINS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  const d = 90 + (i % 3) * 28;
  return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 40, delay: (i % 4) * 40, size: 18 + (i % 3) * 4 };
});

function Coin({ dx, dy, delay, size, color }: { dx: number; dy: number; delay: number; size: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [t, delay]);
  const a = useAnimatedStyle(() => ({
    opacity: t.value < 0.75 ? 1 : 1 - (t.value - 0.75) * 4,
    transform: [{ translateX: dx * t.value }, { translateY: dy * t.value + 120 * t.value * t.value }, { rotate: `${t.value * 540}deg` }, { scale: 0.4 + t.value * 0.8 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, a]}>
      <MaterialCommunityIcons name="star-four-points-circle" size={size} color={color} />
    </Animated.View>
  );
}

function CountUp({ to, color }: { to: number; color: string }) {
  const [n, setN] = useState(0);
  const v = useSharedValue(0);
  const pop = useSharedValue(0.4);
  useEffect(() => {
    v.value = withTiming(to, { duration: 900, easing: Easing.out(Easing.quad) });
    pop.value = withSequence(withSpring(1.35, { damping: 6 }), withSpring(1, { damping: 10 }));
    const id = setInterval(() => setN(Math.round(v.value)), 40);
    const end = setTimeout(() => {
      clearInterval(id);
      setN(to);
      buzz.success();
    }, 950);
    return () => {
      clearInterval(id);
      clearTimeout(end);
    };
  }, [to, v, pop]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return <Animated.Text style={[styles.brr, { color }, a]}>+{n} CREDITS</Animated.Text>;
}

function PrizeScene() {
  const c = useColors();
  const [phase, setPhase] = useState<"closed" | "opening" | "open" | "error" | "ineligible">("closed");
  const [credits, setCredits] = useState(0);
  const bob = useSharedValue(0);
  const burst = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(withSequence(withTiming(-8, { duration: 500 }), withTiming(0, { duration: 500 })), -1);
    glow.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [bob, glow]);
  // Same open as the Home prize boxes: a rattle that builds over CHARGE_MS with
  // escalating haptic ticks, then the lid bursts.
  const charge = useSharedValue(0);
  const wob = useSharedValue(0);
  const rattle = useFrameCallback((f) => {
    wob.value += (f.timeSincePreviousFrame ?? 16) * (0.045 + 0.06 * charge.value);
  }, false);
  useEffect(() => {
    if (phase !== "opening") {
      rattle.setActive(false);
      charge.value = withTiming(0, { duration: 150 });
      if (phase === "open") burst.value = withSequence(withTiming(1.35, { duration: 160 }), withSpring(1.1, { damping: 7 }));
      return;
    }
    charge.value = 0;
    charge.value = withTiming(1, { duration: CHARGE_MS, easing: Easing.in(Easing.quad) });
    rattle.setActive(true);
    let t = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const k = Math.min(1, t / CHARGE_MS);
      (k > 0.75 ? buzz.heavy : k > 0.4 ? buzz.medium : buzz.light)();
      const gap = 210 - 160 * k;
      t += gap;
      if (t < CHARGE_MS + 400) timer = setTimeout(step, gap);
    };
    step();
    return () => {
      clearTimeout(timer);
      rattle.setActive(false);
    };
  }, [phase, charge, rattle, burst]);
  const box = useAnimatedStyle(() => {
    const amp = 2 + 11 * charge.value;
    return {
      transform: [
        { translateY: phase === "closed" ? bob.value : 0 },
        { translateX: Math.sin(wob.value * 1.7) * amp * 0.35 * charge.value },
        { rotate: `${Math.sin(wob.value) * amp * (charge.value > 0.01 ? 1 : 0)}deg` },
        { scale: phase === "open" ? burst.value : 1 + 0.12 * charge.value },
      ],
    };
  });
  const halo = useAnimatedStyle(() => ({
    opacity: phase === "opening" ? 0.25 + 0.6 * charge.value : 0,
    transform: [{ scale: 0.9 + 0.6 * charge.value }],
  }));
  const rays = useAnimatedStyle(() => ({ opacity: phase === "open" ? 0.35 + glow.value * 0.4 : 0, transform: [{ rotate: `${glow.value * 90}deg` }, { scale: 1 + glow.value * 0.15 }] }));
  const open = async () => {
    if (phase !== "closed" && phase !== "error") return;
    setPhase("opening");
    buzz.heavy();
    const minShake = new Promise((r) => setTimeout(r, CHARGE_MS));
    try {
      const [res] = await Promise.all([api.claimTutorialGift({}), minShake]);
      setCredits(res.already ? 0 : res.credits);
      setPhase("open");
      buzz.heavy();
    } catch (e) {
      await minShake;
      setPhase((e as { code?: string })?.code?.includes("failed-precondition") ? "ineligible" : "error");
    }
  };
  return (
    <View style={{ gap: 12, alignItems: "center" }}>
      <View style={styles.giftStage}>
        <Animated.View pointerEvents="none" style={[styles.rays, { backgroundColor: c.alpha(c.primary, 0.25) }, rays]} />
        <Animated.View pointerEvents="none" style={[styles.rays, { borderRadius: 110, backgroundColor: c.alpha("#FFD54A", 0.35) }, halo]} />
        {phase === "open" && credits ? COINS.map((k, i) => <Coin key={i} {...k} color={i % 2 ? c.primary : "#FFD54A"} />) : null}
        <Animated.View style={[styles.giftBox, box]}>
          <Image source={require("@/assets/images/starter-chest.png")} style={styles.chestImg} resizeMode="contain" />
        </Animated.View>
      </View>
      {phase === "open" ? (
        credits ? (
          <CountUp to={credits} color={c.primary} />
        ) : (
          <Animated.Text entering={ZoomIn.duration(300)} style={[styles.brr, { color: c.primary }]}>ALREADY OPENED</Animated.Text>
        )
      ) : null}
      <Text style={[styles.title, { color: c.foreground, textAlign: "center" }]}>
        {phase === "open" ? "Now let's make your first bet." : "A treasure chest for your first bet!"}
      </Text>
      <Text style={[styles.body, { color: c.mutedForeground, textAlign: "center" }]}>
        {phase === "open"
          ? "We'll walk you through putting 10 credits on a game. Win and it pays out automatically when the game ends."
          : phase === "error"
            ? "Couldn't open it — check your connection and try again."
            : phase === "ineligible"
              ? "This chest is only for players who haven't placed a bet yet."
            : "Tap the chest to open it."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={phase === "open" ? nextTourStep : phase === "ineligible" ? () => endTour() : open}
        disabled={phase === "opening"}
        style={[styles.btn, styles.wide, { backgroundColor: c.primary, borderColor: c.primary, opacity: phase === "opening" ? 0.6 : 1 }]}
      >
        <Text style={[styles.btnText, { color: c.primaryForeground, textAlign: "center" }]}>
          {phase === "open" ? "Let's bet" : phase === "opening" ? "Opening…" : phase === "error" ? "Try again" : phase === "ineligible" ? "Close" : "Open it"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  glow: { borderWidth: 3, borderRadius: 14, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  pill: { width: 200, paddingHorizontal: 10, height: 34, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
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
  wide: { alignSelf: "stretch", paddingVertical: 14 },
  sceneWrap: { alignItems: "center", justifyContent: "center", padding: 16 },
  sceneCard: { width: "100%", maxWidth: 440, borderRadius: 22, borderWidth: 1.5, padding: 18, gap: 10 },
  coldStage: { width: "100%", height: 230, borderRadius: 18, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  coldAvatar: { width: 150, height: 210 },
  brr: { fontSize: 38, fontFamily: "Inter_900Black", letterSpacing: 2 },
  placedCard: { width: "100%", maxWidth: 440, borderRadius: 24, borderWidth: 2, padding: 22, gap: 14, alignItems: "center" },
  placedIcon: { width: 130, height: 130, borderRadius: 30, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  placedTicket: { alignSelf: "stretch", borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 4 },
  placedTeam: { fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  placedWin: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  giftStage: { width: "100%", height: 200, alignItems: "center", justifyContent: "center" },
  rays: { position: "absolute", width: 220, height: 220, borderRadius: 40 },
  giftBox: { width: 150, height: 150, borderRadius: 28, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  chestImg: { width: 150, height: 150 },
});

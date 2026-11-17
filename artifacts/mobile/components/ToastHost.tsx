import { MaterialCommunityIcons } from "@expo/vector-icons";
import { markPromptResult } from "@/lib/promptGate";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { liveActivitySupported, startActivity } from "@/modules/live-activity";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import BetLockedOverlay from "@/components/fx/BetLockedOverlay";
import Burst from "@/components/fx/Burst";
import Shimmer from "@/components/fx/Shimmer";
import PushPrimer from "@/components/PushPrimer";
import { useLeague } from "@/context/LeagueContext";
import { useApp } from "@/context/AppContext";
import * as api from "@/lib/api";
import { useNotifications } from "@/context/NotificationContext";
import { markPushPrimerShown, pushPrimerDue } from "@/lib/settings";
import type { BetLockedInput } from "@/context/ToastContext";
import { Amount } from "@/components/ui";
import { useToast, type Toast, type ToastKind } from "@/context/ToastContext";
import { useOverlayBusy } from "@/lib/overlayTurns";
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
  const { current, queued, dismiss, locked, clearLocked, show } = useToast();
  const overlayBusy = useOverlayBusy();
  const { pushStatus, enablePush } = useNotifications();
  const { sendMessage } = useLeague();
  const [primer, setPrimer] = useState(false);
  const { profile } = useApp();
  const picksToday = profile?.picksToday?.count ?? 0;

  // After the stamp: the push pre-prompt the first time (the moment a user has a
  // reason to want it), otherwise a one-tap "Post to league" for league bets.
  const onLockedDone = useCallback(
    (bet: BetLockedInput) => {
      clearLocked();
      // Live Activity for this game: the bet confirm is the user action ActivityKit requires.
      if (bet.gameId && liveActivitySupported()) void startGameActivity(bet.gameId, bet.teamAbbr);
      if (pushStatus === "undetermined" && pushPrimerDue()) {
        markPushPrimerShown();
        setPrimer(true);
        return;
      }
      // Reality check: a neutral nudge every 10 picks in a day.
      if (picksToday > 0 && picksToday % 10 === 0) {
        show({
          id: `reality_${profile?.picksToday?.day}_${picksToday}`,
          kind: "info",
          icon: "timer-sand",
          title: `${picksToday} picks today`,
          body: "Set a daily limit or take a break anytime in the Locker.",
        });
        return;
      }
      if (bet.leagueId && !bet.hidden) {
        const leagueId = bet.leagueId;
        show({
          id: `post_${leagueId}_${bet.gameId ?? ""}_${bet.teamAbbr}`,
          kind: "league",
          icon: "bullhorn-outline",
          title: "Post it to the league?",
          body: `${bet.teamName} · ${bet.odds.toFixed(2)}x`,
          cta: "Post",
          durationMs: 6000,
          onPress: () => {
            sendMessage(leagueId, `🔒 Locked in: ${bet.teamName} at ${bet.odds.toFixed(2)}x. Who's fading me?`);
            haptic.success();
          },
        });
      }
    },
    [clearLocked, pushStatus, show, sendMessage, picksToday, profile?.picksToday?.day]
  );

  return (
    <>
      {/* Banners wait while a popup is up (it would cover them), then carry on one by one. */}
      {current && !overlayBusy ? <ToastCard key={current.id} toast={current} queued={queued} onGone={() => dismiss(current.id)} /> : null}
      {locked ? <BetLockedOverlay key={locked.key} bet={locked} onDone={() => onLockedDone(locked)} /> : null}
      {primer ? (
        <PushPrimer
          onAccept={() => {
            setPrimer(false);
            void enablePush().then((s) => {
              markPromptResult("push", s === "granted");
              // The primer promised "when the game swings": opt into sweat alerts with it.
              if (s === "granted") api.setAlertPrefs({ sweat: true }).catch(() => {});
            });
          }}
          onDecline={() => {
            markPromptResult("push", false);
            setPrimer(false);
          }}
        />
      ) : null}
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
  const pop = useSharedValue(0); // icon badge pop-in
  const glow = useSharedValue(0); // accent pulse on arrival

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
    if (!reduced) {
      pop.value = withDelay(120, withSpring(1, SPRING.pop));
      glow.value = withSequence(withTiming(1, { duration: 260 }), withDelay(500, withTiming(0, { duration: 700 })));
    } else {
      pop.value = 1;
    }
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
    // The border breathes with the arrival pulse, then settles.
    shadowOpacity: 0.4 + 0.25 * glow.value,
  }));
  const badge = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.4, 1]) }, { rotate: `${interpolate(pop.value, [0, 1], [-30, 0])}deg` }],
    opacity: pop.value,
  }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: life.value }] }));

  const tappable = !!(toast.href || toast.onPress);
  const open = () => {
    hide();
    haptic.tick();
    if (toast.onPress) toast.onPress();
    else if (toast.href) router.navigate(toast.href);
  };

  const celebrate = toast.kind === "win";

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(tone, 0.55), shadowColor: celebrate ? tone : c.shadow }, card]}>
          {/* Accent wash: a soft tint of the toast's colour fading out to the right. */}
          <View pointerEvents="none" style={styles.washClip}>
            <LinearGradient colors={[c.alpha(tone, 0.2), c.alpha(tone, 0.0)]} start={{ x: 0, y: 0.5 }} end={{ x: 0.85, y: 0.5 }} style={StyleSheet.absoluteFill} />
            {celebrate && !reduced ? <Shimmer color={tone} intensity={0.22} every={2200} /> : null}
            {celebrate && !reduced ? <Burst colors={[tone, c.positive, "#FFD166"]} trigger={toast.id} count={22} power={0.55} duration={1100} haptics={false} /> : null}
          </View>
          {/* Main area and dismiss are siblings: a Pressable inside a Pressable is <button> in <button> on web. */}
          <View style={styles.row}>
          <Pressable
            accessibilityRole={tappable ? "button" : "text"}
            accessibilityLabel={`${toast.title}${toast.body ? `. ${toast.body}` : ""}${toast.cta ? `. ${toast.cta}` : ""}`}
            accessibilityHint="Swipe up to dismiss"
            onPress={tappable ? open : undefined}
            style={styles.main}
          >
            <Animated.View style={[styles.icon, { backgroundColor: c.alpha(tone, 0.16), borderColor: c.alpha(tone, 0.4) }, badge]}>
              <MaterialCommunityIcons name={toast.icon ?? kind.icon} size={20} color={tone} />
            </Animated.View>
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
              <View style={[styles.ctaPill, { backgroundColor: c.alpha(tone, 0.14), borderColor: c.alpha(tone, 0.45) }]}>
                <Text style={[styles.cta, { color: tone }]}>{toast.cta}</Text>
                <MaterialCommunityIcons name="chevron-right" size={14} color={tone} style={{ marginRight: -3 }} />
              </View>
            ) : null}
          </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} onPress={() => hide()}>
              <MaterialCommunityIcons name="close" size={16} color={c.subtleForeground} />
            </Pressable>
          </View>
          {toast.actions?.length ? (
            <View style={styles.actionsRow}>
              {toast.actions.slice(0, 2).map((a) => {
                const t2 = a.destructive ? c.negative : tone;
                return (
                  <Pressable
                    key={a.label}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    onPress={() => {
                      haptic.tick();
                      a.onPress();
                      hide();
                    }}
                    style={[styles.actionPill, { backgroundColor: c.alpha(t2, 0.14), borderColor: c.alpha(t2, 0.45) }]}
                  >
                    <Text style={[styles.cta, { color: t2 }]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View style={[styles.track, { backgroundColor: c.alpha(tone, 0.12) }]}>
            <Animated.View style={[styles.fill, { backgroundColor: tone }, bar]} />
          </View>
          {queued > 0 ? (
            <>
              <View style={[styles.stack, { backgroundColor: c.card, borderColor: c.border }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${queued} more notifications. See all in Activity`}
                hitSlop={8}
                onPress={() => {
                  hide();
                  router.navigate("/activity");
                }}
                style={[styles.queueBadge, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Text style={[styles.queueText, { color: c.mutedForeground }]}>+{queued} more</Text>
              </Pressable>
            </>
          ) : null}
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
  // Clips the accent wash + shimmer to the card's rounded corners (the card itself stays overflow: visible for the stack sliver).
  washClip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 17, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },
  body: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
  cta: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  ctaPill: { flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 62, paddingBottom: 10, marginTop: -2 },
  actionPill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 16 },
  track: { height: 3, marginHorizontal: 14, marginBottom: 8, borderRadius: 2, overflow: "hidden" },
  // Scaled from the left edge as the timer drains.
  fill: { height: 3, width: "100%", transformOrigin: "left" },
  // A sliver of the next banner peeking out under this one.
  stack: { position: "absolute", left: 14, right: 14, bottom: -5, height: 8, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: 1, borderTopWidth: 0, zIndex: -1 },
  queueBadge: { position: "absolute", bottom: -13, alignSelf: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1.5 },
  queueText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});

async function startGameActivity(gameId: string, teamAbbr: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const g = await getDoc(doc(db, "games", gameId));
    if (!g.exists()) return;
    const home = g.get("homeTeam.abbreviation") as string;
    const away = g.get("awayTeam.abbreviation") as string;
    await startActivity(
      gameId,
      { homeAbbr: home, awayAbbr: away, yourSide: teamAbbr === away ? "away" : "home" },
      { homeScore: (g.get("homeScore") as number) ?? 0, awayScore: (g.get("awayScore") as number) ?? 0, clock: "", status: "live" }
    );
  } catch {}
}

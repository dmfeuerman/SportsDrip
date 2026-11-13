import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Burst from "@/components/fx/Burst";
import { Pressable } from "@/components/fx/Tap";
import { Amount, Button, Card, Pill } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import { friendlyError, streakWager, type StreakWagerInfo } from "@/lib/api";
import { haptic, SPRING } from "@/lib/motion";
import { OVERLAY, useHoldOverlay } from "@/lib/overlayTurns";
import { nyDayOf } from "@/lib/streakGrid";

/** Mirrors functions/src/lib/streakWager.ts. The server decides. */
const WAGER_DAYS = 7;
const STAKES = [500, 1000, 2500] as const;

const dayNum = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) : 0;
};

/**
 * Streak wager: stake credits that you'll add seven days to your pick streak.
 * Doubles if you get there. One at a time.
 */
export default function StreakWagerCard() {
  const c = useColors();
  const { profile, balance } = useApp();
  const { show } = useToast();
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localWager, setLocalWager] = useState<StreakWagerInfo | null>(null);
  const [lockedPopup, setLockedPopup] = useState<StreakWagerInfo | null>(null);
  const wager = profile?.streakWager ?? localWager ?? null;
  const streak = profile?.streak ?? null;
  const today = nyDayOf(now);
  const gap = streak?.lastDay ? dayNum(today) - dayNum(streak.lastDay) : 99;
  const count = streak?.count ?? 0;
  const alive = count > 0 && (gap <= 1 || (gap === 2 && (streak?.freezes ?? 0) > 0));
  const days = wager ? Math.max(0, Math.min(WAGER_DAYS, count - wager.startCount)) : 0;

  useEffect(() => {
    if (profile?.streakWager && localWager) {
      setLocalWager(null);
    }
  }, [profile?.streakWager, localWager]);

  // Decided (hit the target, or the streak lapsed): ask the server to grade it, once per state.
  const decided = !!wager && ((alive && count >= wager.target) || (!alive && !(wager.startCount === 0 && wager.startDay === today)) || (count < wager.startCount && streak?.repairPending?.day !== today));
  const asked = useRef("");
  useEffect(() => {
    if (!wager || !decided) return;
    const key = `${wager.startDay}:${count}:${today}`;
    if (asked.current === key) return;
    asked.current = key;
    streakWager({ action: "settle" })
      .then((res) => {
        if (res.state === "won") {
          haptic.success();
          show({ id: `wager_${wager.startDay}`, kind: "win", icon: "fire", title: "Streak wager won", body: `Seven more days banked. +${(res.credits ?? 0).toLocaleString()} credits.`, durationMs: 7000 });
        } else if (res.state === "lost") {
          show({ id: `wager_${wager.startDay}`, kind: "info", icon: "fire-off", title: "Streak wager ended", body: "The streak lapsed before day seven. Start a new one any time.", durationMs: 7000 });
        }
      })
      .catch(() => {});
  }, [wager, decided, count, today, show]);

  if (!profile) return null;

  const place = (stake: number) => {
    if (busy) return;
    haptic.medium();
    setBusy(true);
    setErr(null);
    streakWager({ action: "place", stake })
      .then((res) => {
        const placed: StreakWagerInfo = res.wager ?? {
          stake,
          startCount: alive ? count : 0,
          startDay: today,
          target: (alive ? count : 0) + WAGER_DAYS,
        };
        setLocalWager(placed);
        setLockedPopup(placed);
      })
      .catch((e: unknown) => setErr(friendlyError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.head}>
          <MaterialCommunityIcons name="fire" size={18} color={c.warning} />
          <Text style={[styles.title, { color: c.foreground }]}>Streak Wager</Text>
          {wager ? <Pill label={`Pays ${(wager.stake * 2).toLocaleString()}`} tone="money" /> : <Pill label="Doubles" tone="money" />}
        </View>
        {wager ? (
          <>
            <Text style={[styles.body, { color: c.mutedForeground }]}>
              {days} of {WAGER_DAYS} days banked. Make a pick every day to keep it alive.
            </Text>
            <View style={styles.pips}>
              {Array.from({ length: WAGER_DAYS }, (_, i) => (
                <View key={i} style={[styles.pip, { backgroundColor: i < days ? c.primary : c.secondary }]} />
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.body, { color: c.mutedForeground }]}>
              Stake credits that you'll add {WAGER_DAYS} days to your pick streak{alive ? ` (now ${count})` : ""}. Get there and the stake comes back doubled.
              {alive ? "" : " Make a pick today to start it."}
            </Text>
            <View style={styles.row}>
              {STAKES.map((s) => (
                <Button key={s} label={String(s)} size="sm" variant="secondary" disabled={busy || balance < s} onPress={() => place(s)} style={{ flex: 1 }} />
              ))}
            </View>
          </>
        )}
        {err ? <Text style={[styles.body, { color: c.negative }]}>{err}</Text> : null}
      </Card>
      {lockedPopup ? <StreakWagerSetModal wager={lockedPopup} onClose={() => setLockedPopup(null)} /> : null}
    </>
  );
}

function StreakWagerSetModal({ wager, onClose }: { wager: StreakWagerInfo; onClose: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  useHoldOverlay("streakWager", true, OVERLAY.streakWager);

  const pop = useSharedValue(reduced ? 1 : 0);
  const stamp = useSharedValue(reduced ? 1 : 0);
  const payout = wager.stake * 2;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      `Streak wager set. Staked ${wager.stake} credits to add ${WAGER_DAYS} days to your pick streak for ${payout} credits.`
    );
    haptic.celebrate(false);
    if (!reduced) {
      pop.value = withSpring(1, SPRING.pop);
      stamp.value = withDelay(220, withSpring(1, { damping: 11, stiffness: 240, mass: 0.7 }));
    }
  }, [reduced, pop, stamp, wager.stake, payout]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 1.5),
    transform: [{ translateY: (1 - pop.value) * 60 }, { scale: 0.86 + 0.14 * pop.value }],
  }));

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + 0.4 * stamp.value }, { rotate: `${(1 - stamp.value) * -12}deg` }],
  }));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(140)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <Burst colors={[c.warning, c.primary, "#FFC83D", "#FFFFFF"]} count={44} power={1.15} originY={0.4} />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.modalCard,
            { backgroundColor: c.elevated, borderColor: c.alpha(c.warning, 0.65), shadowColor: c.warning },
            cardStyle,
          ]}
        >
          <View style={[styles.stripe, { backgroundColor: c.warning }]} />
          <Animated.View style={[styles.flameWrap, { backgroundColor: c.alpha(c.warning, 0.16), borderColor: c.alpha(c.warning, 0.45) }, flameStyle]}>
            <MaterialCommunityIcons name="fire" size={44} color={c.warning} />
          </Animated.View>

          <Animated.Text entering={FadeInDown.delay(80).duration(260)} style={[styles.kicker, { color: c.warning }]}>
            STREAK WAGER SET
          </Animated.Text>
          <Text style={[styles.modalTitle, { color: c.foreground }]}>7-Day Streak Challenge</Text>
          <Text style={[styles.modalSub, { color: c.mutedForeground }]}>
            Make at least one pick every day for the next {WAGER_DAYS} days (to reach a {wager.target}-day streak) and double your stake.
          </Text>

          <View style={[styles.pipsWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.pipsLabelRow}>
              <Text style={[styles.pipsLabel, { color: c.mutedForeground }]}>PROGRESS</Text>
              <Text style={[styles.pipsValue, { color: c.foreground }]}>0 / {WAGER_DAYS} days</Text>
            </View>
            <View style={styles.pips}>
              {Array.from({ length: WAGER_DAYS }, (_, i) => (
                <View key={i} style={[styles.modalPip, { backgroundColor: c.secondary, borderColor: c.alpha(c.warning, 0.35) }]} />
              ))}
            </View>
          </View>

          <View style={[styles.numsBox, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ gap: 2 }}>
              <Text style={[styles.numLabel, { color: c.mutedForeground }]}>STAKED</Text>
              <Amount value={wager.stake} currency="credits" size="md" />
            </View>
            <MaterialCommunityIcons name="arrow-right-bold" size={20} color={c.warning} />
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={[styles.numLabel, { color: c.positive }]}>2X PAYOUT</Text>
              <Amount value={payout} currency="credits" size="lg" tone="positive" />
            </View>
          </View>

          <View style={{ alignSelf: "stretch", marginTop: 4 }}>
            <Button label="Let's Go" icon="fire" onPress={onClose} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold", flex: 1 },
  body: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", gap: 8 },
  pips: { flexDirection: "row", gap: 5 },
  pip: { flex: 1, height: 6, borderRadius: 3 },
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: {
    width: "100%",
    maxWidth: 350,
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: "center",
    gap: 10,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  stripe: { height: 5, alignSelf: "stretch", marginHorizontal: -20, marginBottom: 6 },
  flameWrap: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 2.2 },
  modalTitle: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: -0.5, textAlign: "center" },
  modalSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", textAlign: "center" },
  pipsWrap: {
    alignSelf: "stretch",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  pipsLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pipsLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  pipsValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  modalPip: { flex: 1, height: 8, borderRadius: 4, borderWidth: 1 },
  numsBox: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  numLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
});

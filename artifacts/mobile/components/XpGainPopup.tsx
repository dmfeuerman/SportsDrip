import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { LevelBadge } from "@/components/LevelBar";
import { Button } from "@/components/ui";
import { levelFromXp, progressOf, scaledXp, XP } from "@/constants/progression";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { OVERLAY, useOverlayTurn } from "@/lib/overlayTurns";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface XpReasonInfo {
  label: string;
  icon: IconName;
}

type Gain = { from: number; to: number; reason: XpReasonInfo };
const KEY = (uid: string) => `sportdrip.xpSeen.v1.${uid}`;
const STEPS = 80;
const COINS = 10;

let pendingClientReason: { info: XpReasonInfo; at: number } | null = null;

/**
 * Records what player action just triggered an XP gain so the XP popup can
 * display the exact context immediately when the server snapshot arrives.
 */
export function recordXpReason(label: string, icon: IconName = "lightning-bolt") {
  pendingClientReason = { info: { label, icon }, at: Date.now() };
}

export function describeXpReasonCode(code: string | undefined | null, note?: string | null): XpReasonInfo | null {
  switch (code) {
    case "bet_payout":
      return { label: note ? `Won a Bet · ${note}` : "Won a Bet", icon: "trophy-outline" };
    case "challenge_payout":
      return { label: "Won a 1v1 Friend Challenge", icon: "sword-cross" };
    case "league_bet_won":
      return { label: "Won a League Bet", icon: "shield-star-outline" };
    case "league_payout":
      return { label: "Finished in the Money in a League", icon: "podium-gold" };
    case "purchase":
      return { label: note ? `Drip Shop · ${note}` : "Bought from the Drip Shop", icon: "shopping-outline" };
    case "prize_box": {
      const boxName = note
        ? note.replace(/\b(bronze|silver|gold)\b/i, (m) => `${m[0]!.toUpperCase()}${m.slice(1).toLowerCase()} Prize`)
        : null;
      return { label: boxName ? `Opened ${boxName}` : "Opened a Prize Box", icon: "gift-outline" };
    }
    case "ad_reward":
      return { label: "Watched a Bonus Video", icon: "play-circle-outline" };
    case "new_friend":
      return { label: "Added a New Friend", icon: "account-plus-outline" };
    case "daily_pick":
      return { label: "Locked in Today's Daily Free Bet", icon: "calendar-check-outline" };
    case "quest":
      return { label: "Completed a Weekly Quest", icon: "flag-checkered" };
    case "referral":
      return { label: "Friend Joined With Your Invite Code", icon: "account-heart-outline" };
    case "joined_with_code":
      return { label: "Joined With a Friend's Invite Code", icon: "ticket-percent-outline" };
    default:
      return null;
  }
}

function inferXpReasonByAmount(fromXp: number, toXp: number): XpReasonInfo {
  const gained = toXp - fromXp;
  const lvl = levelFromXp(fromXp);
  if (gained === scaledXp(XP.prizeBox, lvl)) {
    return { label: "Opened a Prize Box", icon: "gift-outline" };
  }
  if (gained === scaledXp(XP.adReward, lvl)) {
    return { label: "Watched a Bonus Video", icon: "play-circle-outline" };
  }
  if (gained === scaledXp(XP.newFriend, lvl)) {
    return { label: "Added a New Friend", icon: "account-plus-outline" };
  }
  if (gained === scaledXp(XP.leagueBetWin, lvl)) {
    return { label: "Won a League Bet", icon: "shield-star-outline" };
  }
  if (gained === scaledXp(XP.challengeWin, lvl)) {
    return { label: "Won a 1v1 Friend Challenge", icon: "sword-cross" };
  }
  if (gained === scaledXp(XP.leaguePayout, lvl)) {
    return { label: "Finished in the Money in a League", icon: "podium-gold" };
  }
  if (gained === scaledXp(XP.referrer, lvl)) {
    return { label: "Friend Joined With Your Invite Code", icon: "account-heart-outline" };
  }
  if (gained === scaledXp(XP.referred, lvl)) {
    return { label: "Joined With a Friend's Invite Code", icon: "ticket-percent-outline" };
  }
  const minBetWin = scaledXp(XP.betWin, lvl);
  const maxBetWin = scaledXp(XP.betWin + XP.betWinBonusCap, lvl);
  if (gained >= minBetWin && gained <= maxBetWin) {
    return { label: "Won a Bet", icon: "trophy-outline" };
  }
  const minPurchase = scaledXp(XP.purchaseMin, lvl);
  const maxPurchase = scaledXp(XP.purchaseMax, lvl);
  if (gained >= minPurchase && gained <= maxPurchase) {
    return { label: "Drip Shop Purchase", icon: "shopping-outline" };
  }
  return { label: "Completed an Action", icon: "lightning-bolt" };
}

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
  const xpLast = profile?.xpLast ?? null;
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
    } else if (xp > seen) {
      const from = seen;
      const to = xp;
      // 1. Check fresh client-recorded reason (within 60s)
      if (pendingClientReason && Date.now() - pendingClientReason.at < 60_000) {
        const info = pendingClientReason.info;
        pendingClientReason = null;
        setGain({ from, to, reason: info });
        return;
      }
      // 2. Check server-written profile.xpLast
      const fromServer = xpLast?.reason ? describeXpReasonCode(xpLast.reason, xpLast.note) : null;
      if (fromServer) {
        setGain({ from, to, reason: fromServer });
        return;
      }
      // 3. Fallback: infer immediately from XP amount, and refine from latest ledger entry if available
      const fallback = inferXpReasonByAmount(from, to);
      setGain({ from, to, reason: fallback });
      if (!DEMO) {
        const db = getDb();
        if (db) {
          getDocs(query(collection(db, "users", uid, "ledger"), orderBy("createdAt", "desc"), limit(1)))
            .then((snap) => {
              const docSnap = snap.docs[0];
              if (!docSnap) return;
              const data = docSnap.data() as { type?: string; note?: string };
              const ledgerReason = describeXpReasonCode(data.type, data.note);
              if (ledgerReason) {
                setGain((cur) => (cur && cur.from === from && cur.to === to ? { ...cur, reason: ledgerReason } : cur));
              }
            })
            .catch(() => {});
        }
      }
    } else if (xp < seen) {
      setSeen(xp);
      AsyncStorage.setItem(KEY(uid), String(xp)).catch(() => {});
    }
  }, [uid, seen, xp, gain, xpLast]);

  const close = () => {
    if (uid && gain) AsyncStorage.setItem(KEY(uid), String(gain.to)).catch(() => {});
    if (gain) setSeen(gain.to);
    setGain(null);
  };

  if (!gain || !myTurn) return null;
  return <XpGain from={gain.from} to={gain.to} reason={gain.reason} onClose={close} />;
}

export function XpGain({ from, to, reason, onClose }: { from: number; to: number; reason?: XpReasonInfo; onClose: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const gained = to - from;
  const duration = Math.min(2600, 900 + gained * 4);
  const resolvedReason = reason ?? inferXpReasonByAmount(from, to);

  // Pre-computed bar fill at each step, so the worklet only interpolates.
  const { inRange, pcts } = useMemo(() => {
    const inRange: number[] = [];
    const pcts: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const v = Math.round(from + (gained * i) / STEPS);
      inRange.push(i / STEPS);
      pcts.push(progressOf(v).pct);
    }
    return { inRange, pcts };
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
          scheduleOnRN(setDone, true);
        }
      })
    );
    return () => cancelAnimation(t);
  }, [reduced, t, duration]);

  // No dependency array on useAnimatedReaction (Reanimated v4 native worklets auto-track shared values).
  useAnimatedReaction(
    () => Math.round(t.value * 24),
    (stepIdx, prev) => {
      if (stepIdx !== prev && prev !== null) {
        const nextXp = Math.round(from + (gained * stepIdx) / 24);
        scheduleOnRN(setShownXp, nextXp);
      }
    }
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

          <Animated.View
            entering={FadeInDown.delay(90).duration(280)}
            style={[
              styles.reasonPill,
              {
                backgroundColor: c.alpha(c.primary, 0.14),
                borderColor: c.alpha(c.primary, 0.4),
              },
            ]}
          >
            <MaterialCommunityIcons name={resolvedReason.icon} size={16} color={c.primary} />
            <Text style={[styles.reasonText, { color: c.foreground }]} numberOfLines={2}>
              {resolvedReason.label}
            </Text>
          </Animated.View>

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
    return () => cancelAnimation(k);
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
  reasonPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
  },
  reasonText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    flexShrink: 1,
  },
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

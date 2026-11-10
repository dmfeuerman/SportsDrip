import { MaterialCommunityIcons } from "@expo/vector-icons";
import StreakBanner from "@/components/StreakBanner";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import BonusVideoCard from "@/components/ads/BonusVideoCard";
import { Pressable } from "@/components/fx/Tap";
import PrizeBox, { CHARGE_MS } from "@/components/PrizeBox";
import SpinWheel from "@/components/SpinWheel";
import { recordXpReason } from "@/components/XpGainPopup";
import { BOX_DISPLAY, BOX_ODDS, BOX_PITY_AFTER, BOX_TIERS } from "@/constants/prizeTypes";
import { useAds } from "@/context/AdsContext";
import { useApp, type PrizeBoxState } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import type { BoxTier } from "@/lib/api";

/**
 * Home's prize boxes: start a timer, open a ready box (rattle → wheel), and
 * reset a claimed one, all in place. Credits are committed server-side
 * before the wheel turns; the wheel is presentation.
 */
export default function RewardsCard() {
  const c = useColors();
  const { profile, prizeBoxes, openBox, claimBox, resetBox, error } = useApp();
  const { breakpoint } = useAds();

  const [spinning, setSpinning] = useState<BoxTier | null>(null);
  const [reward, setReward] = useState<number | null>(null);
  const [busy, setBusy] = useState<BoxTier | null>(null);
  const [charging, setCharging] = useState<BoxTier | null>(null);
  const [now, setNow] = useState(Date.now());
  const [info, setInfo] = useState<"odds" | "streak" | null>(null);
  const showOdds = info === "odds";

  // Optimistic box states: a start or reset shows at once; each override
  // yields when the server snapshot reaches the same state, or rolls back.
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

  // One 1s tick, only while something counts down.
  const anyWaiting = BOX_TIERS.some((t) => {
    const b = boxes[t];
    return b.state === "waiting" && (b.readyAt ?? 0) > Date.now();
  });
  useEffect(() => {
    setNow(Date.now());
    if (!anyWaiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyWaiting]);

  const handleOpen = useCallback(
    async (tier: BoxTier) => {
      const t = Date.now();
      assume(tier, { ...prizeBoxes[tier], state: "waiting", openedAt: t, readyAt: t + BOX_DISPLAY[tier].waitHours * 3600_000, rewardCredits: null });
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

  // One box at a time: a second tap (on any box) while one is opening does nothing.
  const opening = useRef(false);
  const handleClaim = useCallback(
    async (tier: BoxTier) => {
      if (opening.current) return;
      opening.current = true;
      setBusy(tier);
      setReward(null);
      recordXpReason(`Opened ${BOX_DISPLAY[tier].label}`, "gift-outline");
      // The overlay opens at once with the box rattling in it; the wheel takes over in the same overlay.
      setCharging(tier);
      setSpinning(tier);
      try {
        const [credits] = await Promise.all([claimBox(tier), new Promise((r) => setTimeout(r, CHARGE_MS))]);
        setReward(credits);
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
    // A failed open leaves the box ready to try again; only a claimed one resets.
    if (tier && won) {
      breakpoint("prize_claimed");
      await handleReset(tier);
    }
  }, [spinning, reward, handleReset, breakpoint]);

  const streak = profile?.streak?.count ?? 0;
  const days = Math.min(7, streak);

  return (
    <View style={styles.wrap}>
      <StreakBanner streak={profile?.streak} now={now} expanded={info === "streak"} onPress={() => setInfo((v) => (v === "streak" ? null : "streak"))} />
      <View style={styles.boxRow}>
        {BOX_TIERS.map((tier) => (
          <PrizeBox
            key={tier}
            display={BOX_DISPLAY[tier]}
            state={boxes[tier]}
            now={now}
            busy={busy === tier}
            locked={!!spinning && spinning !== tier}
            onOpen={() => handleOpen(tier)}
            onClaim={() => handleClaim(tier)}
            onReset={() => void handleReset(tier)}
            bonus={days * (tier === "gold" ? 15 : tier === "silver" ? 10 : 5)}
          />
        ))}
      </View>

      <View style={styles.metaRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showOdds }}
          onPress={() => setInfo((v) => (v === "odds" ? null : "odds"))}
          style={[styles.pill, { backgroundColor: c.secondary, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="information-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.pillText, { color: c.mutedForeground }]}>Odds</Text>
        </Pressable>
      </View>

      {info === "streak" ? (
        <View style={[styles.odds, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.oddsTier, { color: c.primary }]}>
            🔥 {streak > 0 ? `${streak}-day pick streak` : "Pick streaks"}
            {profile?.streak?.longest ? ` · best ${profile.streak.longest}` : ""}
          </Text>
          {[
            "Your streak goes up by one for every day (ET) you place at least one bet. Miss a day and it resets.",
            `Every box you open pays a bonus on top: +5 Bronze, +10 Silver, +15 Gold per streak day, up to 7 days${streak > 0 ? ` — right now +${days * 5} / +${days * 10} / +${days * 15}` : ""}.`,
            `Every 7 days you bank a freeze 🧊 that covers one missed day${profile?.streak?.freezes ? " (you have one)" : ""}. No freeze? Make two bets the day after a miss to repair it.`,
          ].map((t, i) => (
            <Text key={i} style={[styles.oddsText, { color: c.mutedForeground }]}>
              {t}
            </Text>
          ))}
        </View>
      ) : null}

      {showOdds ? (
        <View style={[styles.odds, { backgroundColor: c.card, borderColor: c.border }]}>
          {BOX_TIERS.map((tier) => (
            <View key={tier} style={{ gap: 2 }}>
              <Text style={[styles.oddsTier, { color: BOX_DISPLAY[tier].color }]}>
                {BOX_DISPLAY[tier].label} · {BOX_DISPLAY[tier].waitHours}h
              </Text>
              <Text style={[styles.oddsText, { color: c.mutedForeground }]}>
                {BOX_ODDS[tier].map((o) => `${o.credits}: ${o.pct.toFixed(1)}%`).join("  ·  ")}
              </Text>
            </View>
          ))}
          <Text style={[styles.oddsText, { color: c.mutedForeground }]}>
            Timers run on our servers, even with the app closed. The top prize is guaranteed if you go {BOX_PITY_AFTER - 1} boxes of a tier without it. The result is decided before the wheel spins.
          </Text>
        </View>
      ) : null}

      <BonusVideoCard />

      {spinning ? (
        <SpinWheel visible tier={spinning} charging={charging === spinning} rewardCredits={reward} error={reward === null && !busy && !charging ? error : null} onClose={closeWheel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  boxRow: { flexDirection: "row", gap: 8 },
  metaRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, flexShrink: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  odds: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  oddsTier: { fontSize: 12, fontFamily: "Inter_700Bold" },
  oddsText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});

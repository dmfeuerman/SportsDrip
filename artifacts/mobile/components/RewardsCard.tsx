import StreakBanner from "@/components/StreakBanner";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import BonusVideoCard from "@/components/ads/BonusVideoCard";
import PrizeBox, { CHARGE_MS } from "@/components/PrizeBox";
import SpinWheel from "@/components/SpinWheel";
import { recordXpReason } from "@/components/XpGainPopup";
import { BOX_DISPLAY, BOX_TIERS } from "@/constants/prizeTypes";
import { STREAK_BONUS_PER_DAY, STREAK_BONUS_MAX_DAYS } from "@/components/StreakBanner";
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
  const days = Math.min(STREAK_BONUS_MAX_DAYS, streak);

  return (
    <View style={styles.wrap}>
      <StreakBanner streak={profile?.streak} now={now} />
      <View style={{ height: 8 }} />
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
            bonus={days * STREAK_BONUS_PER_DAY[tier]}
          />
        ))}
      </View>

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
  odds: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  oddsTier: { fontSize: 12, fontFamily: "Inter_700Bold" },
  oddsText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});

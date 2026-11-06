import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrizeBox, { CHARGE_MS } from "@/components/PrizeBox";
import BonusVideoCard from "@/components/ads/BonusVideoCard";
import SpinWheel from "@/components/SpinWheel";
import { BOX_ODDS, BOX_PITY_AFTER } from "@/constants/prizeTypes";
import TokenBalance from "@/components/TokenBalance";
import { BOX_DISPLAY, BOX_TIERS } from "@/constants/prizeTypes";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import type { BoxTier } from "@/lib/api";
import { BackButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function PrizesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, balance, prizeBoxes, openBox, claimBox, resetBox, error, clearError } = useApp();
  const { breakpoint } = useAds();

  const [spinning, setSpinning] = useState<BoxTier | null>(null);
  const [reward, setReward] = useState<number | null>(null);
  const [busy, setBusy] = useState<BoxTier | null>(null);
  const [charging, setCharging] = useState<BoxTier | null>(null);
  const [now, setNow] = useState(Date.now());

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 32 : insets.bottom + 24;

  // One timer for the whole screen, and only while something is counting down.
  // The old code mounted a 1s interval inside each of the three cards
  // regardless of state (AUDIT U3).
  const anyWaiting = BOX_TIERS.some((t) => {
    const b = prizeBoxes[t];
    return b.state === "waiting" && (b.readyAt ?? 0) > Date.now();
  });

  useEffect(() => {
    if (!anyWaiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyWaiting]);

  const handleOpen = useCallback(
    async (tier: BoxTier) => {
      setBusy(tier);
      await openBox(tier);
      setNow(Date.now());
      setBusy(null);
    },
    [openBox]
  );

  /**
   * Claim first, animate second.
   *
   * The credits are committed by the callable before the wheel starts turning,
   * so closing the app mid-spin, losing signal, or force-quitting cannot lose
   * the reward — it is already in the ledger. The wheel is presentation.
   *
   * The box rattles while the claim is in flight (at least CHARGE_MS, so the
   * build-up always plays out), then the wheel opens already holding the result.
   */
  const handleClaim = useCallback(
    async (tier: BoxTier) => {
      setBusy(tier);
      setCharging(tier);
      setReward(null);
      const [credits] = await Promise.all([claimBox(tier), new Promise((r) => setTimeout(r, CHARGE_MS))]);
      setCharging(null);
      setReward(credits);
      setSpinning(tier);
      setBusy(null);
    },
    [claimBox]
  );

  const closeWheel = useCallback(async () => {
    const tier = spinning;
    setSpinning(null);
    setReward(null);
    if (tier) {
      await resetBox(tier);
      breakpoint("prize_claimed");
    }
  }, [spinning, resetBox, breakpoint]);

  const claimedCount = useMemo(
    () => BOX_TIERS.filter((t) => prizeBoxes[t].state === "claimed").length,
    [prizeBoxes]
  );

  const readyCount = useMemo(
    () =>
      BOX_TIERS.filter((t) => {
        const b = prizeBoxes[t];
        return (b.state === "waiting" || b.state === "ready") && now >= (b.readyAt ?? Infinity);
      }).length,
    [prizeBoxes, now]
  );

  const streakCount = profile?.streak?.count ?? 0;
  const streakBonusPct = Math.min(5, streakCount) * 10;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <BackButton />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Prize Boxes</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Free credits on a timer
            </Text>
          </View>
          <TokenBalance tokens={balance} />
        </View>

        <View style={styles.statsRow}>
          <Pill colors={colors} icon="gift-outline" text={`${claimedCount} waiting to reset`} />
          {readyCount > 0 && (
            <Pill
              colors={colors}
              icon="bell-ring"
              text={`${readyCount} ready`}
              tint={colors.accent}
            />
          )}
          <Pill
            colors={colors}
            icon="fire"
            text={streakCount > 0 ? `${streakCount}d pick streak (+${streakBonusPct}% on 2h box)` : "Place a daily pick for +10%/day on 2h box"}
            tint={streakCount > 0 ? colors.primary : undefined}
          />
        </View>
      </View>

      {error && (
        <View
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onTouchEnd={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.boxRow}>
          {BOX_TIERS.map((tier) => (
            <PrizeBox
              key={tier}
              display={BOX_DISPLAY[tier]}
              state={prizeBoxes[tier]}
              now={now}
              busy={busy === tier}
              charging={charging === tier}
              onOpen={() => handleOpen(tier)}
              onClaim={() => handleClaim(tier)}
              onReset={() => resetBox(tier)}
            />
          ))}
        </View>

        <BonusVideoCard />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>How It Works</Text>
          {[
            { icon: "gift-outline", text: "Tap a box to start its timer." },
            { icon: "cloud-check-outline", text: "The timer runs on our servers — it keeps counting with the app closed, and it's the same on every device you sign in to." },
            { icon: "circle-slice-8", text: "When it's ready, crack it open and spin for your credits." },
            { icon: "fire", text: "Daily pick streaks boost your 2h Quick Box by +10% per consecutive day (up to +50% at 5 days)." },
            { icon: "refresh", text: "Reset the box to start the next one." },
          ].map(({ icon, text }, i) => (
            <View key={i} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
                <MaterialCommunityIcons name={icon as never} size={16} color={colors.primary} />
              </View>
              <Text style={[styles.rowText, { color: colors.mutedForeground }]}>{text}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Credit Ranges</Text>
          {BOX_TIERS.map((tier) => {
            const d = BOX_DISPLAY[tier];
            const credits = d.segments.map((s) => s.credits);
            return (
              <View key={tier} style={[styles.tableRow, { borderTopColor: colors.border }]}>
                <View style={[styles.tableIcon, { backgroundColor: d.color + "22" }]}>
                  <Text style={styles.tableEmoji}>{d.emoji}</Text>
                </View>
                <Text style={[styles.tableLabel, { color: colors.foreground }]}>{d.label}</Text>
                <Text style={[styles.tableWait, { color: colors.mutedForeground }]}>{d.waitHours}h</Text>
                <View style={styles.tableRange}>
                  <MaterialCommunityIcons name="lightning-bolt" size={11} color={colors.primary} />
                  <Text style={[styles.tableCredits, { color: colors.primary }]}>
                    {Math.min(...credits)}–{Math.max(...credits)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Odds</Text>
          {BOX_TIERS.map((tier) => (
            <View key={tier} style={[styles.tableRow, { borderTopColor: colors.border, flexWrap: "wrap" }]}>
              <Text style={[styles.tableLabel, { color: colors.foreground }]}>{BOX_DISPLAY[tier].label}</Text>
              <Text style={[styles.rowText, { color: colors.mutedForeground, flexBasis: "100%" }]}>
                {BOX_ODDS[tier].map((o) => `${o.credits}: ${o.pct.toFixed(1)}%`).join("  ·  ")}
              </Text>
            </View>
          ))}
          <Text style={[styles.rowText, { color: colors.mutedForeground }]}>
            The top prize is guaranteed if you go {BOX_PITY_AFTER - 1} boxes of a tier without it. The wheel animation is for show; the result is decided before it spins.
          </Text>
        </View>
      </ScrollView>

      {spinning && (
        <SpinWheel
          visible
          tier={spinning}
          rewardCredits={reward}
          error={reward === null && !busy ? error : null}
          onClose={closeWheel}
        />
      )}
    </View>
  );
}

function Pill({
  colors,
  icon,
  text,
  tint,
}: {
  colors: ReturnType<typeof useColors>;
  icon: string;
  text: string;
  tint?: string;
}) {
  const color = tint ?? colors.mutedForeground;
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: tint ? tint + "22" : colors.secondary, borderColor: tint ?? colors.border },
      ]}
    >
      <MaterialCommunityIcons name={icon as never} size={13} color={color} />
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  content: { padding: 16, gap: 16 },
  boxRow: { flexDirection: "row", gap: 10 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1 },
  tableIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tableEmoji: { fontSize: 16 },
  tableLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tableWait: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tableRange: { flexDirection: "row", alignItems: "center", gap: 2 },
  tableCredits: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

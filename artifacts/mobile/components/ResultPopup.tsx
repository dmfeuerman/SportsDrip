import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import AvatarDisplay from "@/components/AvatarDisplay";
import Burst from "@/components/fx/Burst";
import ResultRecap from "@/components/ResultRecap";
import { ActionChip, Amount, Button, Pill } from "@/components/ui";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { trace } from "@/lib/devtrace";
import { haptic, REWARD_RARITY } from "@/lib/motion";
import { useShake } from "@/hooks/useMotion";
import { formatOdds } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { shareViewOrText } from "@/lib/shareCard";

/**
 * Win / loss popups.
 *
 * One at a time, from the server-written notification queue. Wins get a
 * spring, a count-up and a success haptic; losses get the same layout in
 * clay with the stake and the balance it leaves — the consequence is on screen,
 * not buried. Nothing here decides an outcome: the popup only exists because
 * a settlement committed.
 */
export default function ResultPopupHost() {
  const { popup, waiting, dismissPopup, dismissAllPopups, recap, dismissRecap } = useNotifications();
  const { breakpoint } = useAds();
  // Native: hold results until launch has settled; a modal (and its 3D
  // stage) presenting during launch is one more thing competing for the main thread.
  const [armed, setArmed] = useState(Platform.OS === "web");
  useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (armed && popup) trace("popup", `showing ${popup.type} (${waiting} more waiting)`);
  }, [armed, popup?.id]);
  if (!armed) return null;
  // Bets that settled while the app was closed: one recap first, then anything newer one by one.
  if (recap.length) {
    return (
      <ResultRecap
        items={recap}
        onDismiss={() => {
          dismissRecap();
          if (!popup) breakpoint("results_seen");
        }}
      />
    );
  }
  if (!popup) return null;
  return (
    <ResultPopup
      key={popup.id}
      n={popup}
      waiting={waiting}
      onDismiss={() => {
        dismissPopup();
        // Only once the last result is gone — never between two of them.
        if (waiting === 0) breakpoint("results_seen");
      }}
      onDismissAll={() => {
        dismissAllPopups();
        breakpoint("results_seen");
      }}
    />
  );
}

function useCountUp(target: number, ms = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ResultPopup({
  n,
  waiting,
  onDismiss,
  onDismissAll,
}: {
  n: AppNotification;
  waiting: number;
  onDismiss: () => void;
  onDismissAll: () => void;
}) {
  const c = useColors();
  const fmt = useOddsFormat();
  const cardRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const won = n.type === "bet_won" || n.type === "challenge_won" || n.type === "league_payout";
  const lost = n.type === "bet_lost" || n.type === "challenge_lost";
  // A head-to-head: the pot came from (or went to) a friend.
  const friend = n.type.startsWith("challenge_") ? n.data?.friendName ?? "your friend" : null;
  const bet = n.bet;
  const profit = bet ? bet.payout - bet.stake : n.delta;
  const big = won && bet ? bet.payout >= bet.stake * 3 || profit >= 1000 : n.type === "league_payout";
  const shown = useCountUp(Math.abs(won && bet ? profit : n.delta));
  const fired = useRef(false);
  const { style: shakeStyle, shake } = useShake();
  const { profile } = useApp();
  const { byId } = useCatalog();
  // A stable id per popup, so the reaction plays once when it opens.
  const [reactionId] = useState(() => Date.now());
  // Mount the 3D stage once the modal is up, not in the same frame as it.
  const [stageOn, setStageOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStageOn(true), 350);
    return () => clearTimeout(t);
  }, []);

  const accent = won ? c.positive : lost ? c.negative : c.accent;
  const soft = won ? c.positiveSoft : lost ? c.negativeSoft : c.alpha(c.accent, 0.14);
  const currency = n.wallet === "league" ? "league" : "credits";

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (won) haptic.celebrate(big);
    else if (lost) haptic.thud();
    else haptic.success();
    AccessibilityInfo.announceForAccessibility(`${n.title}. ${n.body}`);
  }, [won, lost, big, n.title, n.body]);

  // A jolt for a loss, a rattle for a big win, once the card has landed.
  useEffect(() => {
    if (!lost && !big) return;
    const t = setTimeout(() => shake(big ? 1.6 : 1), 380);
    return () => clearTimeout(t);
  }, [lost, big, shake]);

  const my = bet ? (bet.side === "home" ? bet.finalHomeScore : bet.finalAwayScore) : null;
  const their = bet ? (bet.side === "home" ? bet.finalAwayScore : bet.finalHomeScore) : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
        {/* Confetti for a win — gold for a big one. */}
        {won ? <Burst colors={big ? REWARD_RARITY.epic.confetti : [c.positive, "#FFFFFF", c.accent, c.positive]} count={big ? 64 : 36} power={big ? 1.5 : 1.05} originY={0.42} /> : null}
        <Animated.View style={[styles.shell, shakeStyle]}>
        <View ref={cardRef} collapsable={false} style={{ width: "100%", alignItems: "center" }}>
        <Animated.View
          entering={ZoomIn.springify().damping(14).stiffness(160)}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: c.elevated, borderColor: c.alpha(accent, big ? 0.9 : 0.45), shadowColor: accent }]}
        >
          {bet && <View style={[styles.stripe, { backgroundColor: bet.teamColor }]} />}

          {/* Your character reacts to the result: fist pumps for a win, hands to the face for a loss. */}
          {won || lost ? (
            <View style={[styles.stage, { backgroundColor: soft }]}>
              {stageOn ? (
                <AvatarDisplay
                  avatar={profile?.avatar}
                  equipped={profile?.equipped}
                  catalog={byId}
                  size="lg"
                  interactive={false}
                  focus="reaction"
                  reaction={{ kind: won ? "win" : "loss", id: reactionId }}
                />
              ) : null}
              <View style={[styles.stageBadge, { backgroundColor: c.elevated, borderColor: c.alpha(accent, 0.5) }]}>
                <MaterialCommunityIcons name={won ? (big ? "trophy" : "check-decagram") : "close-octagon-outline"} size={18} color={accent} />
              </View>
            </View>
          ) : null}

          <View style={styles.top}>
            {won || lost ? null : (
              <View style={[styles.iconRing, { backgroundColor: soft, borderColor: c.alpha(accent, 0.5) }]}>
                <MaterialCommunityIcons name={n.type === "league_ended" ? "flag-checkered" : "bell-ring-outline"} size={34} color={accent} />
              </View>
            )}
            <View style={styles.pills}>
              <Pill
                label={won ? (big ? "BIG WIN" : "WIN") : lost ? "LOSS" : n.type === "bet_push" ? "PUSH" : "UPDATE"}
                tone={won ? "positive" : lost ? "negative" : "accent"}
                icon={won ? "arrow-up-bold" : lost ? "arrow-down-bold" : undefined}
              />
              {n.leagueName ? <Pill label={n.leagueName} tone="league" icon="shield-star" /> : null}
              {friend ? <Pill label={`vs ${friend}`} tone="accent" icon="sword-cross" /> : null}
            </View>
            <Text style={[styles.title, { color: c.foreground }]} accessibilityRole="header">
              {n.title}
            </Text>
            {bet && my !== null && their !== null ? (
              <Text style={[styles.score, { color: c.mutedForeground }]}>
                Final · {bet.teamAbbr} {my}–{their} {bet.opponentAbbr}
              </Text>
            ) : (
              <Text style={[styles.score, { color: c.mutedForeground }]}>{n.body}</Text>
            )}
          </View>

          <View style={[styles.hero, { backgroundColor: soft }]}>
            <Text style={[styles.heroLabel, { color: accent }]}>
              {won ? (bet ? "PROFIT" : "PRIZE") : lost ? "STAKE LOST" : "AMOUNT"}
            </Text>
            <Amount value={won ? shown : lost ? -shown : shown} currency={currency} size="xl" signed tone={won ? "positive" : lost ? "negative" : "neutral"} />
          </View>

          {bet && (
            <View style={styles.rows}>
              <Row label="Your pick" value={`${bet.teamName} · ${formatOdds(bet.odds, fmt)}`} />
              <Row label={friend ? "Your stake" : "Stake"} value={bet.stake.toLocaleString()} />
              {friend ? <Row label="Pot" value={bet.payout.toLocaleString()} /> : null}
              <Row label={won ? "Paid out" : friend ? `Went to ${friend}` : "Returned"} value={(won ? bet.payout : friend ? bet.payout : 0).toLocaleString()} />
            </View>
          )}
          {n.balanceAfter !== null && (
            <View style={[styles.balance, { borderTopColor: c.border }]}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>
                {currency === "league" ? `${n.leagueName ?? "League"} balance` : "New balance"}
              </Text>
              <Amount value={n.balanceAfter} currency={currency} />
            </View>
          )}

          <View style={styles.actions}>
            {won && (
              <Button
                label="Share"
                icon="share-variant"
                variant="secondary"
                style={{ flex: 0.9 }}
                onPress={() => {
                  void shareViewOrText({
                    viewRef: cardRef,
                    kind: "result_popup",
                    id: n.id,
                    message: `${n.title} — ${n.body} on SportDrip`,
                  });
                }}
              />
            )}
            {bet && !won && (
              <Button
                label={friend ? "Challenges" : "My bets"}
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  onDismiss();
                  if (friend) router.push({ pathname: "/challenges", params: { tab: "history" } });
                  else router.push(n.leagueId ? { pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } } : "/bets");
                }}
              />
            )}
            <Button label={won ? "Collect" : "Got it"} style={{ flex: 1 }} onPress={onDismiss} haptic={false} shimmer={won} />
          </View>
          {bet && (won || lost) ? <SocialFollowUp n={n} won={won} friend={friend} onDismiss={onDismiss} /> : null}
          {waiting > 0 && (
            <View style={[styles.more, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
              <Text style={[styles.moreText, { color: c.mutedForeground }]}>
                {waiting} more result{waiting > 1 ? "s" : ""}
              </Text>
              <ActionChip label="Skip all" chevron={false} onPress={onDismissAll} />
            </View>
          )}
        </Animated.View>
        </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/**
 * The peak goes to the group: rub a win in league chat, run a lost H2H back,
 * or share the bad beat. One tap each, never a nag.
 */
function SocialFollowUp({ n, won, friend, onDismiss }: { n: AppNotification; won: boolean; friend: string | null; onDismiss: () => void }) {
  const { sendMessage } = useLeague();
  const [posted, setPosted] = useState(false);
  const bet = n.bet!;
  const friendUid = n.data?.friendUid;
  const chips: React.ReactNode[] = [];
  if (n.leagueId && !posted) {
    chips.push(
      <ActionChip
        key="post"
        label={won ? "Rub it in" : "Post bad beat"}
        icon={won ? "bullhorn-outline" : "emoticon-cry-outline"}
        chevron={false}
        onPress={() => {
          sendMessage(
            n.leagueId!,
            won
              ? `💰 Cashed ${bet.teamName} at ${bet.odds.toFixed(2)}x (+${(bet.payout - bet.stake).toLocaleString()}). Next.`
              : `💀 Bad beat: ${bet.teamName} ${bet.finalHomeScore ?? ""}${bet.finalHomeScore !== null ? "–" : ""}${bet.finalAwayScore ?? ""}. I'll be back.`
          );
          haptic.success();
          setPosted(true);
        }}
      />
    );
  }
  if (!won && friend && friendUid) {
    chips.push(
      <ActionChip
        key="back"
        label={`Challenge ${friend} back`}
        icon="sword-cross"
        chevron={false}
        onPress={() => {
          onDismiss();
          router.navigate({ pathname: "/(tabs)/games", params: { challenge: friendUid, challengeName: friend } });
        }}
      />
    );
  }
  if (!chips.length) return null;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 10 }}>{chips}</View>;
}

function Row({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: c.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  shell: { width: "100%", maxWidth: 380, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 26,
    borderWidth: 1.5,
    overflow: "hidden",
    paddingBottom: 16,
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  stripe: { height: 5, width: "100%" },
  stage: { height: 230, marginHorizontal: 16, marginTop: 14, borderRadius: 18, overflow: "hidden" },
  stageBadge: { position: "absolute", top: 10, right: 10, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  top: { alignItems: "center", paddingHorizontal: 20, paddingTop: 14, gap: 8 },
  iconRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pills: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  title: { fontSize: 22, lineHeight: 27, fontFamily: "Inter_900Black", textAlign: "center", letterSpacing: -0.6 },
  score: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  hero: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, paddingVertical: 14, alignItems: "center", gap: 2 },
  heroLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  rows: { paddingHorizontal: 20, paddingTop: 14, gap: 7 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "right" },
  balance: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginHorizontal: 20, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 16 },
  more: { alignSelf: "center", marginTop: 12 },
  moreText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

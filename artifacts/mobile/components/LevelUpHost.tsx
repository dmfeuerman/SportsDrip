import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import ItemIcon from "@/components/avatar/ItemIcon";
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import { LevelBadge, levelTier } from "@/components/LevelBar";
import { Amount, Button } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLevelRewards, type LevelUnlock } from "@/hooks/useLevelRewards";
import { haptic, SPRING } from "@/lib/motion";

const KEY = (uid: string) => `sportdrip.levelSeen.v1.${uid}`;

let replay: ((from: number, to: number) => void) | null = null;
/** Plays the celebration again (Levels screen: tap your badge). */
export function replayLevelUp(level: number) {
  replay?.(Math.max(1, level - 1), level);
}

/**
 * The level-up moment. Watches the server-owned XP on the profile; when the
 * level passes the last one this device celebrated, it takes over the screen:
 * god-rays, confetti, the new medallion slamming in, and what the level paid
 * out (credits, free items, backgrounds, store unlocks).
 *
 * Waits for any win/loss popup to finish first so the two never fight for the
 * screen, and remembers per account what it has shown, so it plays once per
 * level on each device. Nothing here grants anything — the server already did.
 */
export default function LevelUpHost() {
  const { profile, progress } = useApp();
  const { popup, recap } = useNotifications();
  const [seen, setSeen] = useState<number | null>(null);
  const [show, setShow] = useState<{ from: number; to: number } | null>(null);
  const uid = profile?.uid ?? null;
  const hasXp = typeof profile?.xp === "number";

  useEffect(() => {
    if (!uid) return;
    let live = true;
    AsyncStorage.getItem(KEY(uid))
      .then((v) => live && setSeen(v ? Number.parseInt(v, 10) || 1 : 0))
      .catch(() => live && setSeen(0));
    return () => {
      live = false;
    };
  }, [uid]);

  useEffect(() => {
    // 0 = never stored. Wait for real XP (older accounts get it seeded on open)
    // and start from there, so a seeded level isn't celebrated.
    if (!uid || seen === null || !hasXp) return;
    if (seen === 0) {
      setSeen(progress.level);
      AsyncStorage.setItem(KEY(uid), String(progress.level)).catch(() => {});
      return;
    }
    if (progress.level > seen && !show && !popup && recap.length === 0) setShow({ from: seen, to: progress.level });
  }, [uid, seen, hasXp, progress.level, show, popup, recap.length]);

  useEffect(() => {
    replay = (from, to) => setShow({ from, to });
    return () => {
      replay = null;
    };
  }, []);

  const close = useCallback(() => {
    if (uid && show && show.to > (seen ?? 0)) {
      setSeen(show.to);
      AsyncStorage.setItem(KEY(uid), String(show.to)).catch(() => {});
    }
    setShow(null);
  }, [uid, show, seen]);

  if (!show) return null;
  return <LevelUpCelebration from={show.from} to={show.to} onClose={close} />;
}

export function LevelUpCelebration({ from, to, onClose }: { from: number; to: number; onClose: () => void }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const { between } = useLevelRewards();
  const { credits, unlocks } = useMemo(() => between(from, to), [between, from, to]);
  const tier = levelTier(to);
  const rankUp = levelTier(from).name !== tier.name;

  const pulse = useSharedValue(0);
  const slam = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    haptic.celebrate(true);
    if (reduced) return;
    slam.value = withDelay(120, withSpring(1, SPRING.bouncy));
    pulse.value = withDelay(380, withRepeat(withSequence(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), 3, false));
  }, [reduced, slam, pulse]);

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.4 + slam.value * 0.6 }, { rotate: `${(1 - slam.value) * -24}deg` }],
    opacity: Math.min(1, slam.value * 1.6),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.9 }],
    opacity: (1 - pulse.value) * 0.7,
  }));

  const confetti = useMemo(() => [tier.glow, c.primary, c.accent, "#FFFFFF", "#FFC23D", "#FF4D63"], [tier.glow, c.primary, c.accent]);
  const gained = to - from;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tier.glow, opacity: 0.07 }]} />
        <View style={styles.beams} pointerEvents="none">
          <LightBeams color={tier.glow} size={520} beams={16} opacity={0.5} />
        </View>
        <Burst colors={confetti} count={56} power={1.25} duration={1800} originY={0.3} />

        <View style={styles.content}>
          <Animated.Text entering={FadeInDown.delay(60).duration(380)} style={[styles.kicker, { color: tier.glow }]}>
            LEVEL UP
          </Animated.Text>

          <View style={styles.badgeWrap}>
            <Animated.View style={[styles.ring, { borderColor: tier.glow }, ringStyle]} />
            <Animated.View style={badgeStyle}>
              <LevelBadge level={to} size={136} glow />
            </Animated.View>
          </View>

          <Animated.Text entering={FadeInDown.delay(280).duration(420)} style={styles.title}>
            Level {to}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(360).duration(420)} style={styles.sub}>
            {rankUp ? `New rank: ${tier.name}` : gained > 1 ? `Up ${gained} levels at once` : "Keep it rolling."}
          </Animated.Text>

          {credits > 0 || unlocks.length > 0 ? (
            <Animated.View entering={FadeIn.delay(480).duration(400)} style={styles.card}>
              <Text style={styles.cardLabel}>UNLOCKED</Text>
              {credits > 0 ? (
                <Animated.View entering={FadeInDown.delay(560).duration(360)} style={styles.rewardRow}>
                  <View style={[styles.thumb, { backgroundColor: c.alpha(c.primary, 0.18) }]}>
                    <MaterialCommunityIcons name="lightning-bolt" size={22} color={c.primary} />
                  </View>
                  <Text style={styles.rewardName}>Level-up bonus</Text>
                  <Amount value={credits} signed tone="positive" size="md" />
                </Animated.View>
              ) : null}
              {unlocks.slice(0, 4).map((u, i) => (
                <Animated.View key={`${u.kind}:${u.id}`} entering={FadeInDown.delay(640 + i * 90).duration(360)} style={styles.rewardRow}>
                  <UnlockThumb u={u} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rewardName} numberOfLines={1}>
                      {u.name}
                    </Text>
                    <Text style={[styles.rewardSub, { color: c.rarity(u.rarity) }]} numberOfLines={1}>
                      {u.rarity.toUpperCase()} · {u.kind === "background" ? "BACKGROUND" : "ITEM"}
                    </Text>
                  </View>
                  <Text style={[styles.tag, u.mode === "reward" ? { color: c.primaryForeground, backgroundColor: c.primary } : { color: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.14)" }]}>
                    {u.mode === "reward" ? "YOURS" : "IN SHOP"}
                  </Text>
                </Animated.View>
              ))}
              {unlocks.length > 4 ? <Text style={styles.more}>+{unlocks.length - 4} more</Text> : null}
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.delay(760).duration(380)} style={styles.actions}>
            <Button label="Let's go" icon="arrow-right" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label="All levels"
              variant="secondary"
              onPress={() => {
                onClose();
                router.push("/levels" as never);
              }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function UnlockThumb({ u }: { u: LevelUnlock }) {
  if (u.kind === "item" && u.item) {
    return (
      <View style={[styles.thumb, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
        <ItemIcon item={u.item} size={34} />
      </View>
    );
  }
  return (
    <View style={[styles.thumb, { overflow: "hidden" }]}>
      <AvatarBackdrop id={u.id} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(4, 5, 8, 0.9)", alignItems: "center", justifyContent: "center" },
  beams: { position: "absolute", left: 0, right: 0, top: 0, height: "62%" },
  content: { width: "100%", maxWidth: 420, paddingHorizontal: 22, alignItems: "center", gap: 8 },
  kicker: { fontSize: 15, fontFamily: "Inter_900Black", letterSpacing: 7 },
  badgeWrap: { width: 190, height: 190, alignItems: "center", justifyContent: "center", marginVertical: 4 },
  ring: { position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 3 },
  title: { color: "#FFFFFF", fontSize: 38, lineHeight: 42, fontFamily: "Inter_900Black", letterSpacing: -1.2 },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  card: {
    alignSelf: "stretch",
    borderRadius: 20,
    padding: 14,
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  cardLabel: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.6 },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rewardName: { flex: 1, color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_700Bold" },
  rewardSub: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, marginTop: 2 },
  tag: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  more: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 12 },
});

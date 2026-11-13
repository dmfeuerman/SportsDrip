import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
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
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import TrophyArt, { achievementLook } from "@/components/TrophyArt";
import { Button } from "@/components/ui";
import { ACHIEVEMENTS, METALS } from "@/constants/achievements";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { celebrate } from "@/lib/celebrate";
import { haptic, SPRING } from "@/lib/motion";
import { OVERLAY, useOverlayTurn } from "@/lib/overlayTurns";

/** Achievement notifications this old or older stay in the feed instead of popping up. */
const FRESH_MS = 7 * 24 * 3_600_000;

/**
 * The trophy moment. Watches the notification feed for freshly earned
 * achievements (the server awards them and writes one `achievement`
 * notification each) and celebrates them like a big win: god-rays, confetti,
 * the trophy itself slamming in. Queues behind results and level-ups via the
 * overlay turns, shows one at a time, and marks each read on dismiss so it
 * plays once per account, not once per device.
 */
export default function TrophyCelebrationHost() {
  const { notifications, markRead } = useNotifications();
  const now = Date.now();
  const pending = useMemo(
    () =>
      notifications
        .filter((n) => n.type === "achievement" && !n.read && now - n.createdAtMs <= FRESH_MS)
        .sort((a, b) => a.createdAtMs - b.createdAtMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifications]
  );
  const n = pending[0] ?? null;
  const myTurn = useOverlayTurn("trophy", !!n, OVERLAY.trophy);
  if (!n || !myTurn) return null;
  return <TrophyCelebration key={n.id} n={n} onClose={() => markRead([n.id])} />;
}

function TrophyCelebration({ n, onClose }: { n: AppNotification; onClose: () => void }) {
  const reduced = useReducedMotion();
  const achId = n.data?.achievementId ?? n.id.replace(/^ach_/, "");
  const look = achievementLook(achId);
  const info = ACHIEVEMENTS.find((a) => a.id === achId);
  const metal = METALS[look.metal];
  const fired = useRef(false);

  const slam = useSharedValue(reduced ? 1 : 0);
  const shine = useSharedValue(0);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    haptic.celebrate(true);
    if (reduced) return;
    slam.value = withDelay(120, withSpring(1, SPRING.bouncy));
    shine.value = withDelay(400, withRepeat(withSequence(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), 2, false));
  }, [reduced, slam, shine]);

  const trophyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.3 + slam.value * 0.7 }, { translateY: (1 - slam.value) * 40 }, { rotate: `${(1 - slam.value) * -14}deg` }],
    opacity: Math.min(1, slam.value * 1.6),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + shine.value * 0.9 }],
    opacity: (1 - shine.value) * 0.6,
  }));

  const confetti = useMemo(() => [metal.hi, metal.mid, "#FFFFFF", "#FFC23D", metal.hi], [metal]);
  const fx = celebrate("level_up");

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: metal.mid, opacity: 0.07 }]} />
        {fx.beams ? (
          <View style={styles.beams} pointerEvents="none">
            <LightBeams color={metal.mid} size={520} beams={16} opacity={0.5} />
          </View>
        ) : null}
        {fx.burst ? <Burst colors={confetti} count={fx.burst.count} power={fx.burst.power} duration={fx.burst.duration} originY={0.3} /> : null}

        <View style={styles.content}>
          <Animated.Text entering={FadeInDown.delay(60).duration(380)} style={[styles.kicker, { color: metal.hi }]}>
            TROPHY EARNED
          </Animated.Text>

          <View style={styles.stage}>
            <Animated.View style={[styles.ring, { borderColor: metal.mid }, ringStyle]} />
            <Animated.View style={trophyStyle}>
              <TrophyArt design={look.design} metal={look.metal} icon={look.icon} size={120} uid={`cel_${achId}`} />
            </Animated.View>
          </View>

          <Animated.Text entering={FadeInDown.delay(280).duration(420)} style={styles.title}>
            {look.title}
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(360).duration(420)} style={[styles.metalPill, { borderColor: metal.mid, backgroundColor: "rgba(255,255,255,0.06)" }]}>
            <MaterialCommunityIcons name="trophy-variant" size={13} color={metal.hi} />
            <Text style={[styles.metalText, { color: metal.hi }]}>{look.metal.toUpperCase()}</Text>
          </Animated.View>
          {info ? (
            <Animated.Text entering={FadeInDown.delay(420).duration(420)} style={styles.sub}>
              {info.how}. It's on your trophy shelf.
            </Animated.Text>
          ) : null}

          <Animated.View entering={FadeIn.delay(560).duration(380)} style={styles.actions}>
            <Button
              label="Trophy Case"
              icon="trophy-outline"
              variant="secondary"
              onPress={() => {
                onClose();
                router.push("/trophies" as never);
              }}
              style={{ flex: 1 }}
            />
            <Button label="Let's go" icon="arrow-right" onPress={onClose} style={{ flex: 1 }} shimmer />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(4, 5, 8, 0.9)", alignItems: "center", justifyContent: "center" },
  beams: { position: "absolute", left: 0, right: 0, top: 0, height: "62%" },
  content: { width: "100%", maxWidth: 420, paddingHorizontal: 22, alignItems: "center", gap: 8 },
  kicker: { fontSize: 15, fontFamily: "Inter_900Black", letterSpacing: 7 },
  stage: { width: 200, height: 190, alignItems: "center", justifyContent: "center", marginVertical: 4 },
  ring: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 3 },
  title: { color: "#FFFFFF", fontSize: 32, lineHeight: 37, fontFamily: "Inter_900Black", letterSpacing: -1, textAlign: "center" },
  metalPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  metalText: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 1.4 },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 2 },
  actions: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 14 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PressableScale from "@/components/fx/PressableScale";
import { Pressable } from "@/components/fx/Tap";
import { Card, CloseButton, SectionHeader } from "@/components/ui";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import { trackEvent } from "@/lib/analytics";
import { useHeldOut } from "@/lib/experiments";
import { haptic } from "@/lib/motion";

const WEEK_MS = 7 * 86_400_000;
/** Friends in the same league for activation. Placeholder until cohorts say otherwise. */
export const ACTIVATION_FRIENDS = 1;
const ACTIVATION_KEY = "sportdrip.activation.v1";

function createdAtMs(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * First-7-days checklist. Derived from existing profile/league/friend state —
 * no new server state. Avatar is pre-checked so progress starts endowed.
 */
export default function FirstWeekChecklist() {
  const c = useColors();
  const { profile } = useApp();
  const { leagues } = useLeague();
  const uid = profile?.uid ?? null;
  const { friends } = useFriends(uid);
  const heldOut = useHeldOut(uid);
  const [open, setOpen] = useState(false);

  const created = createdAtMs((profile as unknown as { createdAt?: unknown } | null)?.createdAt);
  const young = created !== null && Date.now() - created < WEEK_MS;

  const p = profile as (typeof profile & { dailyRecord?: { w?: number; l?: number } }) | null;
  const settled = (p?.stats?.betsWon ?? 0) + (p?.stats?.betsLost ?? 0) + (p?.stats?.betsPush ?? 0) + (p?.dailyRecord?.w ?? 0) + (p?.dailyRecord?.l ?? 0) > 0;
  const friendIds = useMemo(() => new Set(friends.map((f) => f.uid)), [friends]);
  const friendsInLeague = useMemo(
    () => Math.max(0, ...leagues.map((l) => l.memberIds.filter((m) => friendIds.has(m)).length)),
    [leagues, friendIds]
  );

  const items = [
    { key: "avatar", label: "Create Your Avatar", done: true, href: "/(tabs)/avatar" },
    { key: "teams", label: "Pick Your Teams", done: (profile?.favoriteTeams?.length ?? 0) > 0, href: "/(tabs)/avatar" },
    { key: "daily", label: "Place a Daily Free Bet", done: !!profile?.streak?.longest, href: "/(tabs)" },
    { key: "friend", label: "Add a Friend", done: friends.length > 0, href: "/(tabs)/leagues?seg=friends" },
    { key: "league", label: "Join a League", done: leagues.length > 0, href: "/(tabs)/leagues" },
    { key: "settled", label: "Get a Pick Settled", done: settled, href: "/(tabs)/games" },
  ];

  const activated = settled && friendsInLeague >= ACTIVATION_FRIENDS;
  useEffect(() => {
    if (!activated || !uid) return;
    (async () => {
      try {
        if (await AsyncStorage.getItem(`${ACTIVATION_KEY}.${uid}`)) return;
        await AsyncStorage.setItem(`${ACTIVATION_KEY}.${uid}`, "1");
      } catch {
        return;
      }
      trackEvent("activation_reached", { friends_in_league: friendsInLeague });
    })();
  }, [activated, uid, friendsInLeague]);

  const done = items.filter((i) => i.done).length;
  if (!profile || !young || heldOut || done === items.length) return null;

  const next = items.find((i) => !i.done)!;
  const pct = `${(done / items.length) * 100}%` as const;

  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title="Your First Week" icon="flag-checkered" />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Your first week, ${done} of ${items.length} done. Next: ${next.label}`}
        onPress={() => {
          haptic.light();
          setOpen(true);
        }}
        style={[styles.compact, { backgroundColor: c.alpha(c.primary, 0.14), borderColor: c.primary }]}
      >
        <View style={[styles.icon, { backgroundColor: c.primary }]}>
          <MaterialCommunityIcons name="flag-checkered" size={22} color={c.background} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.kicker, { color: c.primary }]}>{`${done}/${items.length} DONE`}</Text>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {next.label}
          </Text>
          <View style={[styles.track, { backgroundColor: c.secondary }]}>
            <View style={[styles.fill, { backgroundColor: c.primary, width: pct }]} />
          </View>
        </View>
        <View style={[styles.cta, { backgroundColor: c.primary }]}>
          <Text style={[styles.ctaText, { color: c.background }]}>View</Text>
        </View>
      </PressableScale>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={[styles.overlay, { backgroundColor: c.overlay }]}>
          <SafeAreaView style={styles.sheetWrap} edges={["top", "bottom"]}>
            <Card style={{ gap: 12 }} accessibilityLabel="Your first week">
              <View style={styles.head}>
                <Text style={[styles.headTitle, { color: c.foreground }]}>{`Your First Week · ${done}/${items.length}`}</Text>
                <CloseButton onPress={() => setOpen(false)} />
              </View>
              <View style={[styles.track, { backgroundColor: c.secondary }]}>
                <View style={[styles.fill, { backgroundColor: c.primary, width: pct }]} />
              </View>
              {items.map((i) => (
                <Pressable
                  key={i.key}
                  accessibilityRole="button"
                  accessibilityState={{ checked: i.done }}
                  accessibilityLabel={`${i.label}${i.done ? ", done" : ""}`}
                  disabled={i.done}
                  onPress={() => {
                    haptic.tick();
                    setOpen(false);
                    router.navigate(i.href as never);
                  }}
                  style={styles.row}
                >
                  <MaterialCommunityIcons
                    name={i.done ? "check-circle" : "checkbox-blank-circle-outline"}
                    size={22}
                    color={i.done ? c.positive : c.mutedForeground}
                  />
                  <Text style={[styles.label, { flex: 1, color: i.done ? c.mutedForeground : c.foreground }]}>{i.label}</Text>
                  {i.done ? null : <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} />}
                </Pressable>
              ))}
            </Card>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  compact: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1.5, padding: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  cta: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  ctaText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  overlay: { flex: 1, justifyContent: "center", padding: 16 },
  sheetWrap: { width: "100%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", flex: 1 },
  label: theme.type.body,
});

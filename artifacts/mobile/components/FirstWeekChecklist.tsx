import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Card, SectionHeader } from "@/components/ui";
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
    { key: "daily", label: "Make your first Daily Pick", done: !!profile?.streak?.longest, href: "/(tabs)" },
    { key: "friend", label: "Add a Friend", done: friends.length > 0, href: "/(tabs)/friends" },
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

  return (
    <Card style={{ gap: 8 }} accessibilityLabel="Your first week">
      <SectionHeader title={`Your first week · ${done}/${items.length}`} />
      <View style={[styles.track, { backgroundColor: c.secondary }]}>
        <View style={[styles.fill, { backgroundColor: c.primary, width: `${(done / items.length) * 100}%` }]} />
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
            router.navigate(i.href as never);
          }}
          style={styles.row}
        >
          <MaterialCommunityIcons
            name={i.done ? "check-circle" : "checkbox-blank-circle-outline"}
            size={20}
            color={i.done ? c.positive : c.mutedForeground}
          />
          <Text style={[styles.label, { color: i.done ? c.mutedForeground : c.foreground }]}>{i.label}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  label: theme.type.body,
});

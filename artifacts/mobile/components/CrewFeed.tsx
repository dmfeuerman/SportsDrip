import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useOptimisticReaction } from "@/hooks/useOptimisticReaction";
import { trackEvent } from "@/lib/analytics";
import { router } from "expo-router";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Card, EmptyState, SectionHeader } from "@/components/ui";
import { REACTION_EMOJIS, type LeagueActivity, type ReactionEmoji } from "@/constants/leagueTypes";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

export type CrewItem = LeagueActivity & { leagueId: string; leagueName: string };

/**
 * Losses, loans and margin calls stay out of the crew feed: it celebrates
 * calls, rivalries and milestones, never stake size or someone's bad night
 * (a loss only shows if they post it to chat themselves).
 */
const HIDDEN = new Set(["bet_lost", "margin_call", "loan", "loan_repaid", "repay", "left"]);

/** Recent activity across every active league, merged and newest first. */
export function useCrewFeed(perLeague = 15): CrewItem[] {
  const { activeLeagues, uid } = useLeague();
  const [byLeague, setByLeague] = useState<Record<string, CrewItem[]>>({});
  const key = activeLeagues.map((l) => `${l.id}:${l.name}`).join("|");

  useEffect(() => {
    if (DEMO || !key) {
      setByLeague({});
      return;
    }
    const db = getDb();
    if (!db) return;
    const unsubs = key.split("|").map((pair) => {
      const i = pair.indexOf(":");
      const leagueId = pair.slice(0, i);
      const leagueName = pair.slice(i + 1);
      return onSnapshot(
        query(collection(db, "leagues", leagueId, "activity"), orderBy("at", "desc"), limit(perLeague)),
        (snap) =>
          setByLeague((prev) => ({
            ...prev,
            [leagueId]: snap.docs.map((d) => ({ ...(d.data() as LeagueActivity), id: d.id, leagueId, leagueName })),
          })),
        () => {}
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [key, perLeague]);

  return useMemo(
    () =>
      Object.values(byLeague)
        .flat()
        .filter((a) => !HIDDEN.has(a.type) && !a.id.startsWith("margin_") && !a.id.startsWith("repay_") && a.uid !== uid)
        .sort((a, b) => b.at - a.at),
    [byLeague, uid]
  );
}

const ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  bet_won: "cash-plus",
  bet_push: "minus-circle-outline",
  rivalry: "sword-cross",
  joined: "account-plus-outline",
  created: "flag-outline",
};

function ago(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function CrewRow({ item, last }: { item: CrewItem; last?: boolean }) {
  const c = useColors();
  const { reactToItem, uid } = useLeague();
  const optimistic = useOptimisticReaction(item.reactors, uid, item.reactions);
  const openChat = () => {
    trackEvent("feed_item_tapped", { league_id: item.leagueId });
    router.push({ pathname: "/messages" as never, params: { leagueId: item.leagueId } });
  };
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.text}. Open ${item.leagueName} chat`}
        onPress={openChat}
        style={({ pressed }) => [styles.top, styles.topBtn, { backgroundColor: pressed ? c.secondary : c.alpha(c.foreground, 0.03), borderColor: c.border }]}
      >
        <View style={[styles.icon, { backgroundColor: c.alpha(item.type === "bet_won" ? c.positive : c.league, 0.14) }]}>
          <MaterialCommunityIcons name={ICON[item.type] ?? "star-four-points-outline"} size={16} color={item.type === "bet_won" ? c.positive : c.league} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.text, { color: c.foreground }]}>{item.text}</Text>
          <Text style={[styles.meta, { color: c.subtleForeground }]}>
            {item.leagueName} · {ago(item.at)}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} style={{ alignSelf: "center" }} />
      </Pressable>
      <View style={styles.actions}>
        {REACTION_EMOJIS.slice(0, 4).map((e: ReactionEmoji) => {
          const n = optimistic.counts[e] ?? 0;
          const on = optimistic.mine === e;
          return (
            <Pressable
              key={e}
              accessibilityRole="button"
              accessibilityLabel={`React ${e}`}
              onPress={() => {
                haptic.tick();
                void optimistic.toggle(e, () => reactToItem(item.leagueId, "activity", item.id, e));
              }}
              style={[styles.chip, { backgroundColor: on ? c.leagueSoft : c.secondary, borderColor: on ? c.league : c.border }]}
            >
              <Text style={{ fontSize: 12 }}>{e}</Text>
              {n > 0 ? <Text style={[styles.meta, { color: on ? c.league : c.mutedForeground }]}>{n}</Text> : null}
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reply in league chat"
          hitSlop={8}
          onPress={openChat}
          style={[styles.reply, { borderColor: c.border, backgroundColor: c.secondary }]}
        >
          <MaterialCommunityIcons name="reply-outline" size={16} color={c.mutedForeground} />
          <Text style={[styles.meta, { color: c.foreground, fontFamily: "Inter_700Bold" }]}>Reply</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Home module: the three latest things your crew did. */
export default function CrewFeedModule() {
  const items = useCrewFeed(8);
  if (!items.length) return null;
  return (
    <>
      <SectionHeader title="Your Crew" action="See All" onAction={() => router.push("/feed" as never)} />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {items.slice(0, 3).map((it, i, arr) => (
          <CrewRow key={`${it.leagueId}_${it.id}`} item={it} last={i === arr.length - 1} />
        ))}
      </Card>
    </>
  );
}

export function CrewFeedEmpty() {
  return (
    <EmptyState
      icon="account-group-outline"
      title="Quiet in Here"
      body="Join a league with friends and their wins, rivalries and milestones show up here."
      action="Leagues"
      onAction={() => router.navigate("/(tabs)/leagues")}
    />
  );
}

const styles = StyleSheet.create({
  row: { padding: 12, gap: 8 },
  top: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  topBtn: { borderWidth: 1, borderRadius: 12, padding: 10 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  reply: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
});

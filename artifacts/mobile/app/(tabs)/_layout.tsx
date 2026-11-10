import { BlurView } from "expo-blur";
import { useUnseenCount } from "@/lib/settings";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, Tabs, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView } from "expo-symbols";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import { useChallenges } from "@/context/ChallengeContext";
import { useApp } from "@/context/AppContext";
import { useChat } from "@/context/ChatContext";
import { useNotifications } from "@/context/NotificationContext";
import { useTourState } from "@/lib/tour/store";

const LEAGUE_ACTION = new Set(["loan_request", "loan_countered", "stimulus_request", "margin_call", "league_invite"]);
const FRIEND_ACTION = new Set(["friend_request"]);

/** Unread obligations per tab. Friends live inside Leagues, so its badge carries chat, money asks, requests and challenges. */
function useTabBadges(): Partial<Record<string, number>> {
  const { notifications } = useNotifications();
  const { unreadLeagueTokens } = useChat();
  const { incoming } = useChallenges();
  const segments = useSegments() as string[];
  const current = segments[0] === "(tabs)" ? segments[1] ?? "index" : null;
  const { leagueIds, friendIds } = useMemo(() => {
    const leagueIds = unreadLeagueTokens.map((t) => `chat:${t}`);
    const friendIds = incoming.map((ch) => `challenge:${ch.id}`);
    for (const n of notifications) {
      if (n.read) continue;
      if (LEAGUE_ACTION.has(n.type)) leagueIds.push(`n:${n.id}`);
      else if (FRIEND_ACTION.has(n.type)) friendIds.push(`n:${n.id}`);
    }
    return { leagueIds, friendIds };
  }, [notifications, unreadLeagueTokens, incoming]);
  // A tab's badge counts only what's new since you last opened that tab.
  const all = useMemo(() => [...leagueIds, ...friendIds], [leagueIds, friendIds]);
  const leagues = useUnseenCount("tab.leagues", all, current === "leagues");
  return { leagues };
}

const badgeText = (n?: number) => (n && n > 0 ? (n > 99 ? "99+" : String(n)) : undefined);

/**
 * Five destinations, in the order a session actually goes:
 *
 *   Home     where you stand: balance, open bets, results, league ranks, debt
 *   Games    the board, and the bet slip (credits or any league wallet)
 *   Leagues  the crew: league chat first, standings a tap away, and a
 *            Friends segment (people, requests, head-to-heads, invites)
 *   Locker   your character: outfit, appearance, and the shop
 *
 * My Bets, Prizes, Shop and Activity are pushed screens off these (with a real
 * back gesture) instead of tabs. Six tabs was already the ceiling iOS
 * tolerates, and Prizes and Shop are visited, not lived in.
 */

const TABS = [
  { name: "index", title: "Home", sf: "house", md: "home-variant-outline" },
  { name: "games", title: "Games", sf: "sportscourt", md: "scoreboard-outline" },
  { name: "leagues", title: "Leagues", sf: "trophy", md: "trophy-outline" },
  { name: "avatar", title: "Locker", sf: "tshirt", md: "tshirt-crew-outline" },
] as const;

function NativeTabLayout() {
  const badges = useTabBadges();
  return (
    <NativeTabs>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <NativeTabs.Trigger.Icon sf={{ default: t.sf as never, selected: `${t.sf}.fill` as never }} />
          <NativeTabs.Trigger.Label>{t.title}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Badge hidden={!badgeText(badges[t.name])}>{badgeText(badges[t.name])}</NativeTabs.Trigger.Badge>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const badges = useTabBadges();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 72 : 64,
          paddingTop: 6,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={colors.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ),
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 11, marginBottom: isWeb ? 8 : 4 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: badges[t.name] ? `${t.title}, ${badges[t.name]} new` : t.title,
            tabBarBadge: badgeText(badges[t.name]),
            tabBarBadgeStyle: { backgroundColor: colors.accent, fontSize: 11, fontFamily: "Inter_700Bold" },
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name={t.sf as never} tintColor={color} size={22} />
              ) : (
                <MaterialCommunityIcons name={t.md} size={22} color={color as string} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

/**
 * Chat is the front door: once per launch, if a league chat has unread
 * messages when the tabs first settle, open that league on its chat.
 */
function useLandOnUnreadChat() {
  const { unreadLeagueTokens } = useChat();
  const { tour } = useTourState();
  // Brand-new players are mid-walkthrough on Home; never pull them away from it.
  const hasPlayed = useApp().bets.length > 0;
  const segments = useSegments() as string[];
  const onHome = segments[0] === "(tabs)" && (segments[1] ?? "index") === "index" && segments.length <= 2;
  const done = useRef(false);
  useEffect(() => {
    // Only in the first few seconds: after that the player has chosen where to be.
    const t = setTimeout(() => (done.current = true), 6000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (done.current || tour || !hasPlayed || !onHome || unreadLeagueTokens.length === 0) return;
    done.current = true;
    let best = { id: "", at: 0 };
    for (const tok of unreadLeagueTokens) {
      const i = tok.lastIndexOf(":");
      const at = Number(tok.slice(i + 1));
      if (at > best.at) best = { id: tok.slice(0, i), at };
    }
    if (best.id) router.push({ pathname: "/league/[id]", params: { id: best.id, tab: "feed" } });
  }, [unreadLeagueTokens, tour, onHome, hasPlayed]);
}

export default function TabLayout() {
  useLandOnUnreadChat();
  // A detent click whenever the tab changes (native and classic bars alike).
  const tab = useSegments()[1] ?? "index";
  const last = useRef(tab);
  useEffect(() => {
    if (last.current !== tab) haptic.tick();
    last.current = tab;
  }, [tab]);
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}

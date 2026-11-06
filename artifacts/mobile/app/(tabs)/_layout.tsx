import { BlurView } from "expo-blur";
import { useUnseenCount } from "@/lib/settings";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView } from "expo-symbols";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import { useChallenges } from "@/context/ChallengeContext";
import { useChat } from "@/context/ChatContext";
import { useNotifications } from "@/context/NotificationContext";

const LEAGUE_ACTION = new Set(["loan_request", "loan_countered", "stimulus_request", "margin_call", "league_invite"]);
const FRIEND_ACTION = new Set(["friend_request"]);

/** Unread obligations per tab: league chat + money asks on Leagues, requests + challenges on Friends. */
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
  const leagues = useUnseenCount("tab.leagues", leagueIds, current === "leagues");
  const friends = useUnseenCount("tab.friends", friendIds, current === "friends");
  return { leagues, friends };
}

const badgeText = (n?: number) => (n && n > 0 ? (n > 99 ? "99+" : String(n)) : undefined);

/**
 * Five destinations, in the order a session actually goes:
 *
 *   Home     where you stand: balance, open bets, results, league ranks, debt
 *   Games    the board, and the bet slip (credits or any league wallet)
 *   Leagues  promoted from a button inside Friends to a first-class tab —
 *            they're the competitive core, not a social afterthought
 *   Friends  people, requests, head-to-heads, league invites
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
  { name: "friends", title: "Friends", sf: "person.2", md: "account-group-outline" },
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

export default function TabLayout() {
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

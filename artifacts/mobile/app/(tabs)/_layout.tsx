import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView } from "expo-symbols";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

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
  return (
    <NativeTabs>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <NativeTabs.Trigger.Icon sf={{ default: t.sf as never, selected: `${t.sf}.fill` as never }} />
          <NativeTabs.Trigger.Label>{t.title}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

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
            tabBarAccessibilityLabel: t.title,
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
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}

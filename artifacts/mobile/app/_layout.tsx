import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider, useApp } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import ResultPopupHost from "@/components/ResultPopup";
import AvatarPortraitStudio from "@/components/avatar/AvatarPortraitStudio";
import { LeagueProvider } from "@/context/LeagueContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { firebaseConfigured } from "@/lib/firebase";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/**
 * Sits inside AppProvider so it can read the profile.
 *
 * Two fixes live here:
 *  1. LeagueProvider is finally given a real displayName and avatarColor.
 *     Previously _layout passed only `uid`, so the defaults applied and every
 *     member written to Firestore was called "Player" (AUDIT B3).
 *  2. An onboarding gate: authenticated but no users/{uid} document means the
 *     account exists and the character does not. Route to /onboarding rather
 *     than dropping the user on the games tab with no profile.
 */
function AppShell() {
  const { profile, ready, needsOnboarding } = useApp();
  const segments = useSegments();
  const colors = useColors();

  if (!ready) return <Splash />;

  if (needsOnboarding && segments[0] !== "onboarding") {
    return <Redirect href="/onboarding" />;
  }

  const uid = profile?.uid ?? null;

  // Leagues and notifications are server-owned; both providers only read and
  // call functions. ResultPopupHost sits above every screen so a result that
  // settles while you're in the shop still lands.
  return (
    <LeagueProvider uid={uid}>
      <NotificationProvider uid={uid}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="bets" />
          <Stack.Screen name="prizes" />
          <Stack.Screen name="shop" />
          <Stack.Screen name="customize" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="activity" />
          <Stack.Screen name="league/[id]" />
        </Stack>
        {uid ? <ResultPopupHost /> : null}
        <AvatarPortraitStudio />
      </NotificationProvider>
    </LeagueProvider>
  );
}

function Splash() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function RootLayoutNav() {
  const { currentUser, loading } = useAuth();
  const segments = useSegments();

  if (loading) return <Splash />;

  if (firebaseConfigured && !currentUser) {
    if (segments[0] !== "login") return <Redirect href="/login" />;
  }

  const uid = currentUser?.uid ?? "local";

  // key={uid} still forces a clean remount when the signed-in user changes, so
  // two accounts on one device never share state.
  //
  // FirebaseSyncProvider is deliberately gone. It debounce-wrote the entire
  // local state to users/{uid} with a non-merging setDoc every 2 seconds, which
  // clobbered server-written fields, raced the AsyncStorage load on boot, and
  // gave leagues a second conflicting source of truth (AUDIT B5, B6, B7).
  // AppProvider now subscribes to Firestore directly.
  return (
    <AppProvider key={uid} uid={uid}>
      <AppShell />
    </AppProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

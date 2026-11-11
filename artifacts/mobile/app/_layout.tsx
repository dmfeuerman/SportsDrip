import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, router, Stack, useGlobalSearchParams, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AppWalkthroughModal from "@/components/AppWalkthroughModal";
import TourHost from "@/components/tour/TourHost";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import HouseLogo, { BRAND } from "@/components/brand/HouseLogo";
import ConnectionGate from "@/components/ConnectionGate";
import BootScreen from "@/components/BootScreen";
import { markBootReady, useBootDone } from "@/lib/bootGate";
import { useAvatarGate } from "@/hooks/useAvatarGate";
import { useCatalog } from "@/hooks/useCatalog";
import { AdsProvider } from "@/context/AdsContext";
import { AppProvider, useApp } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { ChallengeProvider } from "@/context/ChallengeContext";
import { ChatProvider } from "@/context/ChatContext";
import DevFlagsRunner from "@/components/DevFlagsRunner";
import { hasDevFlags } from "@/lib/devFlags";
import { flushAnalytics } from "@/lib/analytics";
import { normalizeInviteCode, savePendingInvite, takePendingInvite } from "@/lib/invites";
import { normalizeReferralCode, savePendingReferral } from "@/lib/referrals";
import { startStallWatch, trace } from "@/lib/devtrace";
import ResultPopupHost from "@/components/ResultPopup";

import { PresenceBeat } from "@/lib/presence";
import EngagementWatchers from "@/components/EngagementWatchers";
import InviteToastHost from "@/components/InviteToastHost";
import LevelUpHost from "@/components/LevelUpHost";
import ToastHost from "@/components/ToastHost";
import TermsGate from "@/components/TermsGate";
import GlobalHosts from "@/components/GlobalHosts";
import { ToastProvider } from "@/context/ToastContext";
import { ParlayProvider } from "@/context/ParlayContext";
import AvatarPortraitStudio from "@/components/avatar/AvatarPortraitStudio";
import { LeagueProvider } from "@/context/LeagueContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { firebaseConfigured } from "@/lib/firebase";

SplashScreen.preventAutoHideAsync();
startStallWatch();
trace("boot", "bundle loaded");

const queryClient = new QueryClient();

function useInviteLinkCode(): string | null {
  const segments = useSegments();
  const params = useGlobalSearchParams<{ code?: string }>();
  return (segments[0] as string | undefined) === "join" ? normalizeInviteCode(params.code) : null;
}

/** sportdrip://ref/{CODE}: a friend's invite code, parked for the signup form. */
function useReferralLinkCode(): string | null {
  const segments = useSegments();
  const params = useGlobalSearchParams<{ code?: string }>();
  return (segments[0] as string | undefined) === "ref" ? normalizeReferralCode(params.code) : null;
}

function AppShell() {
  const { profile, ready, needsOnboarding } = useApp();
  const { byId: catalog, loading: catalogLoading } = useCatalog();
  const avatarReady = useAvatarGate(profile?.avatar, profile?.equipped, catalog, catalogLoading, ready);
  const segments = useSegments();
  const colors = useColors();
  const linkCode = useInviteLinkCode();
  const refCode = useReferralLinkCode();
  const top = segments[0] as string | undefined;
  // Popups and modals wait for the launch loading screen to leave, or they'd draw over it.
  const bootDone = useBootDone();

  useEffect(() => {
    if (ready && needsOnboarding && linkCode) void savePendingInvite(linkCode, { signedIn: true });
  }, [ready, needsOnboarding, linkCode]);

  useEffect(() => {
    if (ready && needsOnboarding && refCode) void savePendingReferral(refCode);
  }, [ready, needsOnboarding, refCode]);

  useEffect(() => {
    if (!ready || needsOnboarding || !profile?.uid || top === "onboarding" || top === "join") return;
    let cancelled = false;
    void takePendingInvite().then((code) => {
      if (cancelled || !code) return;
      router.navigate({ pathname: "/(tabs)/leagues", params: { join: "1", code, via: "link", t: String(Date.now()) } });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, needsOnboarding, profile?.uid, top]);

  useEffect(() => {
    if (ready) trace("boot", needsOnboarding ? "shell ready (onboarding)" : "shell ready");
  }, [ready, needsOnboarding]);

  // The launch loading screen may leave once what's beneath it is drawn.
  useEffect(() => {
    if (ready && (avatarReady || needsOnboarding)) markBootReady();
  }, [ready, avatarReady, needsOnboarding]);

  const signedInUid = profile?.uid ?? null;
  useEffect(() => {
    if (signedInUid) void flushAnalytics();
  }, [signedInUid]);

  if (!ready) return <Splash />;

  if (needsOnboarding && segments[0] !== "onboarding" && segments[0] !== "legal") {
    return <Redirect href="/onboarding" />;
  }

  const uid = profile?.uid ?? null;
  const inMainApp = bootDone && !needsOnboarding && top !== "onboarding" && top !== "login" && top !== "legal";

  return (
    <View style={{ flex: 1 }}>
    <LeagueProvider uid={uid}>
      <NotificationProvider uid={uid} promptForPush={false}>
        <ChallengeProvider uid={uid}>
          <AdsProvider uid={uid} active={!!uid && !needsOnboarding}>
            <CartProvider>
              <ToastProvider>
              <ParlayProvider>
                <ChatProvider>
                  <AvatarPortraitStudio />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
                    <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
                    <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="messages" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="bets" dangerouslySingular />
                    <Stack.Screen name="shop" dangerouslySingular />
                    <Stack.Screen name="moves" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="levels" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="trophies" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="settings" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="legal" dangerouslySingular options={{ animation: "slide_from_bottom" }} />
                    <Stack.Screen name="customize" dangerouslySingular options={{ animation: "slide_from_bottom" }} />
                    <Stack.Screen name="checkout" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="parlay" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="tutorial-league" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="activity" dangerouslySingular />
                    <Stack.Screen name="feed" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="challenges" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="league/[id]" dangerouslySingular />
                    <Stack.Screen name="game/[id]" dangerouslySingular options={{ animation: "slide_from_right" }} />
                    <Stack.Screen name="league/[id]/recap" dangerouslySingular />
                    <Stack.Screen name="wrapped/[id]" dangerouslySingular />
                    <Stack.Screen name="ladder" dangerouslySingular />
                    <Stack.Screen name="season" dangerouslySingular />
                  </Stack>
                  <AppWalkthroughModal autoTrigger={inMainApp} />
                  {uid && bootDone ? <ResultPopupHost /> : null}
                  {uid ? <PresenceBeat uid={uid} /> : null}
                  {uid && bootDone ? <InviteToastHost /> : null}
                  {uid && bootDone && (avatarReady || needsOnboarding) ? <EngagementWatchers /> : null}
                  {uid && inMainApp ? <LevelUpHost /> : null}
                  {__DEV__ && hasDevFlags && uid && inMainApp ? <DevFlagsRunner uid={uid} /> : null}
                  <ToastHost />
                  {uid && bootDone ? <GlobalHosts /> : null}
                  {uid && inMainApp ? <TourHost /> : null}
                  {uid && inMainApp ? <TermsGate /> : null}
                </ChatProvider>
              </ParlayProvider>
              </ToastProvider>
            </CartProvider>
          </AdsProvider>
        </ChallengeProvider>
      </NotificationProvider>
    </LeagueProvider>
    {/* The app mounts underneath so the avatar can build; the logo stays up until it has. */}
    {avatarReady || needsOnboarding ? null : (
      <View style={StyleSheet.absoluteFill}>
        <Splash />
      </View>
    )}
    </View>
  );
}

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BRAND.deepFelt }}>
      <HouseLogo size={128} variant="dark" />
      <ActivityIndicator color={BRAND.gold} style={{ marginTop: 32 }} />
    </View>
  );
}

function RootLayoutNav() {
  const { currentUser, loading } = useAuth();
  const segments = useSegments();
  const linkCode = useInviteLinkCode();
  const refCode = useReferralLinkCode();

  useEffect(() => {
    if (!loading && firebaseConfigured && !currentUser && linkCode) void savePendingInvite(linkCode, { signedIn: false });
  }, [loading, currentUser, linkCode]);

  useEffect(() => {
    if (!loading && firebaseConfigured && !currentUser && refCode) void savePendingReferral(refCode);
  }, [loading, currentUser, refCode]);

  const signedOut = !loading && firebaseConfigured && !currentUser;
  useEffect(() => {
    if (signedOut) markBootReady();
  }, [signedOut]);

  if (loading) return <Splash />;

  if (firebaseConfigured && !currentUser) {
    // Terms / Privacy stay readable signed out (linked from sign-up).
    if (segments[0] !== "login" && segments[0] !== "legal") return <Redirect href="/login" />;
  }

  const uid = currentUser?.uid ?? "local";

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
    Inter_800ExtraBold,
    Inter_900Black,
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
      <BootScreen />
      <ConnectionGate />
    </SafeAreaProvider>
  );
}

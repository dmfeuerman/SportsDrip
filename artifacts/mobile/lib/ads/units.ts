import { Platform } from "react-native";
import sdk from "./sdk";

export type AdPlacement = "native" | "interstitial" | "rewarded" | "appOpen" | "banner";

// Literal process.env reads so Expo inlines them at build time.
const REAL: Record<"ios" | "android", Record<AdPlacement, string | undefined>> = {
  ios: {
    native: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE,
    interstitial: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL,
    rewarded: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED,
    appOpen: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_OPEN,
    banner: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER,
  },
  android: {
    native: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE,
    interstitial: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL,
    rewarded: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED,
    appOpen: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_OPEN,
    banner: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER,
  },
};

/** Force Google's test units in a release build (internal testing tracks). */
const FORCE_TEST = process.env.EXPO_PUBLIC_ADMOB_TEST_ADS === "1";

/**
 * The ad unit for a placement on this platform, or null to show nothing.
 * Dev builds always use Google's test units — real units in development
 * count as invalid traffic. A release build with no unit configured shows no
 * ad rather than a "Test Ad".
 */
export function adUnit(placement: AdPlacement): string | null {
  if (!sdk || (Platform.OS !== "ios" && Platform.OS !== "android")) return null;
  if (__DEV__ || FORCE_TEST) {
    const t = sdk.TestIds;
    return { native: t.NATIVE, interstitial: t.INTERSTITIAL, rewarded: t.REWARDED, appOpen: t.APP_OPEN, banner: t.ADAPTIVE_BANNER }[placement] || null;
  }
  return REAL[Platform.OS][placement]?.trim() || null;
}

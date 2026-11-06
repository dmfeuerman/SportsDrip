import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

export type AdsSdk = typeof import("react-native-google-mobile-ads");

/**
 * Loaded lazily so the app still boots where the native module isn't linked:
 * Expo Go, or a dev client built before the package was added. In both cases
 * `sdk` is null and every ad surface quietly renders nothing.
 */
function load(): AdsSdk | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    return require("react-native-google-mobile-ads") as AdsSdk;
  } catch {
    return null;
  }
}

const sdk = load();
export default sdk;

/** iOS App Tracking Transparency, asked once, after the UMP consent form. */
export async function requestTrackingIfNeeded(): Promise<{ asked: boolean; granted: boolean }> {
  if (Platform.OS !== "ios") return { asked: false, granted: false };
  try {
    const att = require("expo-tracking-transparency") as typeof import("expo-tracking-transparency");
    const current = await att.getTrackingPermissionsAsync();
    if (current.status === "undetermined" && current.canAskAgain) {
      const res = await att.requestTrackingPermissionsAsync();
      return { asked: true, granted: res.status === "granted" };
    }
  } catch {
    // Not linked in this build; ads still serve, just non-personalised on iOS.
  }
  return { asked: false, granted: false };
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { firebaseConfigured } from "@/lib/firebase";

/**
 * iOS push (APNs via Expo's push service).
 *
 * The server never pushes from inside a money transaction: settlement writes
 * users/{uid}/notifications/{id}, and the pushOnNotification trigger fans that
 * document out to the tokens registered here. Everything in this file is
 * best effort — a device that can't get a token still gets every in-app popup.
 */

const TOKEN_KEY = "sportdrip.push.token.v1";
const REG_KEY = "sportdrip.push.registration.v1";
/** Re-confirm an unchanged token with the server at most this often (it runs on every foreground). */
const REREGISTER_MS = 24 * 3_600_000;

export type PushStatus = "unsupported" | "undetermined" | "denied" | "granted";

let handlerSet = false;

/**
 * While the app is open, the in-app result popup and toast banner already
 * show the notification, so the system banner would be a duplicate. It still
 * goes to Notification Center and updates the badge.
 */
export function configurePushPresentation(): void {
  if (handlerSet || Platform.OS !== "ios") return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

/** EAS project id, required for Expo push tokens. Set by `eas init` (extra.eas.projectId). */
export function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? null;
}

function supported(): boolean {
  return Platform.OS === "ios" && Device.isDevice && firebaseConfigured && !DEMO;
}

function toStatus(p: Notifications.NotificationPermissionsStatus): PushStatus {
  const provisional = p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (p.granted || provisional) return "granted";
  return p.status === "denied" ? "denied" : "undetermined";
}

export async function pushPermissionStatus(): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  try {
    return toStatus(await Notifications.getPermissionsAsync());
  } catch {
    return "unsupported";
  }
}

/**
 * Gets (and optionally asks for) permission, then registers this device's
 * Expo token with the server. `prompt: false` only refreshes a token the user
 * already allowed, so it is safe to run on every launch and foreground.
 */
export async function registerForPush({ prompt, uid }: { prompt: boolean; uid: string }): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (toStatus(perm) === "undetermined" && prompt) {
      perm = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    }
    const status = toStatus(perm);
    if (status !== "granted") return status;

    const projectId = easProjectId();
    if (!projectId) {
      if (__DEV__) console.warn("[push] No EAS projectId (run `eas init`); skipping token registration.");
      return status;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const last = await AsyncStorage.getItem(REG_KEY)
      .then((raw) => (raw ? (JSON.parse(raw) as { token?: string; uid?: string; at?: number }) : null))
      .catch(() => null);
    // Same device token, same account, confirmed recently: nothing to tell the server.
    if (last?.token === token && last.uid === uid && typeof last.at === "number" && Date.now() - last.at < REREGISTER_MS) {
      return status;
    }
    await registerPushToken({ token, enabled: true, platform: "ios" });
    await AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [REG_KEY, JSON.stringify({ token, uid, at: Date.now() })],
    ]).catch(() => {});
    return status;
  } catch (err) {
    if (__DEV__) console.warn("[push] registration failed", err);
    return "undetermined";
  }
}

/**
 * Detaches this device from the signed-in account. Called before sign-out
 * (while the auth token still works) so the next person to use the phone
 * doesn't get the previous account's pushes. Bounded so a dead network can't
 * hold up signing out.
 */
export async function unregisterPush(timeoutMs = 3_000): Promise<void> {
  if (!supported()) return;
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  try {
    await Promise.race([
      registerPushToken({ token, enabled: false, platform: "ios" }),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // The server prunes dead or moved tokens on its own; never block sign-out.
  } finally {
    await AsyncStorage.multiRemove([TOKEN_KEY, REG_KEY]).catch(() => {});
    await Notifications.setBadgeCountAsync(0).catch(() => false);
  }
}

export async function setAppBadge(count: number): Promise<void> {
  if (!supported()) return;
  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => false);
}

/** The in-app route carried by a push (`data.url`), if it's one we can open. */
export function routeFromResponse(response: Notifications.NotificationResponse | null): { url: string; notificationId: string | null } | null {
  const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
  const url = typeof data?.url === "string" ? data.url : null;
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  return { url, notificationId: typeof data?.notificationId === "string" ? data.notificationId : null };
}

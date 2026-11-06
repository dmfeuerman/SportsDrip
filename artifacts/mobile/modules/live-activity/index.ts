import { Platform } from "react-native";

/**
 * JS bridge to modules/live-activity (ActivityKit + App Group widget snapshot).
 * Every call is a safe no-op when the native module isn't in the build
 * (Expo Go, web, Android, or a build without ENABLE_APPLE_TARGETS).
 */
export interface ActivityAttrs {
  homeAbbr: string;
  awayAbbr: string;
  yourSide: "home" | "away";
}
export interface ActivityState {
  homeScore: number;
  awayScore: number;
  clock: string;
  status: "live" | "final" | "delayed";
  coverMargin?: number | null;
  h2hDelta?: number | null;
}
export interface WidgetSnapshot {
  h2hMe: number;
  h2hThem: number;
  opponent: string;
  streak: number;
  dailyPick: "picked" | "open" | "none";
  updatedAt: number;
}

interface Native {
  isSupported(): boolean;
  start(gameId: string, attrs: ActivityAttrs, state: ActivityState): Promise<string | null>;
  update(gameId: string, state: ActivityState): Promise<void>;
  end(gameId: string): Promise<void>;
  setWidgetSnapshot(json: string): void;
  addListener(event: "onPushToken", fn: (e: { gameId: string; activityId: string; token: string }) => void): { remove(): void };
}

let native: Native | null = null;
if (Platform.OS === "ios") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = (require("expo-modules-core") as { requireOptionalNativeModule: (n: string) => Native | null }).requireOptionalNativeModule("LiveActivity");
  } catch {
    native = null;
  }
}

export const liveActivitySupported = (): boolean => {
  try {
    return !!native?.isSupported();
  } catch {
    return false;
  }
};
export const startActivity = (gameId: string, attrs: ActivityAttrs, state: ActivityState) => native?.start(gameId, attrs, state).catch(() => null) ?? Promise.resolve(null);
export const updateActivity = (gameId: string, state: ActivityState) => native?.update(gameId, state).catch(() => {}) ?? Promise.resolve();
export const endActivity = (gameId: string) => native?.end(gameId).catch(() => {}) ?? Promise.resolve();
export const onActivityPushToken = (fn: (e: { gameId: string; activityId: string; token: string }) => void) => native?.addListener("onPushToken", fn) ?? { remove() {} };
export function setWidgetSnapshot(s: WidgetSnapshot): void {
  try {
    native?.setWidgetSnapshot(JSON.stringify(s));
  } catch {}
}

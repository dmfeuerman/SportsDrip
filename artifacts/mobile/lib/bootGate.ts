import { useSyncExternalStore } from "react";
import { BOOT_WINDOW } from "@/constants/ads";

/**
 * The launch loading screen's clock. Starts when the bundle loads; the screen
 * stays up for at least BOOT_WINDOW.minMs and leaves by BOOT_WINDOW.maxMs,
 * waiting in between for the app to be ready and for the launch ad to close.
 */
const bootStart = Date.now();
let appReady = false;
let adShowing = false;
let done = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const bootElapsed = () => Date.now() - bootStart;
export const isBooting = () => !done;
export const isBootReady = () => appReady;

/** The screen under the loading overlay can be shown (login, onboarding or the drawn home). */
export function markBootReady() {
  if (appReady) return;
  appReady = true;
  emit();
}

/** The launch app-open ad is on screen; the loading screen holds until it closes. */
export function setBootAdShowing(showing: boolean) {
  if (adShowing === showing) return;
  adShowing = showing;
  emit();
}

/** Called by the loading screen's ticker. Returns true once the window has closed. */
export function evaluateBoot(): boolean {
  if (done) return true;
  const t = bootElapsed();
  if (t >= BOOT_WINDOW.maxMs || (t >= BOOT_WINDOW.minMs && appReady && !adShowing)) {
    done = true;
    emit();
  }
  return done;
}

/** True while there's still time left to show the launch ad without delaying a ready app. */
export function bootAdWindowOpen(): boolean {
  if (done) return false;
  const t = bootElapsed();
  if (t >= BOOT_WINDOW.maxMs - 3_000) return false;
  return t < BOOT_WINDOW.adCutoffMs || !appReady;
}

/** Time left before the loading screen must leave, for gates that wait underneath it. */
export const bootTimeLeft = () => Math.max(0, BOOT_WINDOW.maxMs - bootElapsed());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBootDone(): boolean {
  return useSyncExternalStore(subscribe, () => done);
}

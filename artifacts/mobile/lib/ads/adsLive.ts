import { useSyncExternalStore } from "react";

/**
 * Whether ads are cleared to show (consent and SDK ready). Mirrors AdsProvider's
 * `enabled` for surfaces that render outside the provider, like the loading screen.
 */
let live = false;
const listeners = new Set<() => void>();

export function setAdsLive(next: boolean) {
  if (next === live) return;
  live = next;
  listeners.forEach((l) => l());
}

export function useAdsLive(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => live,
    () => false
  );
}

import { usePathname } from "expo-router";
import { useState } from "react";

/**
 * Ad-free zones. No ad of any kind — sponsored card, banner, fullscreen ad or
 * "watch a video" offer — is ever shown on these screens, or on anything
 * opened on top of them (a bet slip or game sheet opened from a league chat
 * is still inside the league).
 *
 * Enforced inside the ad components themselves (SponsoredCard, BannerSlot,
 * the watch-a-video offers) and in AdsProvider for fullscreen ads, so a
 * placement added to one of these screens later still renders nothing.
 */
const AD_FREE: RegExp[] = [
  /^\/messages(\/|$)/, // direct and league chat
  /^\/league(\/|$)/, // a league: chat, table, bets, loans, info, weekly report
  /^\/wrapped(\/|$)/, // a league's season wrapped
  /^\/tutorial-league(\/|$)/,
  /^\/join(\/|$)/,
  /^\/(login|onboarding|legal)(\/|$)/,
];

export function isAdFreePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return AD_FREE.some((re) => re.test(pathname));
}

/**
 * True when this component was put on screen inside an ad-free zone. Decided
 * once, when it mounts: a card on Home stays as it is while a league is open
 * on top of it (no reload when the player comes back), and anything mounted
 * while a chat or league is showing never renders an ad.
 */
export function useAdFreeHere(): boolean {
  const pathname = usePathname();
  const [free] = useState(() => isAdFreePath(pathname));
  return free;
}

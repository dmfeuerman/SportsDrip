/**
 * Ad policy: earn without getting in the way.
 *
 *  1. Nothing interrupts. No fullscreen ad ever opens on its own; the only
 *     fullscreen ads are rewarded videos the player chooses to watch for
 *     credits (the best-paying format, and the one players ask for).
 *  2. In-feed ads are sparse, labelled "Sponsored", drawn like the app's own
 *     cards, sit only in browse lists (never beside a button or a decision),
 *     and take no space when nothing loads.
 *  3. Chat and leagues are ad-free, always (lib/ads/zones.ts).
 *
 * The three switches below turn the automatic fullscreen formats back on if
 * revenue ever needs them; pacing limits further down still apply.
 */
export const AD_POLICY = {
  /** App-open ad over the launch loading screen. */
  launchAd: false,
  /** App-open ad when returning after a long break. */
  resumeAd: false,
  /** Interstitial at natural pauses (results seen, a box claimed, leaving a read-only screen). */
  interstitials: false,
  /** Thin banners between games on the board (on top of the sponsored cards). */
  boardThinBanners: false,
  /** No interstitial until the session has been running this long. */
  interstitialGraceMs: 2 * 60_000,
  /** Minimum gap between any two fullscreen ads (app open, interstitial or rewarded). */
  interstitialMinGapMs: 6 * 60_000,
  interstitialMaxPerSession: 3,
  /** Games board: first sponsored card after this many games, then every N. */
  boardFirstAfter: 6,
  boardEvery: 10,
  boardMax: 3,
  /** Feed-style lists (bets, crew feed, activity): first sponsored card after N rows, then every M. */
  listFirstAfter: 5,
  listEvery: 10,
  /** App-open ad when returning to the app after at least this long away. */
  appOpenResumeAfterMs: 30 * 60_000,
  appOpenMaxResumesPerSession: 1,
  /** AdMob app-open ads go stale after 4 hours. */
  appOpenTtlMs: 4 * 60 * 60_000,
} as const;

/** Launch loading screen: always at least MIN, never more than MAX. */
export const BOOT_WINDOW = {
  minMs: 1_500,
  maxMs: 30_000,
  /** Don't start the launch ad this close to a loading screen that's ready to leave. */
  adCutoffMs: 4_000,
} as const;

/** Display mirror of AD_REWARD in functions/src/lib/economy.ts. The server decides. */
export const AD_REWARD_DISPLAY = {
  credits: 100,
  dailyLimit: 5,
  customData: "credits",
} as const;

/** Every few slots in a list, true at the rows a sponsored card follows. */
export function adAfterRow(index: number, firstAfter: number = AD_POLICY.listFirstAfter, every: number = AD_POLICY.listEvery): boolean {
  const slot = index + 1 - firstAfter;
  return slot >= 0 && slot % every === 0;
}

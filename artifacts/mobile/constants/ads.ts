/**
 * Ad pacing. Ads earn their place by never interrupting a decision: nothing
 * fullscreen while a bet slip, wheel or result is on screen, and no
 * interstitial in the first minutes of a session (the launch already showed
 * an app-open ad).
 */
export const AD_POLICY = {
  /**
   * Full-screen ads (app open, interstitial) only ever open from a player's own
   * tap on a Watch button. Off: nothing fullscreen plays automatically.
   */
  autoFullscreen: false,
  /** No interstitial until the session has been running this long. */
  interstitialGraceMs: 2 * 60_000,
  /** Minimum gap between any two fullscreen ads (app open, interstitial or rewarded). */
  interstitialMinGapMs: 6 * 60_000,
  interstitialMaxPerSession: 3,
  /** Games board: first sponsored card after this many games, then every N. */
  boardFirstAfter: 4,
  boardEvery: 5,
  boardMax: 6,
  /** Feed-style lists (bets, crew feed, activity): first sponsored card after N rows, then every M. */
  listFirstAfter: 3,
  listEvery: 7,
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

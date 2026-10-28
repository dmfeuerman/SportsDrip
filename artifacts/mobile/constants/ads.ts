/**
 * Ad pacing. Ads earn their place by never interrupting a decision: nothing
 * fullscreen while a bet slip, wheel or result is on screen, and never in the
 * first minutes of a session.
 */
export const AD_POLICY = {
  /** No interstitial until the session has been running this long. */
  interstitialGraceMs: 3 * 60_000,
  /** Minimum gap between any two fullscreen ads (interstitial or rewarded). */
  interstitialMinGapMs: 5 * 60_000,
  interstitialMaxPerSession: 4,
  /** Games board: first sponsored card after this many games, then every N. */
  boardFirstAfter: 2,
  boardEvery: 3,
  boardMax: 15,
} as const;

/** Display mirror of AD_REWARD in functions/src/lib/economy.ts. The server decides. */
export const AD_REWARD_DISPLAY = {
  credits: 100,
  dailyLimit: 5,
  customData: "credits",
} as const;

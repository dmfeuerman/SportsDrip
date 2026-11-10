import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canPrompt, markPromptResult, markPromptShown, promptGateReady } from "@/lib/promptGate";
import { AppState } from "react-native";
import { AD_POLICY, AD_REWARD_DISPLAY } from "@/constants/ads";
import sdk, { requestTrackingIfNeeded } from "@/lib/ads/sdk";
import { setAdsLive } from "@/lib/ads/adsLive";
import { adUnit } from "@/lib/ads/units";
import { claimAdReward } from "@/lib/api";
import { trace } from "@/lib/devtrace";
import { bootAdWindowOpen, isBooting, setBootAdShowing } from "@/lib/bootGate";

type Interstitial = import("react-native-google-mobile-ads").InterstitialAd;
type Rewarded = import("react-native-google-mobile-ads").RewardedAd;
type AppOpen = import("react-native-google-mobile-ads").AppOpenAd;

export type RewardedStatus = "idle" | "loading" | "ready" | "showing" | "unavailable";
export type RewardOutcome = "earned" | "dismissed" | "unavailable";

interface AdsContextValue {
  /** SDK linked, consent resolved, SDK initialised. Placements render only when true. */
  enabled: boolean;
  /** UMP says the user must be able to revisit their choices (EEA/UK). */
  privacyOptionsRequired: boolean;
  openPrivacyOptions: () => Promise<void>;
  rewardedStatus: RewardedStatus;
  loadRewarded: () => void;
  /** Resolves when the video closes. "earned" is display-only; the server credits via SSV. */
  showRewarded: () => Promise<RewardOutcome>;
  /** A natural pause (a result dismissed, a box claimed). Shows an interstitial only if pacing allows. */
  breakpoint: (reason: string) => void;
}

const noop = () => {};
const AdsContext = createContext<AdsContextValue>({
  enabled: false,
  privacyOptionsRequired: false,
  openPrivacyOptions: async () => {},
  rewardedStatus: "unavailable",
  loadRewarded: noop,
  showRewarded: async () => "unavailable",
  breakpoint: noop,
});

export const useAds = () => useContext(AdsContext);

// The SDK initialises once per process, however often the provider remounts.
let initOnce: Promise<boolean> | null = null;

async function initialise(): Promise<boolean> {
  if (!sdk) return false;
  let info: Awaited<ReturnType<typeof sdk.AdsConsent.gatherConsent>> | null = null;
  try {
    info = await sdk.AdsConsent.gatherConsent();
  } catch (err) {
    trace("ads", `consent form unavailable: ${(err as Error)?.message}`);
    info = await sdk.AdsConsent.getConsentInfo().catch(() => null);
  }
  if (!info?.canRequestAds) return false;
  // ATT waits for session 2 and the one-prompt-per-session gate; ads still serve
  // non-personalised until then.
  await promptGateReady();
  if (canPrompt("att")) {
    const att = await requestTrackingIfNeeded();
    if (att.asked) {
      markPromptShown("att");
      markPromptResult("att", att.granted);
    }
  }
  await sdk.default().setRequestConfiguration({ maxAdContentRating: sdk.MaxAdContentRating.T });
  await sdk.default().initialize();
  return true;
}

export function AdsProvider({ uid, active, children }: { uid: string | null; active: boolean; children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setAdsLive(enabled);
    return () => setAdsLive(false);
  }, [enabled]);
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
  const [rewardedStatus, setRewardedStatus] = useState<RewardedStatus>(sdk ? "idle" : "unavailable");

  const sessionStart = useRef(Date.now());
  const lastFullscreen = useRef(0);
  const shown = useRef(0);
  const interstitial = useRef<Interstitial | null>(null);
  const interstitialReady = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewarded = useRef<Rewarded | null>(null);
  const rewardNonce = useRef<string | null>(null);
  const rewardedStatusRef = useRef<RewardedStatus>(rewardedStatus);
  rewardedStatusRef.current = rewardedStatus;
  /** Any fullscreen ad on screen right now (its click-through backgrounds the app). */
  const fullscreenOpen = useRef(false);
  const appOpen = useRef<AppOpen | null>(null);
  const appOpenLoadedAt = useRef(0);
  const appOpenResumes = useRef(0);
  const bootAdTried = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  const refreshPrivacyStatus = useCallback(async () => {
    if (!sdk) return;
    const info = await sdk.AdsConsent.getConsentInfo().catch(() => null);
    setPrivacyOptionsRequired(
      info?.privacyOptionsRequirementStatus === sdk.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
    );
  }, []);

  // Consent → ATT → initialise. Held until the player has a profile, so the
  // consent form never lands on top of signup.
  useEffect(() => {
    if (!sdk || !active) return;
    let cancelled = false;
    initOnce ??= initialise().catch((err) => {
      trace("ads", `init failed: ${(err as Error)?.message}`);
      initOnce = null;
      return false;
    });
    initOnce.then((ok) => {
      if (cancelled) return;
      refreshPrivacyStatus();
      if (ok) {
        sessionStart.current = Date.now();
        setEnabled(true);
        trace("ads", "ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, refreshPrivacyStatus]);

  // ── Interstitial: one kept warm, shown only at breakpoints ───────────────
  const loadInterstitial = useCallback(() => {
    const unit = adUnit("interstitial");
    if (!sdk || !unit) return;
    interstitial.current?.removeAllListeners();
    interstitialReady.current = false;
    const ad = sdk.InterstitialAd.createForAdRequest(unit);
    ad.addAdEventListener(sdk.AdEventType.LOADED, () => {
      interstitialReady.current = true;
    });
    ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
      interstitialReady.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(loadInterstitial, 90_000);
    });
    ad.addAdEventListener(sdk.AdEventType.OPENED, () => {
      fullscreenOpen.current = true;
    });
    ad.addAdEventListener(sdk.AdEventType.CLOSED, () => {
      fullscreenOpen.current = false;
      lastFullscreen.current = Date.now();
      loadInterstitial();
    });
    interstitial.current = ad;
    ad.load();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    loadInterstitial();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      interstitial.current?.removeAllListeners();
      interstitial.current = null;
      rewarded.current?.removeAllListeners();
      rewarded.current = null;
      appOpen.current?.removeAllListeners();
      appOpen.current = null;
    };
  }, [enabled, loadInterstitial]);

  const breakpoint = useCallback(
    (reason: string) => {
      const ad = interstitial.current;
      if (!AD_POLICY.autoFullscreen) return;
      if (!enabled || !ad || !interstitialReady.current || fullscreenOpen.current || isBooting()) return;
      const now = Date.now();
      if (now - sessionStart.current < AD_POLICY.interstitialGraceMs) return;
      if (now - lastFullscreen.current < AD_POLICY.interstitialMinGapMs) return;
      if (shown.current >= AD_POLICY.interstitialMaxPerSession) return;
      if (AppState.currentState !== "active") return;
      shown.current += 1;
      interstitialReady.current = false;
      lastFullscreen.current = now;
      trace("ads", `interstitial at ${reason}`);
      // Let the sheet or popup that triggered this finish animating out.
      setTimeout(() => {
        ad.show().catch(() => loadInterstitial());
      }, 400);
    },
    [enabled, loadInterstitial]
  );

  // ── App open: over the launch loading screen, and on return after a long break ──
  const loadAppOpen = useCallback(
    (onLoaded?: () => void) => {
      const unit = adUnit("appOpen");
      if (!sdk || !unit) return;
      appOpen.current?.removeAllListeners();
      const ad = sdk.AppOpenAd.createForAdRequest(unit);
      ad.addAdEventListener(sdk.AdEventType.LOADED, () => {
        appOpenLoadedAt.current = Date.now();
        onLoaded?.();
      });
      ad.addAdEventListener(sdk.AdEventType.ERROR, (err) => {
        trace("ads", `app open load failed: ${(err as Error)?.message}`);
        if (appOpen.current === ad) appOpen.current = null;
      });
      appOpen.current = ad;
      appOpenLoadedAt.current = 0;
      ad.load();
    },
    []
  );

  const showAppOpen = useCallback((reason: "launch" | "resume") => {
    const ad = appOpen.current;
    if (!sdk || !ad || fullscreenOpen.current) return false;
    appOpen.current = null;
    fullscreenOpen.current = true;
    if (reason === "launch") setBootAdShowing(true);
    const done = () => {
      fullscreenOpen.current = false;
      lastFullscreen.current = Date.now();
      if (reason === "launch") setBootAdShowing(false);
      ad.removeAllListeners();
      loadAppOpen(); // warm the next one for a later return
    };
    ad.addAdEventListener(sdk.AdEventType.CLOSED, done);
    trace("ads", `app open at ${reason}`);
    ad.show().catch(done);
    return true;
  }, [loadAppOpen]);

  // Launch: request as soon as ads are ready; show only while the loading screen is still up.
  useEffect(() => {
    if (!AD_POLICY.autoFullscreen || !enabled || bootAdTried.current) return;
    bootAdTried.current = true;
    if (!isBooting()) return loadAppOpen();
    loadAppOpen(() => {
      if (bootAdWindowOpen() && AppState.currentState === "active") showAppOpen("launch");
    });
  }, [enabled, loadAppOpen, showAppOpen]);

  // Resume: an app-open ad when coming back after a long break, never on top of another ad.
  useEffect(() => {
    if (!AD_POLICY.autoFullscreen || !enabled) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        // An ad's click-through backgrounds the app; that's not the player leaving.
        backgroundedAt.current = fullscreenOpen.current ? null : Date.now();
        return;
      }
      if (next !== "active") return;
      const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
      backgroundedAt.current = null;
      const loadedAt = appOpenLoadedAt.current;
      const fresh = !!appOpen.current && loadedAt > 0 && Date.now() - loadedAt < AD_POLICY.appOpenTtlMs;
      if (
        away >= AD_POLICY.appOpenResumeAfterMs &&
        appOpenResumes.current < AD_POLICY.appOpenMaxResumesPerSession &&
        fresh &&
        !isBooting()
      ) {
        appOpenResumes.current += 1;
        showAppOpen("resume");
      }
      if (!appOpen.current || !fresh) loadAppOpen();
    });
    return () => sub.remove();
  }, [enabled, loadAppOpen, showAppOpen]);

  // ── Rewarded: loaded on demand by the surface that offers it ─────────────
  const loadRewarded = useCallback(() => {
    const unit = adUnit("rewarded");
    if (!sdk || !enabled || !uid) return;
    if (!unit) {
      setRewardedStatus("unavailable");
      return;
    }
    // Several surfaces offer the same video; one warm ad serves them all.
    if (rewardedStatusRef.current === "loading" || rewardedStatusRef.current === "ready" || rewardedStatusRef.current === "showing") return;
    rewardedStatusRef.current = "loading";
    rewarded.current?.removeAllListeners();
    // userId + customData are echoed, signed, to the SSV callback — that's how
    // the server knows whom to credit and for what. The nonce is shared with
    // the app's own claim so the two can never both pay for one view.
    const nonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    rewardNonce.current = nonce;
    const ad = sdk.RewardedAd.createForAdRequest(unit, {
      serverSideVerificationOptions: { userId: uid, customData: `${AD_REWARD_DISPLAY.customData}:${nonce}` },
    });
    ad.addAdEventListener(sdk.RewardedAdEventType.LOADED, () => setRewardedStatus("ready"));
    ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
      if (rewarded.current === ad) setRewardedStatus("unavailable");
    });
    rewarded.current = ad;
    setRewardedStatus("loading");
    ad.load();
  }, [enabled, uid]);

  const showRewarded = useCallback(
    () =>
      new Promise<RewardOutcome>((resolve) => {
        const ad = rewarded.current;
        if (!sdk || !ad || rewardedStatus !== "ready") return resolve("unavailable");
        let earned = false;
        const nonce = rewardNonce.current;
        const offEarned = ad.addAdEventListener(sdk.RewardedAdEventType.EARNED_REWARD, () => {
          if (earned) return;
          earned = true;
          // SSV never fires for test units or units without a callback URL;
          // the claim covers those, and is a no-op if SSV already paid.
          if (nonce) {
            claimAdReward({ nonce })
              .then((r) => trace("ads", `reward claim: ${r.result}`))
              .catch((err) => trace("ads", `reward claim failed: ${(err as Error)?.message}`));
          }
        });
        const offClosed = ad.addAdEventListener(sdk.AdEventType.CLOSED, () => {
          offEarned?.();
          offClosed?.();
          fullscreenOpen.current = false;
          lastFullscreen.current = Date.now();
          rewarded.current = null;
          setRewardedStatus("idle");
          resolve(earned ? "earned" : "dismissed");
        });
        fullscreenOpen.current = true;
        setRewardedStatus("showing");
        ad.show().catch(() => {
          offEarned?.();
          offClosed?.();
          fullscreenOpen.current = false;
          rewarded.current = null;
          setRewardedStatus("unavailable");
          resolve("unavailable");
        });
      }),
    [rewardedStatus]
  );

  const openPrivacyOptions = useCallback(async () => {
    if (!sdk) return;
    await sdk.AdsConsent.showPrivacyOptionsForm().catch(() => null);
    await refreshPrivacyStatus();
  }, [refreshPrivacyStatus]);

  const value = useMemo<AdsContextValue>(
    () => ({
      enabled,
      privacyOptionsRequired,
      openPrivacyOptions,
      rewardedStatus,
      loadRewarded,
      showRewarded,
      breakpoint,
    }),
    [enabled, privacyOptionsRequired, openPrivacyOptions, rewardedStatus, loadRewarded, showRewarded, breakpoint]
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

/** Leaving a read-only screen is a natural break: offer the interstitial pacer a slot on the way out. */
export function useExitBreakpoint(reason: string) {
  const { breakpoint } = useAds();
  const ref = useRef(breakpoint);
  ref.current = breakpoint;
  useEffect(() => () => ref.current(reason), [reason]);
}

import { useCallback, useEffect, useState } from "react";
import { AD_REWARD_DISPLAY } from "@/constants/ads";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAdRewardsToday } from "@/hooks/useAdRewardsToday";
import { haptic as buzz } from "@/lib/motion";
import sdk from "@/lib/ads/sdk";
import { useAdFreeHere } from "@/lib/ads/zones";
import { showCreditsEarned } from "@/components/ads/CreditsEarnedPopup";

const CONFIRM_TIMEOUT_MS = 20_000;

export type BonusVideoButton = { label: string; disabled: boolean; loading: boolean; onPress?: () => void };

/**
 * The watch-a-video-for-credits flow, shared by every surface that offers it.
 * The video's "earned" event only changes what the UI says — the credits are
 * minted by the AdMob SSV callback on the server, and the UI confirms once
 * that write shows up in Firestore.
 */
export function useBonusVideo() {
  const { enabled, rewardedStatus, loadRewarded, showRewarded } = useAds();
  const { profile } = useApp();
  const used = useAdRewardsToday(profile?.uid);
  const left = Math.max(0, AD_REWARD_DISPLAY.dailyLimit - (used ?? 0));
  // No "watch a video" offer inside a chat or a league either.
  const adFree = useAdFreeHere();
  const available = !!sdk && enabled && !adFree;

  const [crediting, setCrediting] = useState<number | null>(null); // count before the view
  const [note, setNote] = useState<{ text: string; tone: "ok" | "info" } | null>(null);

  // Warm one video while there's something left to earn.
  useEffect(() => {
    if (available && used !== null && left > 0 && rewardedStatus === "idle") loadRewarded();
  }, [available, used, left, rewardedStatus, loadRewarded]);

  // The server's counter moving is the confirmation.
  useEffect(() => {
    if (crediting === null || used === null || used <= crediting) return;
    setCrediting(null);
    setNote({ text: `+${AD_REWARD_DISPLAY.credits} credits added`, tone: "ok" });
    showCreditsEarned(AD_REWARD_DISPLAY.credits);
    buzz.success();
  }, [used, crediting]);

  useEffect(() => {
    if (crediting === null) return;
    const t = setTimeout(() => {
      setCrediting(null);
      setNote({ text: "Still confirming with the ad network — your credits will land shortly.", tone: "info" });
    }, CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [crediting]);

  const watch = useCallback(async () => {
    setNote(null);
    const before = used ?? 0;
    const { outcome, claim } = await showRewarded();
    if (outcome === "earned") {
      setCrediting(before);
      // The server's answer to the claim, so a refusal says why instead of spinning until the timeout.
      void claim?.then((r) => {
        if (r === "granted" || r === "duplicate" || r === "pending") return; // the counter moving confirms it
        setCrediting(null);
        setNote(
          r === "capped"
            ? { text: `That's today's ${AD_REWARD_DISPLAY.dailyLimit} bonus videos. Back tomorrow.`, tone: "info" }
            : r === "too_soon"
              ? { text: "That one was too quick to count. Try another in a few seconds.", tone: "info" }
              : { text: "Couldn't add the credits. Check your connection and try another video.", tone: "info" }
        );
      });
    }
    else if (outcome === "dismissed") setNote({ text: "Watch to the end to earn the bonus.", tone: "info" });
    else setNote({ text: "No video available right now. Try again in a bit.", tone: "info" });
  }, [used, showRewarded]);

  const done = left === 0 && crediting === null;
  const button: BonusVideoButton = done
    ? { label: "Back Tomorrow", disabled: true, loading: false }
    : crediting !== null
      ? { label: "Adding credits…", disabled: true, loading: true }
      : rewardedStatus === "ready"
        ? { label: `Watch · +${AD_REWARD_DISPLAY.credits}`, disabled: false, loading: false, onPress: watch }
        : rewardedStatus === "unavailable"
          ? { label: "Try Again", disabled: false, loading: false, onPress: loadRewarded }
          : { label: "Loading video…", disabled: true, loading: rewardedStatus !== "showing" };

  return { available, used, left, done, crediting: crediting !== null, ready: rewardedStatus === "ready", note, button, watch };
}

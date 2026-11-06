import React from "react";
import AvatarPreloader from "@/components/avatar/AvatarPreloader";
import GameSoonPill from "@/components/GameSoonPill";
import SyncFailureToaster from "@/components/SyncFailureToaster";
import ParlaySlip from "@/components/ParlaySlip";
import ParlayLeaveGuard from "@/components/ParlayLeaveGuard";
import KickoffSheet from "@/components/KickoffSheet";

/**
 * App-wide overlays and background helpers for a signed-in player. Kept out
 * of app/_layout.tsx so adding one doesn't hot-reload the root layout (which
 * can leave Expo Router's navigation container without an initial state).
 */
export default function GlobalHosts() {
  return (
    <>
      <GameSoonPill />
      <SyncFailureToaster />
      <AvatarPreloader />
      <ParlaySlip />
      <ParlayLeaveGuard />
      <KickoffSheet />
    </>
  );
}

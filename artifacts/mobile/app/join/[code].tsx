import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { clearPendingInvite, normalizeInviteCode } from "@/lib/invites";

/**
 * sportdrip://join/{CODE}
 *
 * Only reached by a signed-in, onboarded user: the root layout parks the code
 * and sends everyone else to login / onboarding first (lib/invites.ts). Here
 * the code goes straight to the Leagues tab's join sheet, which previews the
 * league and its buy-in before anything is charged.
 */
export default function JoinByLink() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = normalizeInviteCode(params.code);

  useEffect(() => {
    // Handled now, so the shell mustn't replay it later.
    void clearPendingInvite();
    if (code) trackEvent("invite_code_captured", { code, signed_in: true, deferred: false });
  }, [code]);

  if (!code) return <Redirect href="/(tabs)/leagues" />;
  // `t` re-opens the sheet if the same link is tapped again.
  return <Redirect href={{ pathname: "/(tabs)/leagues", params: { join: "1", code, via: "link", t: String(Date.now()) } }} />;
}

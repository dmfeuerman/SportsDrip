import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { clearPendingReferral } from "@/lib/referrals";

/**
 * sportdrip://ref/{CODE}
 *
 * Only reached by someone already signed up (the root layout parks the code
 * and sends everyone else to signup, where it's pre-filled). An existing
 * account can't use an invite code, so this just lands on Friends.
 */
export default function ReferralLink() {
  const params = useLocalSearchParams<{ code?: string }>();
  useEffect(() => {
    void clearPendingReferral();
  }, [params.code]);
  return <Redirect href={{ pathname: "/(tabs)/leagues", params: { seg: "friends" } }} />;
}

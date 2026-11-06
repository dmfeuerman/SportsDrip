import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { REFERRAL, XP } from "@/constants/progression";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { haptic } from "@/lib/motion";
import { referralMessage } from "@/lib/referrals";

/**
 * "Invite friends" on the Friends tab: your code, a share button, and what it
 * pays. A friend who signs up with it gets bonus credits, you get credits and
 * XP, and you start out as friends (callable/profile.ts).
 */
export default function InviteFriendsCard() {
  const c = useColors();
  const { profile } = useApp();
  const [code, setCode] = useState<string | null>(profile?.referralCode ?? null);
  const [loading, setLoading] = useState(false);
  const count = profile?.referralCount ?? 0;

  useEffect(() => {
    if (profile?.referralCode) {
      setCode(profile.referralCode);
      return;
    }
    if (DEMO || !profile?.uid) return;
    let live = true;
    setLoading(true);
    api
      .getReferralCode({})
      .then((r) => live && setCode(r.code))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [profile?.uid, profile?.referralCode]);

  const share = async () => {
    if (!code) return;
    haptic.light();
    try {
      await Share.share({ message: referralMessage(code, profile?.displayName) });
    } catch {
      // Dismissed.
    }
  };

  const paidOut = Math.min(count, REFERRAL.maxRewarded) * REFERRAL.referrerCredits;

  return (
    <View style={[styles.card, { borderColor: c.alpha(c.primary, 0.35), backgroundColor: c.card }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[c.alpha(c.primary, c.isDark ? 0.18 : 0.12), c.alpha(c.accent, 0.06), "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: c.alpha(c.primary, 0.16) }]}>
          <MaterialCommunityIcons name="account-heart" size={20} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>Invite friends, both get paid</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            They start with +{REFERRAL.newUserCredits.toLocaleString()} credits. You get +{REFERRAL.referrerCredits.toLocaleString()} credits and{" "}
            {XP.referrer} XP.
          </Text>
        </View>
      </View>

      <View style={styles.codeRow}>
        <View style={[styles.codeBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <Text style={[styles.codeLabel, { color: c.subtleForeground }]}>YOUR CODE</Text>
          {code ? (
            <Text selectable style={[styles.code, { color: c.foreground }]}>
              {code}
            </Text>
          ) : loading ? (
            <ActivityIndicator size="small" color={c.mutedForeground} style={{ alignSelf: "flex-start", marginTop: 4 }} />
          ) : (
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Unavailable Offline</Text>
          )}
        </View>
        <Button label="Share" icon="share-variant" onPress={share} disabled={!code} style={{ alignSelf: "stretch", justifyContent: "center" }} />
      </View>

      {count > 0 ? (
        <Text style={[styles.stat, { color: c.mutedForeground }]}>
          <Text style={{ color: c.primary, fontFamily: "Inter_800ExtraBold" }}>{count}</Text> joined with your code
          {paidOut > 0 ? ` · ${paidOut.toLocaleString()} credits earned` : ""}
          {count >= REFERRAL.maxRewarded ? " · credit bonus maxed" : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12, overflow: "hidden", marginBottom: 14 },
  head: { flexDirection: "row", gap: 12, alignItems: "center" },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17, marginTop: 2 },
  codeRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  codeBox: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  codeLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  code: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  stat: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

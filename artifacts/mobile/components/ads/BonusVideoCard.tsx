import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { AD_REWARD_DISPLAY } from "@/constants/ads";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAdRewardsToday } from "@/hooks/useAdRewardsToday";
import { useColors } from "@/hooks/useColors";
import sdk from "@/lib/ads/sdk";

/**
 * Opt-in rewarded video on the Prize Boxes screen: watch to the end for bonus
 * credits, a few times a day. The video's "earned" event only changes what this
 * card says — the credits are minted by the AdMob SSV callback on the server,
 * and the card confirms once that write shows up in Firestore.
 */
export default function BonusVideoCard() {
  const { enabled } = useAds();
  if (!sdk || !enabled) return null;
  return <BonusVideo />;
}

const CONFIRM_TIMEOUT_MS = 20_000;

function BonusVideo() {
  const c = useColors();
  const { profile } = useApp();
  const { rewardedStatus, loadRewarded, showRewarded } = useAds();
  const used = useAdRewardsToday(profile?.uid);
  const left = Math.max(0, AD_REWARD_DISPLAY.dailyLimit - (used ?? 0));

  const [crediting, setCrediting] = useState<number | null>(null); // count before the view
  const [note, setNote] = useState<{ text: string; tone: "ok" | "info" } | null>(null);

  // Warm one video while there's something left to earn.
  useEffect(() => {
    if (used !== null && left > 0 && rewardedStatus === "idle") loadRewarded();
  }, [used, left, rewardedStatus, loadRewarded]);

  // The server's counter moving is the confirmation.
  useEffect(() => {
    if (crediting === null || used === null || used <= crediting) return;
    setCrediting(null);
    setNote({ text: `+${AD_REWARD_DISPLAY.credits} credits added`, tone: "ok" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
    const outcome = await showRewarded();
    if (outcome === "earned") setCrediting(before);
    else if (outcome === "dismissed") setNote({ text: "Watch to the end to earn the bonus.", tone: "info" });
    else setNote({ text: "No video available right now. Try again in a bit.", tone: "info" });
  }, [used, showRewarded]);

  const done = left === 0 && crediting === null;
  const button = done
    ? { label: "Back tomorrow", disabled: true, loading: false, onPress: undefined }
    : crediting !== null
      ? { label: "Adding credits…", disabled: true, loading: true, onPress: undefined }
      : rewardedStatus === "ready"
        ? { label: `Watch · +${AD_REWARD_DISPLAY.credits}`, disabled: false, loading: false, onPress: watch }
        : rewardedStatus === "unavailable"
          ? { label: "Try again", disabled: false, loading: false, onPress: loadRewarded }
          : { label: "Loading video…", disabled: true, loading: rewardedStatus !== "showing", onPress: undefined };

  return (
    <Card tone="money" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.primarySoft }]}>
          <MaterialCommunityIcons name="play-circle-outline" size={22} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>Bonus credits</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {done
              ? "You've watched today's bonus videos."
              : `Watch a short video for +${AD_REWARD_DISPLAY.credits} credits · ${left} of ${AD_REWARD_DISPLAY.dailyLimit} left today`}
          </Text>
        </View>
      </View>
      <Button
        label={button.label}
        icon={done ? "check" : "play"}
        size="sm"
        variant={done ? "secondary" : "primary"}
        disabled={button.disabled}
        loading={button.loading}
        onPress={button.onPress}
      />
      {note ? (
        <Text style={[styles.note, { color: note.tone === "ok" ? c.positive : c.mutedForeground }]}>{note.text}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  note: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
});

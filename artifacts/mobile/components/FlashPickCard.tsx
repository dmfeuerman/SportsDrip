import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import PressableScale from "@/components/fx/PressableScale";
import {
  FLASH_MAX_STAKE,
  FLASH_MIN_STAKE,
  FLASH_PAID_ODDS,
  FLASH_REWARD,
  freeFlashLeftToday,
} from "@/components/LiveFlashCard";
import { Card, Pill } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFlashPicks } from "@/hooks/useFlashPicks";
import { makeFlashPick } from "@/lib/api";
import { haptic } from "@/lib/motion";
import type { Game } from "@/types/game";

const QUICK_STAKES = [100, 250, 500, 1000] as const;

/**
 * Flash pick: "who scores next?" while the game is live.
 * First 3 picks per day are free (+200 credits); after that, players can pick
 * with quick-action credit stakes at flat 1.91x.
 */
export default function FlashPickCard({ game }: { game: Game }) {
  const c = useColors();
  const { profile, balance } = useApp();
  const live = game.status === "live";
  const picks = useFlashPicks(profile?.uid, game.id, live || game.status === "final");
  // Shown the instant you tap; the server copy replaces it when it lands.
  const [armedSide, setArmedSide] = useState<"home" | "away" | null>(null);
  const [sending, setSending] = useState<"home" | "away" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stake, setStake] = useState<number>(250);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("250");
  const open = picks.find((p) => p.status === "pending");
  useEffect(() => {
    if (open) {
      setSending(null);
      setArmedSide(null);
    }
  }, [open]);

  const freeLeft = freeFlashLeftToday(profile?.flashToday);
  const isFree = freeLeft > 0;
  const activeStake = customMode ? Number.parseInt(customText, 10) || 0 : stake;
  const payout = isFree ? FLASH_REWARD : Math.round(activeStake * FLASH_PAID_ODDS);

  const last = picks.find((p) => p.status !== "pending");
  if (!live && picks.length === 0) return null;

  const armedTeam = armedSide === "home" ? game.homeTeam : armedSide === "away" ? game.awayTeam : null;

  const armPick = (side: "home" | "away") => {
    if (sending || open) return;
    haptic.tick();
    setErr(null);
    setArmedSide(side);
  };

  const confirmPick = () => {
    if (!armedSide || sending || open) return;
    if (!isFree) {
      if (activeStake < FLASH_MIN_STAKE || activeStake > FLASH_MAX_STAKE) {
        haptic.warning();
        setErr(`Choose a stake between ${FLASH_MIN_STAKE} and ${FLASH_MAX_STAKE.toLocaleString()} credits.`);
        return;
      }
      if (activeStake > balance) {
        haptic.warning();
        setErr(`Not enough credits (${balance.toLocaleString()} available).`);
        return;
      }
    }
    const side = armedSide;
    haptic.medium();
    setErr(null);
    setArmedSide(null);
    setSending(side);
    makeFlashPick({ gameId: game.id, side, stake: isFree ? undefined : activeStake }).catch((e: unknown) => {
      setSending(null);
      setErr(e instanceof Error ? e.message : "Couldn't place that pick.");
    });
  };

  const riding = open?.side ?? sending;
  const ridingAbbr = riding === "home" ? game.homeTeam.abbreviation : riding === "away" ? game.awayTeam.abbreviation : null;
  const ridingReward = open?.reward ?? payout;

  return (
    <Card style={[styles.card, { borderColor: c.alpha(c.live, 0.45) }]}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="flash" size={18} color={c.live} />
        <Text style={[styles.title, { color: c.foreground }]}>Flash Pick</Text>
        <Pill
          label={isFree ? `Free · ${freeLeft} left · +${FLASH_REWARD}` : `${FLASH_PAID_ODDS}x Live`}
          tone="money"
        />
      </View>

      {riding ? (
        <Text style={[styles.body, { color: c.foreground }]}>
          You called <Text style={{ color: c.primary, fontFamily: "Inter_800ExtraBold" }}>{ridingAbbr}</Text> to score next (win +{ridingReward.toLocaleString()}). Settles when the scoreboard moves.
        </Text>
      ) : live ? (
        <>
          {!isFree ? (
            <View style={{ gap: 8 }}>
              <View style={styles.chipRow}>
                {QUICK_STAKES.map((val) => {
                  const active = !customMode && stake === val;
                  return (
                    <PressableScale
                      key={val}
                      style={{ flex: 1 }}
                      scaleTo={0.94}
                      onPress={() => {
                        haptic.tick();
                        setErr(null);
                        setCustomMode(false);
                        setStake(val);
                      }}
                    >
                      <View
                        style={[
                          styles.stakeChip,
                          {
                            backgroundColor: active ? "rgba(245, 196, 81, 0.22)" : c.secondary,
                            borderColor: active ? "#F5C451" : c.alpha(c.foreground, 0.12),
                          },
                        ]}
                      >
                        <Text style={[styles.stakeChipText, { color: active ? "#FCE092" : c.foreground }]}>
                          {val >= 1000 ? `${val / 1000}K` : String(val)}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })}
                <PressableScale
                  style={{ flex: 1.15 }}
                  scaleTo={0.94}
                  onPress={() => {
                    haptic.tick();
                    setErr(null);
                    setCustomMode(true);
                    setCustomText(String(stake));
                  }}
                >
                  <View
                    style={[
                      styles.stakeChip,
                      {
                        backgroundColor: customMode ? "rgba(245, 196, 81, 0.22)" : c.secondary,
                        borderColor: customMode ? "#F5C451" : c.alpha(c.foreground, 0.12),
                      },
                    ]}
                  >
                    <Text style={[styles.stakeChipText, { color: customMode ? "#FCE092" : c.mutedForeground }]}>Custom</Text>
                  </View>
                </PressableScale>
              </View>
              {customMode ? (
                <View style={[styles.customInputRow, { borderColor: "#F5C451", backgroundColor: c.secondary }]}>
                  <MaterialCommunityIcons name="lightning-bolt" size={15} color="#F5C451" />
                  <TextInput
                    style={[styles.customInput, { color: c.foreground }]}
                    value={customText}
                    onChangeText={(t) => {
                      setErr(null);
                      setCustomText(t.replace(/[^0-9]/g, ""));
                    }}
                    keyboardType="number-pad"
                    placeholder="Enter credits"
                    placeholderTextColor={c.subtleForeground}
                  />
                  <Text style={[styles.customAvail, { color: c.mutedForeground }]}>Avail {balance.toLocaleString()}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {armedSide && armedTeam ? (
            <>
              <Text style={[styles.body, { color: c.mutedForeground }]}>
                {isFree ? "Confirm your free daily pick:" : `Confirm your ${activeStake.toLocaleString()}-credit pick:`}
              </Text>
              <View style={styles.row}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Cancel live pick"
                  onPress={() => {
                    haptic.tick();
                    setErr(null);
                    setArmedSide(null);
                  }}
                  scaleTo={0.95}
                  style={[styles.btn, { flex: 0.62, backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.16) }]}
                >
                  <Text style={[styles.btnText, { color: c.foreground }]} numberOfLines={1}>Cancel</Text>
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm ${armedTeam.name} scores next to win ${payout} credits`}
                  onPress={confirmPick}
                  scaleTo={0.95}
                  style={[styles.btn, { flex: 1.6, backgroundColor: c.positive, borderColor: c.positive }]}
                >
                  <MaterialCommunityIcons name="check" size={15} color="#061A0E" />
                  <Text style={[styles.btnText, { color: "#061A0E" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    Confirm {armedTeam.abbreviation} Next · +{payout.toLocaleString()}
                  </Text>
                </PressableScale>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.body, { color: c.mutedForeground }]}>Who scores next?</Text>
              <View style={styles.row}>
                {(["away", "home"] as const).map((side) => {
                  const t = side === "home" ? game.homeTeam : game.awayTeam;
                  return (
                    <PressableScale
                      key={side}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${t.name} to score next`}
                      onPress={() => armPick(side)}
                      scaleTo={0.95}
                      style={[styles.btn, { backgroundColor: c.secondary, borderColor: c.alpha(t.color, 0.55) }]}
                    >
                      <View style={[styles.dot, { backgroundColor: t.color }]} />
                      <Text style={[styles.btnText, { color: c.foreground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {t.abbreviation} Next · <Text style={{ color: "#FCE092" }}>+{payout.toLocaleString()}</Text>
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </>
          )}
        </>
      ) : (
        <Text style={[styles.body, { color: c.mutedForeground }]}>Flash picks closed at the final whistle.</Text>
      )}

      {last ? (
        <Text style={[styles.last, { color: last.status === "won" ? c.positive : last.status === "lost" ? c.negative : c.mutedForeground }]}>
          Last call, {last.teamAbbr}:{" "}
          {last.status === "won"
            ? `hit, +${last.reward.toLocaleString()}`
            : last.status === "lost"
              ? "missed"
              : last.stake
                ? `push, ${last.stake.toLocaleString()} refunded`
                : "no score, no harm"}
        </Text>
      ) : null}
      {err ? <Text style={[styles.last, { color: c.negative }]}>{err}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  left: { marginLeft: "auto", fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  body: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  chipRow: { flexDirection: "row", gap: 6 },
  stakeChip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, alignItems: "center", justifyContent: "center" },
  stakeChipText: { fontSize: 12, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  customInputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  customInput: { flex: 1, fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"], padding: 0 },
  customAvail: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, minWidth: 0 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  btnText: { flexShrink: 1, fontSize: 14, fontFamily: "Inter_900Black", letterSpacing: -0.2, fontVariant: ["tabular-nums"] },
  last: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

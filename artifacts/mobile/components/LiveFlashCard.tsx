import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing as REasing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import PressableScale from "@/components/fx/PressableScale";
import TeamCrest from "@/components/TeamCrest";
import { LiquidGlass } from "@/components/ui/LiquidGlass";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFlashPicks } from "@/hooks/useFlashPicks";
import { makeFlashPick } from "@/lib/api";
import { haptic } from "@/lib/motion";
import { nyDayOf } from "@/lib/streakGrid";
import type { Game } from "@/types/game";

/** Mirrors functions/src/lib/flash.ts. */
export const FLASH_FREE_PER_DAY = 3;
export const FLASH_REWARD = 200;
export const FLASH_PAID_ODDS = 1.91;
export const FLASH_MIN_STAKE = 10;
export const FLASH_MAX_STAKE = 5_000;

const QUICK_STAKES = [100, 250, 500, 1000] as const;

export function freeFlashLeftToday(flashToday?: { day?: string; count?: number; freeCount?: number } | null): number {
  const today = nyDayOf(Date.now());
  if (!flashToday || flashToday.day !== today) return FLASH_FREE_PER_DAY;
  const used = Math.max(0, flashToday.freeCount ?? Math.min(flashToday.count ?? 0, FLASH_FREE_PER_DAY));
  return Math.max(0, FLASH_FREE_PER_DAY - used);
}

/**
 * Option 1 Broadcast Scoreboard Live Betting Card for the Games -> Live tab.
 * Uses the app's existing TeamCrest, sport chip, and LiquidGlass primitives.
 *
 * State 1: First 3 live picks/day are free (0 stake, +200 credits).
 * State 2: After the 3 free daily picks are spent, quick-action stake chips
 * (100, 250, 500, 1K, Custom) appear above the team buttons at flat 1.91x.
 */
function LiveFlashCard({
  game,
  onOpenGame,
}: {
  game: Game;
  onOpenGame?: (game: Game) => void;
}) {
  const c = useColors();
  const { profile, balance } = useApp();
  const live = game.status === "live" && !game.disrupted;
  const picks = useFlashPicks(profile?.uid, game.id, live || game.status === "final");

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

  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 700, easing: REasing.inOut(REasing.quad) }),
        withTiming(1, { duration: 700, easing: REasing.inOut(REasing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const freeLeft = freeFlashLeftToday(profile?.flashToday);
  const isFree = freeLeft > 0;
  const last = picks.find((p) => p.status !== "pending");

  const activeStake = customMode ? Number.parseInt(customText, 10) || 0 : stake;
  const payout = isFree ? FLASH_REWARD : Math.round(activeStake * FLASH_PAID_ODDS);
  const sportColor = c.sport(game.sport);
  const clockDetail = [game.period, game.clock].filter(Boolean).join(" ") || game.situation || "IN PLAY";

  const riding = open?.side ?? sending;
  const ridingAbbr = riding === "home" ? game.homeTeam.abbreviation : riding === "away" ? game.awayTeam.abbreviation : null;
  const ridingReward = open?.reward ?? payout;

  const armedTeam = armedSide === "home" ? game.homeTeam : armedSide === "away" ? game.awayTeam : null;

  const armPick = (side: "home" | "away") => {
    if (!live || sending || open) return;
    haptic.tick();
    setErr(null);
    setArmedSide(side);
  };

  const confirmPick = () => {
    if (!armedSide || !live || sending || open) return;
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
      setErr(e instanceof Error ? e.message : "Couldn't place that live pick.");
    });
  };

  return (
    <View style={styles.wrap}>
      <LiquidGlass
        variant="card"
        radius={22}
        borderColor={c.alpha(c.live, 0.48)}
        borderWidth={1.25}
        contentStyle={styles.card}
      >
        {/* Dual team-color ambient glow */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={`lf_a_${game.id}`} cx="6%" cy="52%" rx="48%" ry="68%">
                <Stop offset="0" stopColor={game.awayTeam.color || c.primary} stopOpacity="0.22" />
                <Stop offset="1" stopColor={game.awayTeam.color || c.primary} stopOpacity="0" />
              </RadialGradient>
              <RadialGradient id={`lf_h_${game.id}`} cx="94%" cy="52%" rx="48%" ry="68%">
                <Stop offset="0" stopColor={game.homeTeam.color || c.accent} stopOpacity="0.22" />
                <Stop offset="1" stopColor={game.homeTeam.color || c.accent} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill={`url(#lf_a_${game.id})`} />
            <Rect x="0" y="0" width="100" height="100" fill={`url(#lf_h_${game.id})`} />
          </Svg>
        </View>

        {/* Top Bar: Existing Sport Chip | Live Clock Pill | Free / 1.91x Status Pill */}
        <View style={styles.topRow}>
          <View style={[styles.sportChip, { backgroundColor: c.alpha(sportColor, 0.16) }]}>
            <MaterialCommunityIcons name={game.sportIcon as never} size={12} color={sportColor} />
            <Text style={[styles.sportText, { color: sportColor }]}>{game.sport}</Text>
          </View>

          <View style={[styles.livePill, { backgroundColor: c.live }]}>
            <Reanimated.View style={[styles.liveDot, dotStyle]} />
            <Text style={styles.liveText} numberOfLines={1}>
              LIVE · {clockDetail}
            </Text>
          </View>

          <View
            style={[
              styles.tierPill,
              {
                backgroundColor: isFree ? "rgba(245, 196, 81, 0.18)" : "rgba(255, 255, 255, 0.10)",
                borderColor: isFree ? "rgba(245, 196, 81, 0.55)" : "rgba(245, 196, 81, 0.40)",
              },
            ]}
          >
            <Text style={styles.tierText}>
              {isFree ? `FREE · ${freeLeft} LEFT` : `${FLASH_PAID_ODDS}x LIVE`}
            </Text>
          </View>
        </View>

        {/* Broadcast Scoreboard Row — uses existing TeamCrest badges; tapping opens Game Center */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open live game center for ${game.awayTeam.name} at ${game.homeTeam.name}`}
          onPress={() => {
            haptic.tick();
            onOpenGame?.(game);
          }}
          style={styles.scoreboard}
        >
          <View style={styles.sideCol}>
            <View
              style={[
                styles.crestRing,
                armedSide === "away" && { borderColor: game.awayTeam.color || c.primary, backgroundColor: c.alpha(game.awayTeam.color || c.primary, 0.22) },
              ]}
            >
              <TeamCrest
                abbr={game.awayTeam.abbreviation}
                name={game.awayTeam.name}
                color={game.awayTeam.color}
                altColor={game.awayTeam.altColor}
                size={44}
                sport={game.sport}
              />
            </View>
            <Text style={[styles.scoreNum, { color: c.foreground }]}>
              {game.awayScore ?? 0}
            </Text>
          </View>

          <Text style={[styles.dash, { color: c.subtleForeground }]}>–</Text>

          <View style={styles.sideCol}>
            <Text style={[styles.scoreNum, { color: c.foreground }]}>
              {game.homeScore ?? 0}
            </Text>
            <View
              style={[
                styles.crestRing,
                armedSide === "home" && { borderColor: game.homeTeam.color || c.primary, backgroundColor: c.alpha(game.homeTeam.color || c.primary, 0.22) },
              ]}
            >
              <TeamCrest
                abbr={game.homeTeam.abbreviation}
                name={game.homeTeam.name}
                color={game.homeTeam.color}
                altColor={game.homeTeam.altColor}
                size={44}
                sport={game.sport}
              />
            </View>
          </View>
        </Pressable>

        {/* Quick-Action Stake Chips (State 2: shown after the 3 free daily picks are used) */}
        {!isFree && !riding && live ? (
          <View style={styles.stakeBlock}>
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Stake ${val} credits`}
                  >
                    <View
                      style={[
                        styles.stakeChip,
                        {
                          backgroundColor: active ? "rgba(245, 196, 81, 0.22)" : "rgba(255, 255, 255, 0.08)",
                          borderColor: active ? "#F5C451" : "rgba(255, 255, 255, 0.16)",
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
                accessibilityRole="button"
                accessibilityState={{ selected: customMode }}
                accessibilityLabel="Custom stake amount"
              >
                <View
                  style={[
                    styles.stakeChip,
                    {
                      backgroundColor: customMode ? "rgba(245, 196, 81, 0.22)" : "rgba(255, 255, 255, 0.08)",
                      borderColor: customMode ? "#F5C451" : "rgba(255, 255, 255, 0.16)",
                    },
                  ]}
                >
                  <Text style={[styles.stakeChipText, { color: customMode ? "#FCE092" : c.mutedForeground }]}>
                    Custom
                  </Text>
                </View>
              </PressableScale>
            </View>

            {customMode ? (
              <View style={[styles.customInputRow, { borderColor: "rgba(245, 196, 81, 0.55)", backgroundColor: "rgba(255,255,255,0.06)" }]}>
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
                  accessibilityLabel="Custom live stake in credits"
                />
                <Text style={[styles.customAvail, { color: c.mutedForeground }]}>
                  Avail {balance.toLocaleString()}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Action Section: Riding State or 1-Tap Team Next Buttons */}
        {riding ? (
          <View style={[styles.ridingBox, { backgroundColor: c.alpha(c.primary, 0.12), borderColor: c.alpha(c.primary, 0.42) }]}>
            <MaterialCommunityIcons name="flash" size={16} color={c.primary} />
            <Text style={[styles.ridingText, { color: c.foreground }]}>
              Riding <Text style={{ color: c.primary, fontFamily: "Inter_800ExtraBold" }}>{ridingAbbr}</Text> to score next · Win{" "}
              <Text style={{ color: "#FCE092", fontFamily: "Inter_800ExtraBold" }}>+{ridingReward.toLocaleString()}</Text>
            </Text>
            {onOpenGame ? (
              <Pressable onPress={() => onOpenGame(game)} hitSlop={8}>
                <MaterialCommunityIcons name="chevron-right" size={18} color={c.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        ) : live && armedSide && armedTeam ? (
          <View style={styles.pickBlock}>
            <Text style={[styles.promptLabel, { color: c.mutedForeground }]}>
              {isFree ? "CONFIRM YOUR FREE DAILY PICK" : `CONFIRM YOUR ${activeStake.toLocaleString()}-CREDIT PICK`}
            </Text>
            <View style={styles.btnRow}>
              <PressableScale
                style={{ flex: 0.62 }}
                scaleTo={0.96}
                onPress={() => {
                  haptic.tick();
                  setErr(null);
                  setArmedSide(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel live pick"
              >
                <View style={[styles.cancelBtn, { borderColor: "rgba(255, 255, 255, 0.18)", backgroundColor: "rgba(255, 255, 255, 0.08)" }]}>
                  <Text style={[styles.cancelBtnText, { color: c.foreground }]} numberOfLines={1}>Cancel</Text>
                </View>
              </PressableScale>
              <PressableScale
                style={{ flex: 1.6 }}
                scaleTo={0.96}
                onPress={confirmPick}
                accessibilityRole="button"
                accessibilityLabel={`Confirm ${armedTeam.name} scores next to win ${payout} credits`}
              >
                <View style={[styles.confirmBtn, { backgroundColor: c.positive }]}>
                  <MaterialCommunityIcons name="check" size={15} color="#061A0E" />
                  <Text style={styles.confirmBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    Confirm {armedTeam.abbreviation} Next · +{payout.toLocaleString()}
                  </Text>
                </View>
              </PressableScale>
            </View>
          </View>
        ) : live ? (
          <View style={styles.pickBlock}>
            <Text style={[styles.promptLabel, { color: c.mutedForeground }]}>WHO SCORES NEXT?</Text>
            <View style={styles.btnRow}>
              {(["away", "home"] as const).map((side) => {
                const t = side === "home" ? game.homeTeam : game.awayTeam;
                return (
                  <PressableScale
                    key={side}
                    style={{ flex: 1 }}
                    scaleTo={0.96}
                    onPress={() => armPick(side)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${t.name} to score next`}
                  >
                    <View
                      style={[
                        styles.pickBtn,
                        {
                          backgroundColor: c.alpha(t.color, 0.16),
                          borderColor: c.alpha(t.color, 0.72),
                        },
                      ]}
                    >
                      <Text style={[styles.pickBtnText, { color: c.foreground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {t.abbreviation} Next · <Text style={{ color: "#FCE092" }}>+{payout.toLocaleString()}</Text>
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={[styles.doneText, { color: c.mutedForeground }]}>
            Live picks closed at the final whistle.
          </Text>
        )}

        {last ? (
          <Text
            style={[
              styles.feedback,
              {
                color:
                  last.status === "won"
                    ? c.positive
                    : last.status === "lost"
                      ? c.negative
                      : c.mutedForeground,
              },
            ]}
          >
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
        {err ? <Text style={[styles.feedback, { color: c.negative }]}>{err}</Text> : null}
      </LiquidGlass>
    </View>
  );
}

export default memo(LiveFlashCard);

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  card: { padding: 14, gap: 12 },

  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  sportText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },

  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    flexShrink: 1,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  liveText: { color: "#FFFFFF", fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 0.5 },

  tierPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tierText: { color: "#FCE092", fontSize: 10.5, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },

  scoreboard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 4,
  },
  sideCol: { flexDirection: "row", alignItems: "center", gap: 12 },
  crestRing: { borderRadius: 26, padding: 2.5, borderWidth: 2, borderColor: "transparent" },
  scoreNum: { fontSize: 34, lineHeight: 38, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.8 },
  dash: { fontSize: 22, fontFamily: "Inter_700Bold" },

  stakeBlock: { gap: 8 },
  chipRow: { flexDirection: "row", gap: 6 },
  stakeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  stakeChipText: { fontSize: 12, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  customInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    fontVariant: ["tabular-nums"],
    padding: 0,
  },
  customAvail: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },

  pickBlock: { gap: 7 },
  promptLabel: { fontSize: 10.5, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, textAlign: "center" },
  btnRow: { flexDirection: "row", gap: 8 },
  pickBtn: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pickBtnText: { flexShrink: 1, fontSize: 13.5, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: { fontSize: 13.5, fontFamily: "Inter_700Bold" },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minWidth: 0,
  },
  confirmBtnText: { flexShrink: 1, color: "#061A0E", fontSize: 13.5, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },

  ridingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  ridingText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  doneText: { fontSize: 12.5, fontFamily: "Inter_500Medium", textAlign: "center" },
  feedback: { fontSize: 11.5, fontFamily: "Inter_600SemiBold", textAlign: "center" },
});

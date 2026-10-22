import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import type { BoxTier } from "@/lib/api";
import { BOX_DISPLAY } from "@/constants/prizeTypes";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  tier: BoxTier;
  /**
   * The reward the SERVER decided, in credits. Null while the claim callable is
   * still in flight.
   *
   * This is the whole point of the rewrite. The old component ran
   * `pickWinner()` locally with `Math.random()` and handed the amount to
   * `claimPrizeSpin(boxId, tokensWon)` — a patched bundle could pay itself any
   * number it liked (AUDIT S3). The wheel is now pure theatre: it spins to
   * whatever the server already committed to the ledger.
   */
  rewardCredits: number | null;
  error: string | null;
  onClose: () => void;
}

const SIZE = 280;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = SIZE / 2 - 10;

function arcPath(index: number, slice: number): string {
  const start = ((index * slice - 90) * Math.PI) / 180;
  const end = (((index + 1) * slice - 90) * Math.PI) / 180;
  const x1 = CX + R * Math.cos(start);
  const y1 = CY + R * Math.sin(start);
  const x2 = CX + R * Math.cos(end);
  const y2 = CY + R * Math.sin(end);
  const large = slice > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

function textPos(index: number, slice: number) {
  const midDeg = index * slice + slice / 2 - 90;
  const midRad = (midDeg * Math.PI) / 180;
  return {
    x: CX + R * 0.66 * Math.cos(midRad),
    y: CY + R * 0.66 * Math.sin(midRad),
    rotation: midDeg + 90,
  };
}

export default function SpinWheel({ visible, tier, rewardCredits, error, onClose }: Props) {
  const colors = useColors();
  const display = BOX_DISPLAY[tier];
  const slice = 360 / display.segments.length;

  const [phase, setPhase] = useState<"idle" | "spinning" | "result">("idle");
  const spin = useRef(new Animated.Value(0)).current;
  const total = useRef(0);

  const rotate = spin.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
    extrapolate: "extend",
  });

  const start = useCallback(() => {
    if (rewardCredits === null || phase !== "idle") return;

    // Land on a wedge showing the amount the server awarded. If the display
    // table and the server table ever drift, the wheel still stops somewhere
    // sensible and the result card shows the authoritative number.
    const candidates = display.segments
      .map((seg, i) => (seg.credits === rewardCredits ? i : -1))
      .filter((i) => i >= 0);
    const winner = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]!
      : 0;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase("spinning");

    const extra = 6 * 360;
    const land = (360 - (winner * slice + slice / 2) + 360) % 360;
    total.current += extra + land;

    Animated.timing(spin, {
      toValue: total.current,
      duration: 4200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase("result");
    });
  }, [rewardCredits, phase, display.segments, slice, spin]);

  // Auto-spin as soon as the server result lands, so the user taps once
  // ("Spin") rather than twice.
  useEffect(() => {
    if (visible && rewardCredits !== null && phase === "idle") start();
  }, [visible, rewardCredits, phase, start]);

  useEffect(() => {
    if (!visible) {
      setPhase("idle");
      spin.setValue(total.current);
    }
  }, [visible, spin]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: display.color }]}>
            {tier[0]!.toUpperCase() + tier.slice(1)} Box
          </Text>

          {error ? (
            <View style={styles.errorWrap}>
              <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : (
            <>
              <View style={styles.wheelWrap}>
                <Animated.View style={{ transform: [{ rotate }] }}>
                  <Svg width={SIZE} height={SIZE}>
                    <G>
                      {display.segments.map((seg, i) => {
                        const p = textPos(i, slice);
                        return (
                          <G key={i}>
                            <Path d={arcPath(i, slice)} fill={seg.color} stroke="#00000022" strokeWidth={1} />
                            <SvgText
                              x={p.x}
                              y={p.y}
                              fill="#FFFFFF"
                              fontSize={14}
                              fontWeight="bold"
                              textAnchor="middle"
                              transform={`rotate(${p.rotation}, ${p.x}, ${p.y})`}
                            >
                              {seg.credits}
                            </SvgText>
                          </G>
                        );
                      })}
                      <Circle cx={CX} cy={CY} r={26} fill={colors.card} stroke={display.color} strokeWidth={3} />
                    </G>
                  </Svg>
                </Animated.View>
                <View style={[styles.pointer, { borderTopColor: display.color }]} />
              </View>

              {phase === "result" && rewardCredits !== null ? (
                <View style={styles.resultWrap}>
                  <Text style={[styles.resultLabel, { color: colors.mutedForeground }]}>You won</Text>
                  <View style={styles.resultRow}>
                    <MaterialCommunityIcons name="lightning-bolt" size={26} color={colors.primary} />
                    <Text style={[styles.resultValue, { color: colors.primary }]}>
                      {rewardCredits.toLocaleString()}
                    </Text>
                  </View>
                  <Text style={[styles.resultNote, { color: colors.mutedForeground }]}>
                    Already added to your balance.
                  </Text>
                </View>
              ) : (
                <Text style={[styles.spinning, { color: colors.mutedForeground }]}>
                  {rewardCredits === null ? "Opening…" : "Spinning…"}
                </Text>
              )}
            </>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.closeBtn,
              {
                backgroundColor: phase === "result" || error ? colors.primary : colors.secondary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            onPress={onClose}
            disabled={phase === "spinning"}
          >
            <Text
              style={[
                styles.closeText,
                {
                  color:
                    phase === "result" || error ? colors.primaryForeground : colors.mutedForeground,
                },
              ]}
            >
              {phase === "result" ? "Nice" : error ? "Close" : "…"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: { borderRadius: 24, borderWidth: 1, padding: 24, alignItems: "center", gap: 16, width: "100%" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  wheelWrap: { alignItems: "center", justifyContent: "center" },
  pointer: {
    position: "absolute",
    top: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 20,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  spinning: { fontSize: 14, fontFamily: "Inter_500Medium" },
  resultWrap: { alignItems: "center", gap: 4 },
  resultLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  resultValue: { fontSize: 36, fontFamily: "Inter_700Bold" },
  resultNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  errorWrap: { alignItems: "center", gap: 10, paddingVertical: 32 },
  errorText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  closeBtn: { width: "100%", paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  closeText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});

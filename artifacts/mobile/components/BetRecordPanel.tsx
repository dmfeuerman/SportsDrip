import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Amount, Card } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export type RecordBet = { status: string; stake: number; potentialPayout: number; t: number };

/** Credits won or lost on one bet. A push returns the stake, so it counts as 0. */
export function betNet(b: Pick<RecordBet, "status" | "stake" | "potentialPayout">) {
  return b.status === "won" ? b.potentialPayout - b.stake : b.status === "lost" ? -b.stake : 0;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 120;
const STROKE = 11;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const HALF = 44;
const CHART_BARS = 20;
const EASE = { duration: 900, easing: Easing.out(Easing.cubic) };

/** Counts from its last value up to `target`. */
function useCountUp(target: number, reduced: boolean | undefined) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (reduced) {
      setV(target);
      return;
    }
    const start = Date.now();
    const from = v;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / EASE.duration);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = from + (target - from) * e;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `v` is read once per target change on purpose: each change animates from where the number is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced]);
  return v;
}

function NetBar({ net, max, index, reduced }: { net: number; max: number; index: number; reduced: boolean | undefined }) {
  const c = useColors();
  const h = useSharedValue(0);
  const target = net === 0 ? 3 : Math.max(5, (Math.abs(net) / max) * HALF);
  const color = net > 0 ? c.positive : net < 0 ? c.negative : c.push;
  useEffect(() => {
    h.value = reduced ? target : withDelay(index * 35, withTiming(target, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [target, index, reduced, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <View style={styles.barCol}>
      <View style={styles.barHalf}>
        {net >= 0 ? <Animated.View style={[styles.bar, { backgroundColor: color, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }, style]} /> : null}
      </View>
      <View style={[styles.barHalf, { justifyContent: "flex-start" }]}>
        {net < 0 ? <Animated.View style={[styles.bar, { backgroundColor: color, borderTopLeftRadius: 0, borderTopRightRadius: 0 }, style]} /> : null}
      </View>
    </View>
  );
}

/**
 * Hit rate ring, W/L/P split, streak and net-per-bet bars. Everything animates in on mount
 * and again when the record changes.
 */
export default function BetRecordPanel({ bets }: { bets: RecordBet[] }) {
  const c = useColors();
  const reduced = useReducedMotion();

  const settled = bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "push").sort((a, b) => a.t - b.t);
  const won = settled.filter((b) => b.status === "won").length;
  const lost = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.length - won - lost;
  const decided = won + lost;
  const rate = decided ? Math.round((won / decided) * 100) : null;
  const net = settled.reduce((s, b) => s + betNet(b), 0);

  let streak = 0;
  let streakWin = true;
  for (let i = settled.length - 1; i >= 0; i--) {
    const s = settled[i]!.status;
    if (s === "push") continue;
    if (streak === 0) streakWin = s === "won";
    if ((s === "won") !== streakWin) break;
    streak++;
  }

  const shownRate = useCountUp(rate ?? 0, reduced);
  const ring = useSharedValue(0);
  const wFrac = useSharedValue(0);
  const lFrac = useSharedValue(0);
  const pFrac = useSharedValue(0);
  const total = settled.length || 1;

  useEffect(() => {
    const set = (sv: { value: number }, to: number) => {
      sv.value = reduced ? to : withTiming(to, EASE);
    };
    set(ring, (rate ?? 0) / 100);
    set(wFrac, won / total);
    set(lFrac, lost / total);
    set(pFrac, pushes / total);
  }, [rate, won, lost, pushes, total, reduced, ring, wFrac, lFrac, pFrac]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRC * (1 - ring.value) }));
  const wStyle = useAnimatedStyle(() => ({ flexGrow: wFrac.value }));
  const lStyle = useAnimatedStyle(() => ({ flexGrow: lFrac.value }));
  const pStyle = useAnimatedStyle(() => ({ flexGrow: pFrac.value }));

  if (!settled.length) {
    return (
      <Card style={styles.card}>
        <View style={styles.emptyRow}>
          <MaterialCommunityIcons name="chart-donut" size={28} color={c.mutedForeground} />
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Settle a bet to start your record.</Text>
        </View>
      </Card>
    );
  }

  const ringColor = rate === null ? c.mutedForeground : rate >= 50 ? c.positive : c.negative;
  const recent = settled.slice(-CHART_BARS);
  const maxAbs = Math.max(1, ...recent.map((b) => Math.abs(betNet(b))));
  const offset = settled.length - recent.length;

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={styles.ringWrap}>
          <Svg width={RING} height={RING} style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={c.border} strokeWidth={STROKE} fill="none" />
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              stroke={ringColor}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${CIRC} ${CIRC}`}
              animatedProps={ringProps}
            />
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={[styles.ringValue, { color: c.foreground }]}>{rate === null ? "—" : `${Math.round(shownRate)}%`}</Text>
            <Text style={[styles.label, { color: c.subtleForeground }]}>HIT RATE</Text>
          </View>
        </View>

        <View style={styles.side}>
          <Text style={[styles.label, { color: c.subtleForeground }]}>RECORD</Text>
          <Text style={[styles.record, { color: c.foreground }]}>
            {won}–{lost}
            {pushes ? <Text style={{ color: c.push }}>{`  ·  ${pushes} push`}</Text> : null}
          </Text>

          <View style={[styles.stack, { backgroundColor: c.secondary }]}>
            <Animated.View style={[styles.seg, { backgroundColor: c.positive }, wStyle]} />
            <Animated.View style={[styles.seg, { backgroundColor: c.negative }, lStyle]} />
            <Animated.View style={[styles.seg, { backgroundColor: c.push }, pStyle]} />
          </View>
          <View style={styles.legend}>
            <Text style={[styles.legendText, { color: c.positive }]}>{won} won</Text>
            <Text style={[styles.legendText, { color: c.negative }]}>{lost} lost</Text>
            {pushes ? <Text style={[styles.legendText, { color: c.push }]}>{pushes} push</Text> : null}
          </View>

          {streak > 0 ? (
            <View style={[styles.streak, { backgroundColor: c.alpha(streakWin ? c.positive : c.negative, 0.14) }]}>
              <MaterialCommunityIcons name={streakWin ? "fire" : "snowflake"} size={14} color={streakWin ? c.positive : c.negative} />
              <Text style={[styles.streakText, { color: streakWin ? c.positive : c.negative }]}>
                {streak} {streakWin ? "win" : "loss"} streak
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.chartHead}>
        <Text style={[styles.label, { color: c.subtleForeground }]}>NET PER BET · LAST {recent.length}</Text>
        <Amount value={net} signed size="sm" tone={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"} />
      </View>
      <View style={styles.chart}>
        {recent.map((b, i) => (
          <NetBar key={`${offset + i}`} net={betNet(b)} max={maxAbs} index={i} reduced={reduced} />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14, padding: 16 },
  top: { flexDirection: "row", alignItems: "center", gap: 16 },
  ringWrap: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  ringValue: { fontSize: 26, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  side: { flex: 1, gap: 6 },
  label: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  record: { fontSize: 22, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"], letterSpacing: -0.4 },
  stack: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 4 },
  seg: { flexBasis: 0, minWidth: 0 },
  legend: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  legendText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  streak: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginTop: 2 },
  streakText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  chartHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chart: { flexDirection: "row", alignItems: "center", gap: 3, height: HALF * 2 },
  barCol: { flex: 1, height: HALF * 2 },
  barHalf: { height: HALF, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
});

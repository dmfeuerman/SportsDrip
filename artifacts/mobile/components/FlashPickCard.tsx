import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import PressableScale from "@/components/fx/PressableScale";
import { Card, Pill } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFlashPicks } from "@/hooks/useFlashPicks";
import { makeFlashPick } from "@/lib/api";
import { haptic } from "@/lib/motion";
import type { Game } from "@/types/game";

/** Mirrors functions/src/lib/flash.ts. */
const FLASH_REWARD = 20;
const FLASH_PER_GAME = 3;

/**
 * Flash pick: a free "who scores next?" call while the game is live. One open
 * at a time, three a game, graded by the server when the scoreboard moves.
 */
export default function FlashPickCard({ game }: { game: Game }) {
  const c = useColors();
  const { profile } = useApp();
  const live = game.status === "live";
  const picks = useFlashPicks(profile?.uid, game.id, live || game.status === "final");
  // Shown the instant you tap; the server copy replaces it when it lands.
  const [sending, setSending] = useState<"home" | "away" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = picks.find((p) => p.status === "pending");
  useEffect(() => {
    if (open) setSending(null);
  }, [open]);

  const used = picks.length + (sending && !open ? 1 : 0);
  const left = Math.max(0, FLASH_PER_GAME - used);
  const last = picks.find((p) => p.status !== "pending");
  if (!live && picks.length === 0) return null;

  const pick = (side: "home" | "away") => {
    if (sending || open || left <= 0) return;
    haptic.medium();
    setErr(null);
    setSending(side);
    makeFlashPick({ gameId: game.id, side }).catch((e: unknown) => {
      setSending(null);
      setErr(e instanceof Error ? e.message : "Couldn't place that pick.");
    });
  };

  const riding = open?.side ?? sending;
  const ridingAbbr = riding === "home" ? game.homeTeam.abbreviation : riding === "away" ? game.awayTeam.abbreviation : null;

  return (
    <Card style={[styles.card, { borderColor: c.alpha(c.live, 0.45) }]}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="flash" size={18} color={c.live} />
        <Text style={[styles.title, { color: c.foreground }]}>Flash Pick</Text>
        <Pill label={`Free · win ${FLASH_REWARD}`} tone="money" />
        <Text style={[styles.left, { color: c.subtleForeground }]}>{left} left</Text>
      </View>

      {riding ? (
        <Text style={[styles.body, { color: c.foreground }]}>
          You called <Text style={{ color: c.primary, fontFamily: "Inter_800ExtraBold" }}>{ridingAbbr}</Text> to score next. Settles when the scoreboard moves.
        </Text>
      ) : live && left > 0 ? (
        <>
          <Text style={[styles.body, { color: c.mutedForeground }]}>Who scores next?</Text>
          <View style={styles.row}>
            {(["away", "home"] as const).map((side) => {
              const t = side === "home" ? game.homeTeam : game.awayTeam;
              return (
                <PressableScale
                  key={side}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name} scores next`}
                  onPress={() => pick(side)}
                  scaleTo={0.95}
                  style={[styles.btn, { backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.1) }]}
                >
                  <View style={[styles.dot, { backgroundColor: t.color }]} />
                  <Text style={[styles.btnText, { color: c.primary }]}>{t.abbreviation}</Text>
                </PressableScale>
              );
            })}
          </View>
        </>
      ) : (
        <Text style={[styles.body, { color: c.mutedForeground }]}>{live ? "That's all your flash picks for this game." : "Flash picks closed at the final whistle."}</Text>
      )}

      {last ? (
        <Text style={[styles.last, { color: last.status === "won" ? c.positive : last.status === "lost" ? c.negative : c.mutedForeground }]}>
          Last call, {last.teamAbbr}: {last.status === "won" ? `hit, +${last.reward}` : last.status === "lost" ? "missed" : "no score, no harm"}
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
  row: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  btnText: { fontSize: 16, fontFamily: "Inter_900Black", letterSpacing: -0.2 },
  last: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

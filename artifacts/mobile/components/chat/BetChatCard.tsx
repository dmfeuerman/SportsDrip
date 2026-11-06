import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FollowIntent } from "@/components/GameQuickView";
import { ActionChip, Pill } from "@/components/ui";
import theme from "@/constants/theme";
import type { LeagueMessage } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { trackEvent } from "@/lib/analytics";
import { haptic } from "@/lib/motion";
import { formatOdds } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";

function kickoffLabel(at: number, now: number): string {
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/**
 * League chat card for a server-posted bet. Shows pick, odds and kickoff —
 * never stake (social guardrail). Hidden picks never carry a side, so they
 * render as locked with no Tail.
 */
export default function BetChatCard({
  message: m,
  uid,
  leagueId,
  now,
  onTail,
}: {
  message: LeagueMessage;
  uid: string | null;
  leagueId: string;
  now: number;
  onTail: (gameId: string, intent: FollowIntent) => void;
}) {
  const c = useColors();
  const fmt = useOddsFormat();
  const upcoming = typeof m.startsAt === "number" && m.startsAt > now;

  if (m.hidden) {
    return (
      <View style={[styles.card, { borderColor: c.border, backgroundColor: c.secondary }]}>
        <Pill label={upcoming ? "Locked until kickoff" : "Hidden pick"} icon="lock" tone="neutral" />
        {m.startsAt ? (
          <Text style={[styles.meta, { color: c.mutedForeground }]}>Kickoff {kickoffLabel(m.startsAt, now)}</Text>
        ) : null}
      </View>
    );
  }

  const pick = m.market === "ml" || !m.label ? m.teamAbbr : m.label;
  const canTail = upcoming && !!m.gameId && !!m.betId && !!m.side && m.uid !== uid;

  return (
    <View style={[styles.card, { borderColor: c.border, backgroundColor: c.secondary }]}>
      <View style={styles.row}>
        <Text style={[styles.pick, { color: c.foreground }]} numberOfLines={1}>
          {pick} <Text style={{ color: c.mutedForeground }}>vs {m.opponentAbbr}</Text>
        </Text>
        {m.odds ? <Pill label={formatOdds(m.odds, fmt)} tone="league" /> : null}
      </View>
      {m.startsAt ? (
        <Text style={[styles.meta, { color: c.mutedForeground }]}>
          {upcoming ? `Kickoff ${kickoffLabel(m.startsAt, now)}` : "Game started"}
        </Text>
      ) : null}
      {canTail ? (
        <ActionChip
          label="Tail"
          icon="account-multiple-plus"
          tone="league"
          accessibilityLabel={`Tail ${m.name} on ${pick}`}
          onPress={() => {
            haptic.tick();
            trackEvent("tail_from_chat", { league_id: leagueId, source_bet_id: m.betId });
            onTail(m.gameId!, {
              betId: m.betId!,
              kind: "tail",
              leagueId,
              name: m.name,
              side: m.side!,
              market: m.market,
              selection: m.selection,
              stake: 0,
              sourceTeamAbbr: m.teamAbbr ?? pick ?? "",
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pick: { ...theme.type.bodyStrong, flexShrink: 1 },
  meta: theme.type.micro,
});

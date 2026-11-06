import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FollowIntent } from "@/components/GameQuickView";
import KeyboardSheet from "@/components/KeyboardSheet";
import { ActionChip, Pill } from "@/components/ui";
import theme from "@/constants/theme";
import type { BoardLeagueSide } from "@/context/LeagueContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import type { Game } from "@/types/game";

/**
 * "League is on this" → who's on which side. Names and sides only, never stake;
 * hidden picks (side === null) stay hidden. Tail / Fade hand off to the slip with
 * that member's league wallet preselected.
 */
export default function TailSheet({
  game,
  members,
  onClose,
  onFollow,
}: {
  game: Game | null;
  members: BoardLeagueSide[];
  onClose: () => void;
  onFollow: (gameId: string, intent: FollowIntent) => void;
}) {
  const c = useColors();
  const { leagues } = useLeague();
  const open = !!game && game.status === "upcoming" && !game.disrupted;

  const follow = (m: BoardLeagueSide, kind: "tail" | "fade") => {
    if (!game || !m.side) return;
    haptic.tick();
    const theirs = m.side === "home" ? game.homeTeam : game.awayTeam;
    onFollow(game.id, {
      betId: m.betId,
      kind,
      leagueId: m.leagueId,
      name: m.displayName,
      side: kind === "tail" ? m.side : m.side === "home" ? "away" : "home",
      stake: 0,
      sourceTeamAbbr: theirs.abbreviation,
    });
  };

  return (
    <KeyboardSheet visible={!!game} onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
        League is on this
      </Text>
      {game ? (
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </Text>
      ) : null}
      {members.map((m) => {
        const team = !game || !m.side ? null : m.side === "home" ? game.homeTeam : game.awayTeam;
        const league = leagues.find((l) => l.id === m.leagueId);
        return (
          <View key={`${m.leagueId}_${m.uid}`} style={[styles.row, { borderColor: c.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
                {m.displayName}
              </Text>
              {league ? (
                <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
                  {league.name}
                </Text>
              ) : null}
            </View>
            {team ? <Pill label={team.abbreviation} tone="league" /> : <Pill label="hidden" icon="lock" />}
            {open && m.side ? (
              <View style={styles.actions}>
                <ActionChip
                  label="Tail"
                  chevron={false}
                  tone="league"
                  accessibilityLabel={`Tail ${m.displayName}`}
                  onPress={() => follow(m, "tail")}
                />
                <ActionChip
                  label="Fade"
                  chevron={false}
                  tone="neutral"
                  accessibilityLabel={`Fade ${m.displayName}`}
                  onPress={() => follow(m, "fade")}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  title: theme.type.heading,
  sub: theme.type.caption,
  name: theme.type.bodyStrong,
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", gap: 6 },
});

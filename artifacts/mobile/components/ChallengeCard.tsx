import { MaterialCommunityIcons } from "@expo/vector-icons";
import TeamCrest from "@/components/TeamCrest";
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import PressableScale from "@/components/fx/PressableScale";
import { LiveDot } from "@/components/insights";
import { Button, Pill, type Tone } from "@/components/ui";
import type { ChallengeView } from "@/context/ChallengeContext";
import { useColors, type Colors } from "@/hooks/useColors";
import type { ChallengeTeam } from "@/lib/api";
import { kickoffLabel, livePosition, untilKickoff } from "@/lib/odds";
import type { Game } from "@/types/game";

/**
 * One head-to-head, from the signed-in player's side: you and your team on
 * the left, your friend and theirs on the right, the pot in the middle, and
 * whatever needs doing (accept, decline, withdraw) underneath.
 */
function ChallengeCard({
  view,
  game,
  now,
  busy,
  onOpen,
  onAccept,
  onDecline,
  onCancel,
}: {
  view: ChallengeView;
  /** The live board's copy of the game, for the score while it's on. */
  game: Game | null;
  now: number;
  busy?: "accept" | "decline" | "cancel" | null;
  onOpen?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
}) {
  const c = useColors();
  const { ch } = view;
  const kicked = ch.startsAt <= now || (!!game && game.status !== "upcoming");
  const live = ch.status === "accepted" && game?.status === "live";
  const pos = live && game ? livePosition(game, view.mySide) : null;
  const status = statusOf(view, kicked, pos, c);

  const myScore = scoreFor(view.mySide, ch.finalHomeScore, ch.finalAwayScore, game);
  const theirScore = scoreFor(view.mySide === "home" ? "away" : "home", ch.finalHomeScore, ch.finalAwayScore, game);
  const showScore = myScore !== null && theirScore !== null && (ch.status === "settled" || live);

  const border = status.tone === "positive" ? c.alpha(c.positive, 0.5) : status.tone === "negative" ? c.alpha(c.negative, 0.45) : ch.status === "pending" && !view.isCreator ? c.alpha(c.accent, 0.6) : c.border;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${view.myTeam.abbreviation} against ${view.friendName} on ${view.theirTeam.abbreviation}, ${status.label}. Pot ${ch.pot}.`}
      onPress={onOpen}
      scaleTo={0.985}
      dimTo={0.95}
      style={[styles.card, { backgroundColor: c.card, borderColor: border }]}
    >
      <View style={styles.head}>
        <Text style={[styles.kicker, { color: c.subtleForeground }]} numberOfLines={1}>
          {[ch.sport, `${ch.away.abbreviation} @ ${ch.home.abbreviation}`, ch.status === "settled" ? "Final" : kicked ? null : kickoffLabel(ch.startsAt, now)].filter(Boolean).join(" · ")}
        </Text>
        <View style={styles.pills}>
          <Pill label={ch.mode === "pot" ? "POT" : `${view.myOdds.toFixed(2)}X`} tone="accent" icon={ch.mode === "pot" ? "treasure-chest" : "scale-balance"} />
          <Pill label={status.label} tone={status.tone} icon={status.icon} />
        </View>
      </View>

      <View style={styles.versus}>
        <Fighter sport={ch.sport} who="You" team={view.myTeam} stake={view.myStake} score={showScore ? myScore : null} align="left" c={c} />
        <View style={[styles.pot, { borderColor: c.alpha(c.accent, 0.45), backgroundColor: c.alpha(c.accent, 0.08) }]}>
          {live ? <LiveDot size={6} /> : <MaterialCommunityIcons name="sword-cross" size={14} color={c.accent} />}
          <Text style={[styles.potValue, { color: c.foreground }]}>{ch.pot.toLocaleString()}</Text>
          <Text style={[styles.potLabel, { color: c.mutedForeground }]}>POT</Text>
        </View>
        <Fighter sport={ch.sport} who={view.friendName} team={view.theirTeam} stake={view.theirStake} score={showScore ? theirScore : null} align="right" c={c} />
      </View>

      {ch.message ? (
        <Text style={[styles.message, { color: c.cardForeground, backgroundColor: c.secondary }]} numberOfLines={2}>
          “{ch.message}”
        </Text>
      ) : null}

      <Text style={[styles.detail, { color: status.detailColor ?? c.mutedForeground }]}>{status.detail}</Text>

      {ch.status === "pending" && !view.isCreator && !kicked ? (
        <View style={styles.actions}>
          <Button label="Decline" variant="secondary" onPress={onDecline} loading={busy === "decline"} disabled={!!busy} style={{ flex: 1 }} />
          <Button
            label={`Accept · ${view.myStake.toLocaleString()}`}
            icon="sword-cross"
            onPress={onAccept}
            loading={busy === "accept"}
            disabled={!!busy}
            shimmer={!busy}
            style={{ flex: 1.6 }}
          />
        </View>
      ) : null}
      {ch.status === "pending" && view.isCreator && !kicked ? (
        <View style={styles.actions}>
          <Button label="Withdraw Challenge" variant="ghost" size="sm" onPress={onCancel} loading={busy === "cancel"} disabled={!!busy} />
        </View>
      ) : null}
    </PressableScale>
  );
}

function Fighter({
  sport,
  who,
  team,
  stake,
  score,
  align,
  c,
}: {
  sport: string | null;
  who: string;
  team: ChallengeTeam;
  stake: number;
  score: number | null;
  align: "left" | "right";
  c: Colors;
}) {
  const right = align === "right";
  return (
    <View style={[styles.fighter, right && { alignItems: "flex-end" }]}>
      <Text style={[styles.who, { color: c.mutedForeground }]} numberOfLines={1}>
        {who.toUpperCase()}
      </Text>
      <View style={[styles.teamRow, right && { flexDirection: "row-reverse" }]}>
        <TeamCrest abbr={team.abbreviation} color={team.color} size={40} sport={sport} />
        {score !== null ? <Text style={[styles.score, { color: c.foreground }]}>{score}</Text> : null}
      </View>
      <Text style={[styles.stake, { color: c.cardForeground }]}>{stake.toLocaleString()} in</Text>
    </View>
  );
}

function scoreFor(side: "home" | "away", home: number | null, away: number | null, game: Game | null): number | null {
  if (home !== null && away !== null) return side === "home" ? home : away;
  if (!game) return null;
  return side === "home" ? game.homeScore : game.awayScore;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function statusOf(
  v: ChallengeView,
  kicked: boolean,
  pos: "ahead" | "behind" | "level" | null,
  c: Colors
): { label: string; tone: Tone; icon?: IconName; detail: string; detailColor?: string } {
  const { ch } = v;
  const now = Date.now();
  switch (ch.status) {
    case "pending":
      if (kicked) return { label: "Expiring", tone: "neutral", icon: "timer-sand", detail: "Kicked off before it was accepted — the stake goes back." };
      return v.isCreator
        ? {
            label: "Sent",
            tone: "accent",
            icon: "send",
            detail: `Waiting on ${v.friendName} · kicks off ${untilKickoff(ch.startsAt, now)}. Your ${v.myStake.toLocaleString()} is in escrow and comes back if they pass.`,
          }
        : {
            label: "Your Call",
            tone: "warning",
            icon: "bell-ring-outline",
            detail: `Put in ${v.myStake.toLocaleString()} on ${v.myTeam.abbreviation} (${v.myOdds.toFixed(2)}x) to win the ${ch.pot.toLocaleString()} pot. Answer before kickoff, ${untilKickoff(ch.startsAt, now)}.`,
          };
    case "accepted":
      if (pos === "ahead") return { label: "Winning", tone: "positive", icon: "arrow-up-bold", detail: `Takes the ${ch.pot.toLocaleString()} pot if it ends now.`, detailColor: c.positive };
      if (pos === "behind") return { label: "Losing", tone: "negative", icon: "arrow-down-bold", detail: `${v.friendName} takes the pot if it ends now.`, detailColor: c.negative };
      if (pos === "level") return { label: "Level", tone: "warning", detail: "Both stakes come back if it ends level." };
      return {
        label: "Locked",
        tone: "accent",
        icon: "lock",
        detail: kicked ? "Game's on — the pot pays out at the final whistle." : `Both stakes are in the pot. Kicks off ${untilKickoff(ch.startsAt, now)}.`,
      };
    case "settled":
      if (v.result === "won") return { label: "Won", tone: "positive", icon: "trophy", detail: `+${v.theirStake.toLocaleString()} from ${v.friendName}. The ${ch.pot.toLocaleString()} pot was paid to you.`, detailColor: c.positive };
      if (v.result === "lost") return { label: "Lost", tone: "negative", icon: "close", detail: `${v.friendName} took the ${ch.pot.toLocaleString()} pot.`, detailColor: c.negative };
      return { label: "Push", tone: "neutral", detail: "Ended level — both stakes returned." };
    case "declined":
      return { label: "Declined", tone: "neutral", detail: v.isCreator ? `${v.friendName} passed. Your stake was returned.` : "You passed on this one." };
    case "cancelled":
      return { label: "Withdrawn", tone: "neutral", detail: v.isCreator ? "You withdrew it. Your stake was returned." : `${v.friendName} withdrew it.` };
    case "expired":
      return { label: "Expired", tone: "neutral", detail: v.isCreator ? "Not accepted before kickoff. Your stake was returned." : "You didn't answer before kickoff." };
    default:
      return { label: "Void", tone: "neutral", detail: "The game didn't go ahead. Both stakes were returned." };
  }
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12, marginBottom: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kicker: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  pills: { flexDirection: "row", gap: 6 },
  versus: { flexDirection: "row", alignItems: "center", gap: 10 },
  fighter: { flex: 1, gap: 4 },
  who: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teamDot: { minWidth: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  teamAbbr: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  score: { fontSize: 26, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  stake: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  pot: { alignItems: "center", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, minWidth: 78, gap: 1 },
  potValue: { fontSize: 18, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  potLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  message: { fontSize: 13, fontFamily: "Inter_500Medium", fontStyle: "italic", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  detail: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
});

export default memo(ChallengeCard);

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Pill } from "@/components/ui";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import type { Bet } from "@/context/AppContext";
import { useNow } from "@/hooks/useNow";
import { useColors } from "@/hooks/useColors";
import { describeBet } from "@/lib/markets";
import { formatOdds, livePosition, untilKickoff } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { shareViewOrText } from "@/lib/shareCard";
import type { Game } from "@/types/game";

/** The fields a ticket needs — satisfied by main-wallet and league bets alike. */
export type TicketBet = Pick<
  Bet,
  | "id"
  | "gameId"
  | "sport"
  | "side"
  | "market"
  | "selection"
  | "line"
  | "label"
  | "teamName"
  | "teamAbbr"
  | "teamColor"
  | "opponentAbbr"
  | "stake"
  | "odds"
  | "potentialPayout"
  | "status"
  | "freeBet"
  | "freeStake"
  | "finalHomeScore"
  | "finalAwayScore"
> & {
  lockWeek?: string | null;
};

interface Props {
  bet: TicketBet;
  /** League name for league-wallet bets; omitted means the credits wallet. Always shown so the two never blur. */
  walletLabel?: string;
  /** The live game document, when the board still has it. */
  game?: Game | null;
  busy?: boolean;
  onCancel?: () => void;
  onOpenGame?: (game: Game) => void;
  /** Tap anywhere on the ticket. Works even when the game has left the board. */
  onOpen?: () => void;
  /** Space under the card. 10 for plain lists; 0 inside a parent that already spaces its children (Home). */
  spacing?: number;
}

/**
 * A bet, as a ticket — same minimalist card language as ParlayTicket:
 * head (what you picked + status), one matchup line, a live/final line when
 * there is one, and a foot with the money. Tapping it opens the breakdown.
 */
function BetTicket({ bet, walletLabel, game, busy, onCancel, onOpenGame, onOpen, spacing = 10 }: Props) {
  const c = useColors();
  const fmt = useOddsFormat();
  const cardRef = useRef<React.ComponentRef<typeof View> | null>(null);
  // Re-check every 15 s so the cancel button disappears at kickoff, not at the next sync.
  const now = useNow(15_000);

  const meta = STATUS[bet.status];
  const tone =
    meta.tone === "positive"
      ? c.positive
      : meta.tone === "negative"
        ? c.negative
        : meta.tone === "open"
          ? c.primary
          : c.push;

  const desc = describeBet(bet);
  const position = game && bet.status === "pending" ? livePosition(game, bet) : null;
  const posTone = position === "ahead" ? c.positive : position === "behind" ? c.negative : c.warning;

  const myScore = game ? (bet.side === "home" ? game.homeScore : game.awayScore) : null;
  const theirScore = game ? (bet.side === "home" ? game.awayScore : game.homeScore) : null;
  const finalScore =
    bet.finalHomeScore !== undefined && bet.finalAwayScore !== undefined
      ? bet.side === "home"
        ? `${bet.finalHomeScore}–${bet.finalAwayScore}`
        : `${bet.finalAwayScore}–${bet.finalHomeScore}`
      : null;
  const liveScore = game?.status === "live" && myScore !== null && theirScore !== null ? `${myScore}–${theirScore}` : null;
  const cover = bet.status === "pending" && game?.status === "live" ? coverProgress(game, bet) : null;

  // Only before kickoff: the game must be known, still upcoming, and its start time not yet
  // passed (status can lag the real start by a sync or two). The server enforces the same.
  const beforeStart = !!game && game.status === "upcoming" && game.startsAt > now;
  const canCancel = bet.status === "pending" && beforeStart;
  const walletTint = walletLabel ? c.league : c.primary;
  const press = onOpen ?? (game && onOpenGame ? () => onOpenGame(game) : undefined);

  const pay =
    bet.status === "won"
      ? `+${(bet.potentialPayout - bet.stake).toLocaleString()}`
      : bet.status === "lost"
        ? `−${bet.stake.toLocaleString()}`
        : bet.status === "push" || bet.status === "cancelled"
          ? "Stake back"
          : `Pays ${bet.potentialPayout.toLocaleString()}`;

  const shareTicket = () => {
    const pickLabel = bet.label ?? bet.teamName;
    void shareViewOrText({
      viewRef: cardRef,
      kind: "bet_ticket",
      id: bet.id,
      message: `${pickLabel} (${formatOdds(bet.odds, fmt)}) · ${bet.stake.toLocaleString()} → ${bet.potentialPayout.toLocaleString()} on On The House`,
    });
  };

  return (
    <View ref={cardRef} collapsable={false} style={{ marginBottom: spacing }}>
      <Pressable
        accessibilityRole={press ? "button" : undefined}
        accessibilityHint={press ? "Opens bet details" : undefined}
        accessibilityLabel={`${desc.type}: ${desc.pick}, ${meta.label}. ${desc.needs}`}
        onPress={press}
        style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.alpha(tone, 0.45), opacity: press && pressed ? 0.85 : 1 }]}
      >
        <View style={styles.head}>
          <MaterialCommunityIcons name={desc.icon} size={18} color={tone} />
          <Text style={[styles.title, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
            {desc.pick}
          </Text>
          {bet.lockWeek ? (
            <View style={[styles.lockBadge, { backgroundColor: c.alpha(c.accent, 0.16), borderColor: c.alpha(c.accent, 0.5) }]}>
              <MaterialCommunityIcons name="lock" size={10} color={c.accent} />
              <Text style={[styles.lockText, { color: c.accent }]}>1.5x</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {position ? (
            <View
              accessible
              accessibilityLabel={`Live: ${POSITION_LABEL[position]}`}
              style={[styles.posPill, { backgroundColor: c.alpha(posTone, 0.14), borderColor: c.alpha(posTone, 0.6) }]}
            >
              <MaterialCommunityIcons name={POSITION_ICON[position]} size={11} color={posTone} />
              <Text style={[styles.posText, { color: posTone }]}>{POSITION_LABEL[position]}</Text>
            </View>
          ) : (
            <Pill label={meta.label} tone={meta.tone === "positive" ? "positive" : meta.tone === "negative" ? "negative" : meta.tone === "open" ? "accent" : "neutral"} />
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Share bet ticket" hitSlop={8} onPress={shareTicket} style={styles.shareBtn}>
            <MaterialCommunityIcons name="share-variant" size={14} color={c.mutedForeground} />
          </Pressable>
        </View>

        {/* What has to happen for it to cash — the bet type in one muted line. */}
        <View style={styles.leg}>
          <Text style={[styles.typeTag, { color: tone, backgroundColor: c.alpha(tone, 0.12) }]}>{desc.tag}</Text>
          <Text style={[styles.legText, { color: c.mutedForeground, flex: 1 }]} numberOfLines={1}>
            {desc.needs}
          </Text>
        </View>

        {/* Matchup, wallet and where the game stands. */}
        <View style={styles.leg}>
          <MaterialCommunityIcons name={(SPORT_ICONS[bet.sport as keyof typeof SPORT_ICONS] ?? "trophy") as never} size={13} color={c.subtleForeground} />
          <Text style={[styles.legText, { color: c.foreground }]} numberOfLines={1}>
            {bet.teamAbbr} <Text style={{ color: c.mutedForeground }}>vs {bet.opponentAbbr}</Text>
          </Text>
          <Text style={[styles.legText, { color: c.mutedForeground, flex: 1 }]} numberOfLines={1}>
            {game?.status === "upcoming" ? ` · ${untilKickoff(game.startsAt)}` : liveScore ? ` · ● ${game?.clock ?? "Live"}  ${liveScore}` : finalScore ? ` · Final ${finalScore}` : ""}
          </Text>
          <View
            accessible
            accessibilityLabel={walletLabel ? `Wagered in league ${walletLabel}, league tokens` : "Wagered with credits"}
            style={[styles.wallet, { backgroundColor: c.alpha(walletTint, 0.12), borderColor: c.alpha(walletTint, 0.45) }]}
          >
            <MaterialCommunityIcons name={walletLabel ? "trophy-outline" : "lightning-bolt"} size={11} color={walletTint} />
            <Text style={[styles.walletText, { color: walletTint }]} numberOfLines={1}>
              {walletLabel ?? "Credits"}
            </Text>
          </View>
        </View>

        {cover ? (
          <View style={{ gap: 3 }} accessible accessibilityLabel={cover.text}>
            <View style={[styles.coverTrack, { backgroundColor: c.secondary }]}>
              <View style={[styles.coverFill, { width: `${Math.round(cover.pct * 100)}%`, backgroundColor: cover.covering ? c.positive : c.warning }]} />
            </View>
            <Text style={[styles.coverText, { color: cover.covering ? c.positive : c.mutedForeground }]}>{cover.text}</Text>
          </View>
        ) : null}

        <View style={[styles.foot, { borderTopColor: c.border }]}>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {bet.freeBet ? `Free bet (${(bet.freeStake ?? 100).toLocaleString()})` : `Stake ${bet.stake.toLocaleString()}`} · {formatOdds(bet.odds, fmt)}
          </Text>
          <Text style={[styles.pay, { color: tone }]}>{pay}</Text>
        </View>

        {canCancel && onCancel ? (
          <Pressable
            onPress={onCancel}
            disabled={busy}
            style={[styles.cancel, { borderColor: c.alpha(c.foreground, 0.25), opacity: busy ? 0.5 : 1 }]}
          >
            <MaterialCommunityIcons name="undo-variant" size={15} color={c.foreground} />
            <Text style={[styles.sub, { color: c.foreground }]}>
              {bet.freeBet ? "Cancel and get your free bet back" : "Cancel and get the stake back"}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}

export default memo(BetTicket);

const STATUS = {
  pending: { label: "Open", tone: "open" },
  won: { label: "Won", tone: "positive" },
  lost: { label: "Lost", tone: "negative" },
  push: { label: "Push", tone: "muted" },
  cancelled: { label: "Refunded", tone: "muted" },
} as const;

const POSITION_LABEL = { ahead: "Winning", behind: "Losing", level: "Push-risk" } as const;
const POSITION_ICON = { ahead: "arrow-up-bold", behind: "arrow-down-bold", level: "minus" } as const;

/**
 * Spreads and totals: how far from covering, as text and a 0–1 bar.
 * Spread bar fills as the margin approaches the cover; totals by points so far.
 */
function coverProgress(game: Game, bet: TicketBet): { pct: number; text: string; covering: boolean } | null {
  if (game.homeScore === null || game.awayScore === null || typeof bet.line !== "number") return null;
  const sel = bet.selection ?? bet.side ?? "home";
  if (bet.market === "spread") {
    const mine = sel === "home" ? game.homeScore : game.awayScore;
    const theirs = sel === "home" ? game.awayScore : game.homeScore;
    const margin = mine + bet.line - theirs;
    if (margin > 0) return { pct: 1, text: `Covering by ${fmtPts(margin)}`, covering: true };
    const need = -margin + 0.5 * (Number.isInteger(bet.line) ? 1 : 0);
    const span = Math.max(Math.abs(bet.line), 7) + 7;
    return { pct: Math.max(0.05, 1 - need / span), text: `Needs ${fmtPts(-margin || 0.5)} to cover`, covering: false };
  }
  if (bet.market === "total") {
    const total = game.homeScore + game.awayScore;
    if (sel === "over") {
      const need = bet.line - total;
      return need < 0
        ? { pct: 1, text: `Over hit by ${fmtPts(-need)}`, covering: true }
        : { pct: Math.min(1, total / bet.line), text: `Needs ${fmtPts(need + (Number.isInteger(bet.line) ? 1 : 0.5))} more for the over`, covering: false };
    }
    const room = bet.line - total;
    return room > 0
      ? { pct: Math.min(1, total / bet.line), text: `${fmtPts(room)} pts of room under`, covering: true }
      : { pct: 1, text: `Under busted by ${fmtPts(-room)}`, covering: false };
  }
  return null;
}
const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  lockText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.3 },
  posPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  posText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  shareBtn: { padding: 3 },
  leg: { flexDirection: "row", alignItems: "center", gap: 6 },
  legText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  typeTag: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  wallet: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, maxWidth: 140 },
  walletText: { flexShrink: 1, fontSize: 10, fontFamily: "Inter_700Bold" },
  coverTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  coverFill: { height: 5, borderRadius: 3 },
  coverText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  pay: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  cancel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import type { Bet } from "@/context/AppContext";
import { useNow } from "@/hooks/useNow";
import { useColors, type Colors } from "@/hooks/useColors";
import { formatOdds, formatPercent, impliedProbability, livePosition, untilKickoff } from "@/lib/odds";
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
}

/**
 * A bet, as a ticket.
 *
 * The old card showed stake, odds and a status word. An open bet therefore
 * looked identical whether the user's team was up three scores or getting
 * blown out, which is the one thing they open the tab to find out. Joining the
 * bet to the live game document fixes that without a single extra read — the
 * board is already subscribed.
 *
 * Also added: the price as a probability (2.40x means "the market gave this a
 * 42% chance"), profit split out from total return, and the settled score so a
 * lost bet explains itself.
 */
function BetTicket({ bet, walletLabel, game, busy, onCancel, onOpenGame, onOpen }: Props) {
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

  const position = game ? livePosition(game, bet) : null;
  const returned =
    bet.status === "won"
      ? bet.potentialPayout
      : bet.status === "push" || bet.status === "cancelled"
        ? bet.stake
        : 0;

  const posTone = position === "ahead" ? c.positive : position === "behind" ? c.negative : c.warning;
  const cover = bet.status === "pending" && game?.status === "live" ? coverProgress(game, bet) : null;

  const myScore = game ? (bet.side === "home" ? game.homeScore : game.awayScore) : null;
  const theirScore = game ? (bet.side === "home" ? game.awayScore : game.homeScore) : null;
  const finalScore =
    bet.finalHomeScore !== undefined && bet.finalAwayScore !== undefined
      ? bet.side === "home"
        ? `${bet.finalHomeScore}–${bet.finalAwayScore}`
        : `${bet.finalAwayScore}–${bet.finalHomeScore}`
      : null;

  // Only before kickoff: the game must be known, still upcoming, and its start time not yet
  // passed (status can lag the real start by a sync or two). The server enforces the same.
  const beforeStart = !!game && game.status === "upcoming" && game.startsAt > now;
  const canCancel = bet.status === "pending" && beforeStart;
  const walletTint = walletLabel ? c.league : c.primary;
  const press = onOpen ?? (game && onOpenGame ? () => onOpenGame(game) : undefined);

  const shareTicket = () => {
    const pickLabel = bet.label ?? bet.teamName;
    void shareViewOrText({
      viewRef: cardRef,
      kind: "bet_ticket",
      id: bet.id,
      message: `${pickLabel} (${formatOdds(bet.odds, fmt)}) · ${bet.stake.toLocaleString()} → ${bet.potentialPayout.toLocaleString()} on SportDrip`,
    });
  };

  return (
    <View ref={cardRef} collapsable={false}>
      <Pressable
        accessibilityRole={press ? "button" : undefined}
        accessibilityHint={press ? (game?.status === "live" ? "Opens live scoring" : "Opens game details") : undefined}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: c.card, borderColor: c.border, borderLeftColor: tone, opacity: press && pressed ? 0.85 : 1 },
        ]}
        onPress={press}
      >
        <View style={styles.top}>
          <View style={[styles.teamDot, { backgroundColor: bet.teamColor }]} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.team, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
                {bet.label ?? bet.teamName}
              </Text>
              {bet.lockWeek ? (
                <View style={[styles.lockBadge, { backgroundColor: c.alpha(c.accent, 0.16), borderColor: c.alpha(c.accent, 0.5) }]}>
                  <MaterialCommunityIcons name="lock" size={10} color={c.accent} />
                  <Text style={[styles.lockText, { color: c.accent }]}>LOCK 1.5x</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.matchup, { color: c.subtleForeground }]} numberOfLines={1}>
              {bet.sport}   {bet.teamAbbr} v {bet.opponentAbbr}
              {game?.status === "upcoming" ? `   ${untilKickoff(game.startsAt)}` : ""}
            </Text>
            <View
              accessible
              accessibilityLabel={walletLabel ? `Wagered in league ${walletLabel}, league tokens` : "Wagered with credits"}
              style={[styles.wallet, { backgroundColor: c.alpha(walletTint, 0.12), borderColor: c.alpha(walletTint, 0.45) }]}
            >
              <MaterialCommunityIcons name={walletLabel ? "shield-star" : "lightning-bolt"} size={12} color={walletTint} />
              <Text style={[styles.walletText, { color: walletTint }]} numberOfLines={1}>
                {walletLabel ? `${walletLabel} · league tokens` : "Credits"}
              </Text>
            </View>
          </View>

          {position && bet.status === "pending" ? (
            <View
              accessible
              accessibilityLabel={`Live: ${POSITION_LABEL[position]}`}
              style={[styles.pill, styles.posPill, { backgroundColor: c.alpha(posTone, 0.14), borderColor: c.alpha(posTone, 0.6) }]}
            >
              <MaterialCommunityIcons name={POSITION_ICON[position]} size={11} color={posTone} />
              <Text style={[styles.pillText, { color: posTone }]}>{POSITION_LABEL[position]}</Text>
            </View>
          ) : (
            <View style={[styles.pill, { backgroundColor: c.alpha(tone, 0.14), borderColor: c.alpha(tone, 0.6) }]}>
              <Text style={[styles.pillText, { color: tone }]}>{meta.label}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share bet ticket"
            hitSlop={8}
            onPress={shareTicket}
            style={styles.shareBtn}
          >
            <MaterialCommunityIcons name="share-variant" size={15} color={c.mutedForeground} />
          </Pressable>
          {press ? <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} /> : null}
        </View>

        {/* Live or final scoreline, from the wearer's point of view: their team
            first, so "21–14" always means "you're up seven". */}
        {(myScore !== null && theirScore !== null) || finalScore ? (
          <View style={[styles.scoreRow, { backgroundColor: game?.status === "live" ? c.alpha(c.live, 0.1) : c.secondary }]}>
            <Text style={[styles.scoreLabel, { color: game?.status === "live" ? c.live : c.mutedForeground }]}>
              {game?.status === "live" ? `● ${game.clock ?? "Live"}` : "Final"}
            </Text>
            <Text style={[styles.score, { color: c.foreground }]}>
              {finalScore ?? `${myScore}–${theirScore}`}
            </Text>
          </View>
        ) : null}

        {cover ? (
          <View style={{ gap: 4 }} accessible accessibilityLabel={cover.text}>
            <View style={[styles.coverTrack, { backgroundColor: c.secondary }]}>
              <View style={[styles.coverFill, { width: `${Math.round(cover.pct * 100)}%`, backgroundColor: cover.covering ? c.positive : c.warning }]} />
            </View>
            <Text style={[styles.cellHint, { color: cover.covering ? c.positive : c.mutedForeground }]}>{cover.text}</Text>
          </View>
        ) : null}

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <View style={styles.cells}>
          {bet.freeBet ? (
            <Cell label="Stake" value="FREE" hint={`${(bet.freeStake ?? 100).toLocaleString()} free bet`} accent={c.primary} c={c} />
          ) : (
            <Cell label="Stake" value={bet.stake.toLocaleString()} hint={walletLabel ? "league tokens" : "credits"} c={c} />
          )}
          <Cell
            label="Price"
            value={formatOdds(bet.odds, fmt)}
            hint={formatPercent(impliedProbability(bet.odds))}
            c={c}
          />
          <Cell
            label={bet.status === "pending" ? "Returns" : "Returned"}
            value={(bet.status === "pending" ? bet.potentialPayout : returned).toLocaleString()}
            hint={
              bet.status === "pending"
                ? `+${(bet.potentialPayout - bet.stake).toLocaleString()} profit`
                : returned > 0
                  ? `+${(returned - bet.stake).toLocaleString()}`
                  : `−${bet.stake.toLocaleString()}`
            }
            accent={bet.status === "pending" ? c.primary : returned > bet.stake ? c.positive : undefined}
            c={c}
          />
        </View>

        {canCancel && onCancel && (
          <Pressable
            style={({ pressed }) => [styles.cancel, { borderColor: c.alpha(c.foreground, 0.25), backgroundColor: c.secondary, opacity: busy ? 0.5 : pressed ? 0.8 : 1 }]}
            onPress={onCancel}
            disabled={busy}
          >
            <MaterialCommunityIcons name="undo-variant" size={16} color={c.foreground} />
            <Text style={[styles.cancelText, { color: c.foreground }]}>
              {bet.freeBet ? "Cancel and get your free bet back" : "Cancel and get the stake back"}
            </Text>
          </Pressable>
        )}
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

function Cell({
  label,
  value,
  hint,
  accent,
  c,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  c: Colors;
}) {
  return (
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={[styles.cellLabel, { color: c.subtleForeground }]}>{label}</Text>
      <Text style={[styles.cellValue, { color: accent ?? c.foreground }]}>{value}</Text>
      {hint ? <Text style={[styles.cellHint, { color: c.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, padding: 14, marginBottom: 10, gap: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  team: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  lockText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  shareBtn: { padding: 4 },
  matchup: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  posPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  coverTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  coverFill: { height: 6, borderRadius: 3 },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  scoreLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  score: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  divider: { height: 1 },
  cells: { flexDirection: "row" },
  cellLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  cellValue: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  cellHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  wallet: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", gap: 4, marginTop: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  walletText: { flexShrink: 1, fontSize: 11, fontFamily: "Inter_700Bold" },
  cancel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, minHeight: 40 },
  cancelText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

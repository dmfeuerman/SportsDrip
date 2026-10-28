import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Bet } from "@/context/AppContext";
import { useColors, type Colors } from "@/hooks/useColors";
import { formatPercent, impliedProbability, livePosition, untilKickoff } from "@/lib/odds";
import type { Game } from "@/types/game";

/** The fields a ticket needs — satisfied by main-wallet and league bets alike. */
export type TicketBet = Pick<
  Bet,
  | "id"
  | "gameId"
  | "sport"
  | "side"
  | "teamName"
  | "teamAbbr"
  | "teamColor"
  | "opponentAbbr"
  | "stake"
  | "odds"
  | "potentialPayout"
  | "status"
  | "finalHomeScore"
  | "finalAwayScore"
>;

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

  const meta = STATUS[bet.status];
  const tone =
    meta.tone === "positive"
      ? c.positive
      : meta.tone === "negative"
        ? c.negative
        : meta.tone === "open"
          ? c.primary
          : c.push;

  const position = game ? livePosition(game, bet.side) : null;
  const returned =
    bet.status === "won"
      ? bet.potentialPayout
      : bet.status === "push" || bet.status === "cancelled"
        ? bet.stake
        : 0;

  const myScore = game ? (bet.side === "home" ? game.homeScore : game.awayScore) : null;
  const theirScore = game ? (bet.side === "home" ? game.awayScore : game.homeScore) : null;
  const finalScore =
    bet.finalHomeScore !== undefined && bet.finalAwayScore !== undefined
      ? bet.side === "home"
        ? `${bet.finalHomeScore}–${bet.finalAwayScore}`
        : `${bet.finalAwayScore}–${bet.finalHomeScore}`
      : null;

  const canCancel = bet.status === "pending" && (!game || game.status === "upcoming");
  const walletTint = walletLabel ? c.league : c.primary;
  const press = onOpen ?? (game && onOpenGame ? () => onOpenGame(game) : undefined);

  return (
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
          <Text style={[styles.team, { color: c.foreground }]} numberOfLines={1}>
            {bet.teamName}
          </Text>
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

        <View style={[styles.pill, { backgroundColor: c.alpha(tone, 0.14), borderColor: c.alpha(tone, 0.6) }]}>
          <Text style={[styles.pillText, { color: tone }]}>
            {position && bet.status === "pending" ? POSITION_LABEL[position] : meta.label}
          </Text>
        </View>
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

      <View style={[styles.divider, { backgroundColor: c.border }]} />

      <View style={styles.cells}>
        <Cell label="Stake" value={bet.stake.toLocaleString()} hint={walletLabel ? "league tokens" : "credits"} c={c} />
        <Cell
          label="Price"
          value={`${bet.odds.toFixed(2)}x`}
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
            Cancel and get the stake back
          </Text>
        </Pressable>
      )}
    </Pressable>
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

const POSITION_LABEL = { ahead: "Ahead", behind: "Behind", level: "Level" } as const;

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
  matchup: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  scoreLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  score: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  divider: { height: 1 },
  cells: { flexDirection: "row" },
  cellLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  cellValue: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  cellHint: { fontSize: 10, fontFamily: "Inter_400Regular" },
  wallet: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", gap: 4, marginTop: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  walletText: { flexShrink: 1, fontSize: 11, fontFamily: "Inter_700Bold" },
  cancel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, minHeight: 40 },
  cancelText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

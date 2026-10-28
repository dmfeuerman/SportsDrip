import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import BetModal, { type BetWallet } from "@/components/BetModal";
import GameDetailSheet, { type DetailBet } from "@/components/GameDetailSheet";
import KeyboardSheet from "@/components/KeyboardSheet";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useGame } from "@/hooks/useGame";
import { prefetchGameInsights } from "@/hooks/useGameInsights";
import * as api from "@/lib/api";
import { newIdempotencyKey } from "@/lib/api";
import { openGameCenter } from "@/lib/gameCenter";
import type { Game, Side } from "@/types/game";

/**
 * The games-board detail sheet, openable from any bet by id.
 *
 * Loads games/{id} directly so bets on games that have left the board still
 * open. Upcoming games get the same bet slip as the board.
 *
 * Render it inside whatever sheet lists the bets: iOS only stacks a Modal on
 * one that is already presented when it is a descendant of it.
 */
export default function GameQuickView({
  gameId,
  onClose,
  defaultWallet,
  onLeave,
}: {
  gameId: string | null;
  onClose: () => void;
  /** Preselected wallet in the bet slip (a league id). */
  defaultWallet?: string;
  /** Called before navigating to the game center, so a host sheet can close. */
  onLeave?: () => void;
}) {
  const c = useColors();
  const { game: loaded, loading, missing } = useGame(gameId);
  const game = loaded && loaded.id === gameId ? loaded : null;
  const { balance, bets } = useApp();
  const { leagues, activeLeagues, uid, placeLeagueBet, myLeagueBets } = useLeague();
  const { betLocked } = useToast();

  const [showDetail, setShowDetail] = useState(true);
  const [pending, setPending] = useState<{ game: Game; side: Side; key: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setShowDetail(true);
    setPending(null);
    setSlipError(null);
    if (gameId) prefetchGameInsights(gameId);
  }, [gameId]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const detailBets: DetailBet[] = useMemo(() => {
    if (!gameId) return [];
    const out: DetailBet[] = bets.filter((b) => b.gameId === gameId);
    for (const lg of leagues) {
      for (const b of myLeagueBets[lg.id] ?? []) {
        if (b.gameId === gameId) out.push({ ...b, id: `${lg.id}:${b.id}`, wallet: lg.name });
      }
    }
    return out;
  }, [gameId, bets, leagues, myLeagueBets]);

  const wallets: BetWallet[] = useMemo(() => {
    const out: BetWallet[] = [{ id: "credits", label: "Credits", balance, kind: "credits" }];
    if (!pending || !uid) return out;
    for (const lg of activeLeagues) {
      if (!lg.allowedSports.includes(pending.game.sport)) continue;
      if (pending.game.startsAt >= lg.endsAt) continue;
      const me = lg.members[uid];
      if (!me) continue;
      out.push({ id: lg.id, label: lg.name, balance: me.leagueTokens, kind: "league" });
    }
    return out;
  }, [pending, activeLeagues, uid, balance]);

  // Same iOS constraint as the board: let the detail sheet finish dismissing
  // before the slip presents.
  const startBet = useCallback((g: Game, side: Side) => {
    setShowDetail(false);
    setSlipError(null);
    const open = () => setPending({ game: g, side, key: newIdempotencyKey() });
    if (Platform.OS === "ios") timer.current = setTimeout(open, 350);
    else open();
  }, []);

  const confirmBet = useCallback(
    async (stake: number, walletId: string) => {
      if (!pending) return;
      setSubmitting(true);
      setSlipError(null);
      const expectedOdds = pending.side === "home" ? pending.game.homeTeam.odds : pending.game.awayTeam.odds;
      let failure: string | null = null;
      if (walletId === "credits") {
        try {
          await api.placeBet({ gameId: pending.game.id, side: pending.side, stake, idempotencyKey: pending.key, expectedOdds });
        } catch (err) {
          failure = api.friendlyError(err);
        }
      } else {
        failure = await placeLeagueBet({
          leagueId: walletId,
          gameId: pending.game.id,
          side: pending.side,
          stake,
          idempotencyKey: `${pending.key}${walletId.slice(-4)}`,
          expectedOdds,
        });
      }
      setSubmitting(false);
      if (failure) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setSlipError(failure);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      {
        const t = pending.side === "home" ? pending.game.homeTeam : pending.game.awayTeam;
        const w = wallets.find((x) => x.id === walletId);
        betLocked({
          teamName: t.name,
          teamAbbr: t.abbreviation,
          teamColor: t.color,
          odds: expectedOdds,
          stake,
          payout: Math.round(stake * expectedOdds),
          currency: walletId === "credits" ? "credits" : "league",
          walletLabel: w?.label,
        });
      }
      setPending(null);
      onClose();
    },
    [pending, placeLeagueBet, onClose, wallets, betLocked]
  );

  if (!gameId) return null;

  if (!game) {
    if (loading || !missing) return null;
    return (
      <KeyboardSheet visible onClose={onClose} maxHeight="40%">
        <View style={styles.missing}>
          <MaterialCommunityIcons name="calendar-remove" size={28} color={c.mutedForeground} />
          <Text style={[styles.missingTitle, { color: c.foreground }]}>This game has been archived</Text>
          <Text style={[styles.missingBody, { color: c.mutedForeground }]}>
            Finished games drop off the board after two days. The bet keeps its result.
          </Text>
        </View>
      </KeyboardSheet>
    );
  }

  const team = pending ? (pending.side === "home" ? pending.game.homeTeam : pending.game.awayTeam) : null;

  return (
    <>
      <GameDetailSheet
        game={showDetail ? game : null}
        onClose={onClose}
        onBet={startBet}
        bets={detailBets}
        onOpenCenter={(g) => {
          onClose();
          onLeave?.();
          openGameCenter(g.id, g.status === "upcoming" ? "matchup" : "live");
        }}
      />
      {pending && team && (
        <BetModal
          visible
          onClose={onClose}
          onConfirm={confirmBet}
          teamName={team.name}
          teamAbbr={team.abbreviation}
          teamColor={team.color}
          odds={team.odds}
          game={pending.game}
          side={pending.side}
          wallets={wallets}
          defaultWallet={defaultWallet}
          error={slipError}
          submitting={submitting}
          gameSummary={`${pending.game.awayTeam.abbreviation} @ ${pending.game.homeTeam.abbreviation} · ${pending.game.sport}`}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  missing: { alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 16 },
  missingTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  missingBody: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center" },
});

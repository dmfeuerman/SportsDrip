import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import BetModal, { type BetWallet, type SlipExtras } from "@/components/BetModal";
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
import { quoteMarket, weekKey, type Market, type Selection } from "@/lib/markets";
import type { Game, Side } from "@/types/game";

/**
 * Tail (same side) or fade (other side) another member's league bet. Opens the
 * slip straight away with that league and their stake preselected.
 */
export interface FollowIntent {
  betId: string;
  kind: "tail" | "fade";
  leagueId: string;
  /** The member being followed. */
  name: string;
  /** Side this bet backs: theirs for a tail, the other one for a fade. */
  side: Side;
  market?: Market;
  selection?: Selection;
  stake: number;
  sourceTeamAbbr: string;
}

export default function GameQuickView({
  gameId,
  onClose,
  defaultWallet,
  onLeave,
  follow,
}: {
  gameId: string | null;
  onClose: () => void;
  /** Preselected wallet in the bet slip (a league id). */
  defaultWallet?: string;
  /** Called before navigating to the game center, so a host sheet can close. */
  onLeave?: () => void;
  /** Skip the detail sheet and open a tail / fade slip directly. */
  follow?: FollowIntent | null;
}) {
  const c = useColors();
  const { game: loaded, loading, missing } = useGame(gameId);
  const game = loaded && loaded.id === gameId ? loaded : null;
  const { balance, bets } = useApp();
  const { leagues, activeLeagues, uid, placeLeagueBet, myLeagueBets } = useLeague();
  const { betLocked, show } = useToast();

  const [showDetail, setShowDetail] = useState(true);
  const [pending, setPending] = useState<{
    game: Game;
    side: Side;
    market: Market;
    selection: Selection;
    key: string;
    friend?: boolean;
    follow?: FollowIntent;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const followKey = follow ? `${follow.betId}:${follow.kind}` : null;
  useEffect(() => {
    setShowDetail(!followKey);
    setPending(null);
    setSlipError(null);
    if (gameId) prefetchGameInsights(gameId);
  }, [gameId, followKey]);

  const followOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!follow || !game || !followKey) return;
    const key = `${game.id}:${followKey}`;
    if (followOpened.current === key) return;
    followOpened.current = key;
    if (game.status !== "upcoming" || game.startsAt <= Date.now()) {
      setShowDetail(true);
      return;
    }
    setPending({
      game,
      side: follow.side,
      market: follow.market ?? "ml",
      selection: follow.selection ?? follow.side,
      key: newIdempotencyKey(),
      follow,
    });
  }, [follow, followKey, game]);
  useEffect(() => {
    if (!gameId) followOpened.current = null;
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

  const lockUsed: Record<string, boolean> = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!pending || !uid) return out;
    const wk = weekKey(pending.game.startsAt || Date.now());
    for (const lg of activeLeagues) {
      out[lg.id] = lg.members[uid]?.lastLockWeek === wk;
    }
    return out;
  }, [pending, activeLeagues, uid]);

  const startBet = useCallback(
    (g: Game, side: Side, market: Market = "ml", selection?: Selection, friend?: boolean) => {
      setShowDetail(false);
      setSlipError(null);
      const open = () =>
        setPending({
          game: g,
          side,
          market,
          selection: selection ?? side,
          key: newIdempotencyKey(),
          friend,
        });
      if (Platform.OS === "ios") timer.current = setTimeout(open, 350);
      else open();
    },
    []
  );

  const confirmBet = useCallback(
    async (stake: number, walletId: string, extras: SlipExtras) => {
      if (!pending) return;
      const quote = quoteMarket(pending.game, pending.market, pending.selection);
      if (quote.odds === null) {
        setSlipError("No line yet for this game. Check back closer to kickoff.");
        return;
      }
      setSubmitting(true);
      setSlipError(null);
      let failure: string | null = null;
      if (walletId === "credits") {
        try {
          await api.placeBet({
            gameId: pending.game.id,
            side: quote.side ?? pending.side,
            market: quote.market,
            selection: quote.selection,
            stake,
            idempotencyKey: pending.key,
            expectedOdds: quote.odds,
            expectedLine: quote.line ?? undefined,
          });
        } catch (err) {
          failure = api.friendlyError(err);
        }
      } else {
        const f = pending.follow && pending.follow.leagueId === walletId ? pending.follow : null;
        failure = await placeLeagueBet({
          leagueId: walletId,
          gameId: pending.game.id,
          side: quote.side ?? pending.side,
          market: quote.market,
          selection: quote.selection,
          stake,
          idempotencyKey: `${pending.key}${walletId.slice(-4)}`,
          expectedOdds: quote.odds,
          expectedLine: quote.line ?? undefined,
          lock: extras.lock,
          hidden: extras.hidden,
          ...(f ? (f.kind === "tail" ? { tailOf: f.betId } : { fadeOf: f.betId }) : {}),
        });
      }
      setSubmitting(false);
      if (failure) {
        buzz.error();
        setSlipError(failure);
        return;
      }
      buzz.success();
      {
        const w = wallets.find((x) => x.id === walletId);
        betLocked({
          teamName: quote.teamName,
          teamAbbr: quote.label,
          teamColor: quote.teamColor,
          odds: quote.odds,
          stake,
          payout: Math.round(stake * quote.odds),
          currency: walletId === "credits" ? "credits" : "league",
          walletLabel: w?.label,
          leagueId: walletId === "credits" ? undefined : walletId,
          gameId: pending.game.id,
          hidden: !!extras.hidden,
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

  const quote = pending ? quoteMarket(pending.game, pending.market, pending.selection) : null;

  return (
    <>
      <GameDetailSheet
        game={showDetail ? game : null}
        onClose={onClose}
        onBet={(g, side, market, selection) => startBet(g, side, market, selection, false)}
        onChallenge={(g, side) => startBet(g, side, "ml", side, true)}
        bets={detailBets}
        onOpenCenter={(g) => {
          onClose();
          onLeave?.();
          openGameCenter(g.id, g.status === "upcoming" ? "matchup" : "live");
        }}
      />
      {pending && quote && (
        <BetModal
          visible
          onClose={onClose}
          onConfirm={confirmBet}
          teamName={quote.teamName}
          teamAbbr={quote.teamAbbr}
          teamColor={quote.teamColor}
          pickTitle={quote.pickTitle}
          lockUsed={lockUsed}
          odds={quote.odds}
          game={pending.game}
          side={quote.side}
          wallets={wallets}
          defaultWallet={pending.follow?.leagueId ?? defaultWallet}
          defaultStake={pending.follow?.stake}
          context={
            pending.follow
              ? {
                  icon: pending.follow.kind === "tail" ? "account-multiple-plus" : "account-switch",
                  text:
                    pending.follow.kind === "tail"
                      ? `Tailing ${pending.follow.name} on ${pending.follow.sourceTeamAbbr}`
                      : `Fading ${pending.follow.name}'s ${pending.follow.sourceTeamAbbr} pick`,
                  leagueId: pending.follow.leagueId,
                }
              : undefined
          }
          error={slipError}
          submitting={submitting}
          challenge={
            pending.follow || pending.market !== "ml"
              ? undefined
              : {
                  initial: pending.friend,
                  onSent: (sent) => {
                    setPending(null);
                    onClose();
                    show({
                      id: `chsent_${Date.now()}`,
                      kind: "social",
                      icon: "sword-cross",
                      color: sent.teamColor,
                      title: `Challenge sent to ${sent.friendName}`,
                      body: `${sent.stake.toLocaleString()} on ${sent.teamAbbr} is in the pot. Winner takes ${sent.pot.toLocaleString()} once they accept.`,
                      cta: "View",
                      href: "/challenges",
                    });
                  },
                  onFindFriends: () => {
                    setPending(null);
                    onClose();
                    onLeave?.();
                    router.navigate("/(tabs)/friends");
                  },
                }
          }
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

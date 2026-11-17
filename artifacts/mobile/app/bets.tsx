import { adAfterRow } from "@/constants/ads";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { router, useLocalSearchParams } from "expo-router";
import { useUnseenCount } from "@/lib/settings";
import React, { useMemo, useState } from "react";
import ParlayTicket from "@/components/ParlayTicket";
import ChallengeCard from "@/components/ChallengeCard";
import { useNow } from "@/hooks/useNow";
import { useMyParlays } from "@/hooks/useMyParlays";
import { useToast } from "@/context/ToastContext";
import * as api from "@/lib/api";
import { FlatList, StyleSheet, Text, View } from "react-native";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import BetTicket, { type TicketBet } from "@/components/BetTicket";
import GameQuickView from "@/components/GameQuickView";
import { ActionChip, Amount, ConfirmDialog, EmptyState, FilterPills, LoadingState, ScreenHeader, StatTile, TabStrip, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useChallenges, viewOf } from "@/context/ChallengeContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";

type Tab = "open" | "settled";
type Row = { bet: TicketBet; key: string; placed: number; wallet: string | null; leagueId?: string; cancellable: boolean };

/**
 * Every bet you have, in both wallets.
 */
export default function MyBetsScreen() {
  const c = useColors();
  const bottomPad = useBottomPad(false);
  const params = useLocalSearchParams<{ wallet?: string }>();
  const { bets, betsLoaded, balance, totalWon, totalStaked, cancelBet, profile } = useApp();
  const parlays = useMyParlays(profile?.uid);
  const { show } = useToast();
  const { leagues, myLeagueBets } = useLeague();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const [tab, setTab] = useState<Tab>("open");
  const [wallet, setWallet] = useState<string>(params.wallet ?? "all");
  const [busy, setBusy] = useState<string | null>(null);
  // Parlays cancelled on this screen: gone from Open at once, before the listener reports it.
  const [cancelledParlays, setCancelledParlays] = useState<Record<string, boolean>>({});
  const [quickGame, setQuickGame] = useState<string | null>(null);
  // Which wallet the slip should default to when a game is opened from here:
  // the bet's own league, else the league pill that's filtering the list.
  const [quickWallet, setQuickWallet] = useState<string | undefined>(undefined);
  const leagueFilter = wallet !== "all" && wallet !== "credits" ? wallet : undefined;
  const openGame = (gameId: string, walletId?: string) => {
    setQuickWallet(walletId ?? leagueFilter);
    setQuickGame(gameId);
  };
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  // "Are you sure?" before a cancel: the bet (or parlay) waiting on confirmation.
  const [confirmCancel, setConfirmCancel] = useState<
    | { kind: "bet"; key: string; betId: string; pick: string; stake: number; free: boolean }
    | { kind: "parlay"; id: string; legs: number; stake: number }
    | null
  >(null);
  const { uid: chUid, incoming: chIn, outgoing: chOut, live: chLive, history: chHistory, escrowed, respond: respondChallenge, cancel: cancelChallenge } = useChallenges();
  const now = useNow(30_000);
  // Friend challenges are credit bets too: open ones (waiting on you, waiting on them, locked in) under Open, the rest under Settled.
  const challengeViews = useMemo(() => {
    if (!chUid || (wallet !== "all" && wallet !== "credits")) return [];
    const list = tab === "open" ? [...chIn, ...chOut, ...chLive] : chHistory.slice(0, 30);
    return list.map((ch) => viewOf(ch, chUid));
  }, [chUid, wallet, tab, chIn, chOut, chLive, chHistory]);
  const openChallenges = chIn.length + chOut.length + chLive.length;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (wallet === "all" || wallet === "credits") {
      for (const b of bets) out.push({ bet: b, key: b.id, placed: (b.placedAt?.seconds ?? 0) * 1000, wallet: null, cancellable: true });
    }
    for (const lg of leagues) {
      if (wallet !== "all" && wallet !== lg.id) continue;
      for (const b of myLeagueBets[lg.id] ?? []) out.push({ bet: b, key: `${lg.id}:${b.id}`, placed: b.placedAt, wallet: lg.name, leagueId: lg.id, cancellable: false });
    }
    return out.sort((a, b) => b.placed - a.placed);
  }, [bets, leagues, myLeagueBets, wallet]);

  const open = rows.filter((r) => r.bet.status === "pending");
  const settled = rows.filter((r) => r.bet.status !== "pending");
  const list = tab === "open" ? open : settled;
  // Red badges count only bets you haven't looked at yet.
  const openNew = useUnseenCount("bets.open", open.map((r) => r.key), tab === "open");
  const settledNew = useUnseenCount("bets.settled", settled.map((r) => r.key), tab === "settled");
  const won = settled.filter((r) => r.bet.status === "won").length;
  const lost = settled.filter((r) => r.bet.status === "lost").length;
  const pushes = settled.filter((r) => r.bet.status === "push").length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  const wallets = [
    { id: "all", label: "All" },
    { id: "credits", label: "Credits" },
    ...leagues.map((l) => ({ id: l.id, label: l.name })),
  ];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title="My Bets"
        subtitle={`${won}W · ${lost}L${pushes ? ` · ${pushes}P` : ""}${winRate !== null ? ` · ${winRate}% hit rate` : ""}`}
        right={<Amount value={balance} animate />}
      >
        <View style={styles.stats}>
          <StatTile label="Staked" hint="credits, all time">
            <Amount value={totalStaked} size="sm" tone="neutral" />
          </StatTile>
          <StatTile label="Net From Wins" hint="credits">
            <Amount value={totalWon} size="sm" tone={totalWon > 0 ? "positive" : "neutral"} signed />
          </StatTile>
        </View>
        {openChallenges > 0 && (
          <ActionChip
            icon="sword-cross"
            label={`${openChallenges} friend challenge${openChallenges > 1 ? "s" : ""}${escrowed ? ` · ${escrowed.toLocaleString()} in pots` : ""}${chIn.length ? ` · ${chIn.length} need an answer` : ""}`}
            onPress={() => router.push("/challenges")}
            style={{ alignSelf: "flex-start" }}
          />
        )}
        {leagues.length > 0 && (
          <FilterPills
            value={wallet}
            onChange={setWallet}
            inset={0}
            options={wallets.map((w) => ({
              value: w.id,
              label: w.label,
              // All = every wallet, Credits = your own balance, anything else is a league.
              icon: (w.id === "all" ? "layers-triple-outline" : w.id === "credits" ? "lightning-bolt" : "trophy-outline") as never,
              color: w.id === "all" ? undefined : w.id === "credits" ? c.primary : c.league,
            }))}
          />
        )}
        <TabStrip
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: "Open", badge: openNew || undefined },
            { value: "settled", label: "Settled", badge: settledNew || undefined },
          ]}
        />
      </ScreenHeader>

      <FlatList
        data={list}
        keyExtractor={(r) => r.key}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        windowSize={7}
        renderItem={({ item, index }) => (
          <>
          <BetTicket
            bet={item.bet}
            walletLabel={item.wallet ?? undefined}
            game={gameById.get(item.bet.gameId) ?? null}
            busy={busy === item.key}
            onOpen={() =>
              // Every bet, open or settled, opens its details; "Matchup Details" in there goes to the game.
              setBreakdown({
                id: item.bet.id,
                gameId: item.bet.gameId,
                sport: item.bet.sport,
                teamName: item.bet.teamName,
                teamAbbr: item.bet.teamAbbr,
                teamColor: item.bet.teamColor,
                opponentAbbr: item.bet.opponentAbbr,
                side: item.bet.side,
                market: item.bet.market ?? "ml",
                selection: item.bet.selection ?? null,
                line: item.bet.line ?? null,
                label: item.bet.label ?? null,
                lock: Boolean(item.bet.lockWeek),
                odds: item.bet.odds,
                stake: item.bet.stake,
                payout: item.bet.potentialPayout,
                status: item.bet.status,
                finalHomeScore: item.bet.finalHomeScore ?? null,
                finalAwayScore: item.bet.finalAwayScore ?? null,
                wallet: item.wallet ? "league" : "credits",
                leagueId: item.leagueId ?? null,
                leagueName: item.wallet,
                placedAtMs: item.placed || null,
              })
            }
            onCancel={
              item.cancellable
                ? () =>
                    setConfirmCancel({
                      kind: "bet",
                      key: item.key,
                      betId: item.bet.id,
                      pick: item.bet.label ?? item.bet.teamName,
                      stake: item.bet.stake,
                      free: Boolean(item.bet.freeBet),
                    })
                : undefined
            }
          />
            {adAfterRow(index) ? <SponsoredCard compact style={{ marginBottom: 10 }} /> : null}
          </>
        )}
        ListHeaderComponent={
          wallet === "all" || wallet === "credits" ? (
            <View style={{ gap: 10, marginBottom: 10 }}>
              {challengeViews.map((v) => (
                <ChallengeCard
                  key={`ch_${v.ch.id}`}
                  view={v}
                  game={gameById.get(v.ch.gameId) ?? null}
                  now={now}
                  onOpen={() => { setQuickWallet(undefined); setQuickGame(v.ch.gameId); }}
                  // Accepting locks credits in a pot: confirm it on the Challenges screen.
                  onAccept={() => router.push({ pathname: "/challenges", params: { tab: "inbox" } })}
                  onDecline={() => void respondChallenge(v.ch.id, false)}
                  onCancel={() => void cancelChallenge(v.ch.id)}
                />
              ))}
              {parlays
                .filter((p) => (tab === "open" ? p.status === "pending" && !cancelledParlays[p.id] : p.status !== "pending"))
                .map((p) => (
                  <ParlayTicket
                    key={p.id}
                    p={p}
                    busy={busy === p.id}
                    onOpen={() =>
                      setBreakdown({
                        id: p.id,
                        gameId: null,
                        sport: null,
                        teamName: `${p.legs.length}-Leg Parlay`,
                        teamAbbr: p.legs[0]?.teamAbbr ?? "",
                        opponentAbbr: p.legs[0]?.opponentAbbr ?? "",
                        side: null,
                        market: "parlay",
                        odds: p.odds,
                        stake: p.stake,
                        payout: p.potentialPayout,
                        status: p.status,
                        wallet: "credits",
                        placedAtMs: (p.placedAt?.seconds ?? 0) * 1000 || null,
                        legs: p.legs.map((l) => ({
                          label: l.label,
                          matchup: `${l.teamAbbr} vs ${l.opponentAbbr}`,
                          sport: l.sport,
                          odds: l.odds,
                          status: l.status,
                        })),
                      })
                    }
                    onCancel={() => setConfirmCancel({ kind: "parlay", id: p.id, legs: p.legs.length, stake: p.stake })}
                  />
                ))}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          (challengeViews.length > 0 || parlays.some((p) => (tab === "open" ? p.status === "pending" : p.status !== "pending"))) && (wallet === "all" || wallet === "credits") ? undefined : !betsLoaded ? (
          <LoadingState label="Loading your bets…" />
          ) : (
          <EmptyState
            icon={tab === "open" ? "ticket-outline" : "history"}
            title={tab === "open" ? "No open bets" : "Nothing settled yet"}
            body={
              tab === "open"
                ? "Pick a game on the board and back a team."
                : "Results land here automatically when games finish — you don't need the app open."
            }
            action={tab === "open" ? "Browse games" : undefined}
            onAction={() => router.navigate("/(tabs)/games")}
          />
          )
        }
      />
      <ConfirmDialog
        visible={!!confirmCancel}
        title={confirmCancel?.kind === "parlay" ? "Cancel this parlay?" : "Cancel this bet?"}
        body={
          !confirmCancel
            ? ""
            : confirmCancel.kind === "parlay"
              ? `Your ${confirmCancel.legs}-leg parlay will be voided and your ${confirmCancel.stake.toLocaleString()}-credit stake goes back to your balance.`
              : confirmCancel.free
                ? `Your pick on ${confirmCancel.pick} will be removed and you'll get your free bet back.`
                : `Your pick on ${confirmCancel.pick} will be removed and your ${confirmCancel.stake.toLocaleString()}-credit stake goes back to your balance.`
        }
        confirmLabel={confirmCancel?.kind === "parlay" ? "Cancel parlay" : "Cancel bet"}
        cancelLabel="Keep it"
        destructive
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          const target = confirmCancel;
          setConfirmCancel(null);
          if (!target) return;
          if (target.kind === "bet") {
            setBusy(target.key);
            void cancelBet(target.betId).finally(() => setBusy(null));
          } else {
            // Instant: it leaves Open now; it comes back, with the reason, if the server refuses.
            setCancelledParlays((m) => ({ ...m, [target.id]: true }));
            api.cancelParlay({ parlayId: target.id }).catch((e) => {
              setCancelledParlays((m) => ({ ...m, [target.id]: false }));
              show({ kind: "warning", title: "Couldn't cancel", body: api.friendlyError(e) });
            });
          }
        }}
      />
      <BetBreakdownModal
        item={breakdown}
        game={breakdown?.gameId ? gameById.get(breakdown.gameId) ?? null : null}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => openGame(gId, breakdown?.leagueId ?? undefined)}
      />
      <GameQuickView gameId={quickGame} defaultWallet={quickWallet} onClose={() => setQuickGame(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stats: { flexDirection: "row", gap: 8 },
  chips: { gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, maxWidth: 180 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16 },
});

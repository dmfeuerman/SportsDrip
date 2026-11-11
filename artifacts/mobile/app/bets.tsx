import { adAfterRow } from "@/constants/ads";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { router, useLocalSearchParams } from "expo-router";
import { useUnseenCount } from "@/lib/settings";
import React, { useMemo, useState } from "react";
import ParlayTicket from "@/components/ParlayTicket";
import { useMyParlays } from "@/hooks/useMyParlays";
import { useToast } from "@/context/ToastContext";
import * as api from "@/lib/api";
import { FlatList, StyleSheet, Text, View } from "react-native";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import BetTicket, { type TicketBet } from "@/components/BetTicket";
import GameQuickView from "@/components/GameQuickView";
import { ActionChip, Amount, EmptyState, FilterPills, LoadingState, ScreenHeader, StatTile, TabStrip, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useChallenges } from "@/context/ChallengeContext";
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
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  const { incoming: chIn, outgoing: chOut, live: chLive, escrowed } = useChallenges();
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
            options={wallets.map((w) => ({ value: w.id, label: w.label, icon: (w.id === "credits" ? "lightning-bolt" : "shield-star") as never }))}
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
            onOpen={() => {
              if (item.bet.status !== "pending") {
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
                });
              } else {
                setQuickGame(item.bet.gameId);
              }
            }}
            onCancel={
              item.cancellable
                ? async () => {
                    setBusy(item.key);
                    await cancelBet(item.bet.id);
                    setBusy(null);
                  }
                : undefined
            }
          />
            {adAfterRow(index) ? <SponsoredCard compact style={{ marginBottom: 10 }} /> : null}
          </>
        )}
        ListHeaderComponent={
          wallet === "all" || wallet === "credits" ? (
            <View style={{ gap: 10, marginBottom: 10 }}>
              {parlays
                .filter((p) => (tab === "open" ? p.status === "pending" && !cancelledParlays[p.id] : p.status !== "pending"))
                .map((p) => (
                  <ParlayTicket
                    key={p.id}
                    p={p}
                    busy={busy === p.id}
                    onCancel={async () => {
                      // Instant: it leaves Open now; it comes back, with the reason, if the server refuses.
                      setCancelledParlays((m) => ({ ...m, [p.id]: true }));
                      try {
                        await api.cancelParlay({ parlayId: p.id });
                      } catch (e) {
                        setCancelledParlays((m) => ({ ...m, [p.id]: false }));
                        show({ kind: "warning", title: "Couldn't cancel", body: api.friendlyError(e) });
                      }
                    }}
                  />
                ))}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          parlays.some((p) => (tab === "open" ? p.status === "pending" : p.status !== "pending")) && (wallet === "all" || wallet === "credits") ? undefined : !betsLoaded ? (
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
      <BetBreakdownModal
        item={breakdown}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => setQuickGame(gId)}
      />
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
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

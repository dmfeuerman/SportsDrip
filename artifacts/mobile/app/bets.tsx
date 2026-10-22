import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import BetTicket, { type TicketBet } from "@/components/BetTicket";
import { Amount, EmptyState, ScreenHeader, SegmentedControl, StatTile, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";

type Tab = "open" | "settled";
type Row = { bet: TicketBet; key: string; placed: number; wallet: string | null; cancellable: boolean };

/**
 * Every bet you have, in both wallets.
 *
 * Previously credits-only, and it subscribed to *every* final game in the
 * database to show settled scores — an unbounded read that grew with the
 * season. Settled bets carry their own final score, so only the live board is
 * joined now.
 */
export default function MyBetsScreen() {
  const c = useColors();
  const bottomPad = useBottomPad(false);
  const params = useLocalSearchParams<{ wallet?: string }>();
  const { bets, balance, totalWon, totalStaked, cancelBet } = useApp();
  const { leagues, myLeagueBets } = useLeague();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const [tab, setTab] = useState<Tab>("open");
  const [wallet, setWallet] = useState<string>(params.wallet ?? "all");
  const [busy, setBusy] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (wallet === "all" || wallet === "credits") {
      for (const b of bets) out.push({ bet: b, key: b.id, placed: (b.placedAt?.seconds ?? 0) * 1000, wallet: null, cancellable: true });
    }
    for (const lg of leagues) {
      if (wallet !== "all" && wallet !== lg.id) continue;
      for (const b of myLeagueBets[lg.id] ?? []) out.push({ bet: b, key: `${lg.id}:${b.id}`, placed: b.placedAt, wallet: lg.name, cancellable: false });
    }
    return out.sort((a, b) => b.placed - a.placed);
  }, [bets, leagues, myLeagueBets, wallet]);

  const open = rows.filter((r) => r.bet.status === "pending");
  const settled = rows.filter((r) => r.bet.status !== "pending");
  const list = tab === "open" ? open : settled;
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
        title="My bets"
        subtitle={`${won}W · ${lost}L${pushes ? ` · ${pushes}P` : ""}${winRate !== null ? ` · ${winRate}% hit rate` : ""}`}
        right={<Amount value={balance} />}
      >
        <View style={styles.stats}>
          <StatTile label="Staked" hint="credits, all time">
            <Amount value={totalStaked} size="sm" tone="neutral" />
          </StatTile>
          <StatTile label="Net from wins" hint="credits">
            <Amount value={totalWon} size="sm" tone={totalWon > 0 ? "positive" : "neutral"} signed />
          </StatTile>
        </View>
        {leagues.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {wallets.map((w) => {
              const on = wallet === w.id;
              return (
                <Pressable
                  key={w.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setWallet(w.id)}
                  style={[styles.chip, { backgroundColor: on ? c.foreground : c.secondary, borderColor: on ? c.foreground : c.border }]}
                >
                  <Text style={[styles.chipText, { color: on ? c.background : c.mutedForeground }]} numberOfLines={1}>
                    {w.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: "Open", badge: open.length },
            { value: "settled", label: "Settled", badge: settled.length },
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
        renderItem={({ item }) => (
          <BetTicket
            bet={item.bet}
            walletLabel={item.wallet ?? undefined}
            game={gameById.get(item.bet.gameId) ?? null}
            busy={busy === item.key}
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
        )}
        ListEmptyComponent={
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
        }
      />
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

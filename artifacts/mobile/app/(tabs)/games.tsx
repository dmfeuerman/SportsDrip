import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import BetModal, { type BetWallet } from "@/components/BetModal";
import GameCard, { type MyPosition } from "@/components/GameCard";
import GameDetailSheet from "@/components/GameDetailSheet";
import TokenBalance from "@/components/TokenBalance";
import { IconButton } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";
import * as api from "@/lib/api";
import { newIdempotencyKey } from "@/lib/api";
import { SPORTS, type Game, type Side } from "@/types/game";

const ALL = "ALL";

type Row =
  | { kind: "section"; id: string; title: string; live?: boolean }
  | { kind: "game"; id: string; game: Game };

/**
 * Rewritten games screen.
 *
 * Four things changed:
 *
 *  1. Virtualization. The old screen rendered every game inside
 *     `ListHeaderComponent` of a `FlatList` with `data={[]}`, so all ~100 cards
 *     mounted at once and nothing was ever recycled (AUDIT U1). Sections and
 *     games are now a single flat `data` array with sticky headers.
 *  2. Games come from Firestore, not a per-device ESPN poll with a silent mock
 *     fallback (A1, A3).
 *  3. `placeBet` takes `{gameId, side, stake}` and returns a promise. The
 *     server reads the odds and debits the balance; the client no longer knows
 *     how to move credits at all (S2).
 *  4. Real loading, empty and error states instead of a badge that quietly
 *     downgrades to "SAMPLE" (U2).
 */
export default function GamesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { balance, bets, error, clearError } = useApp();
  const { activeLeagues, uid, placeLeagueBet, myLeagueBets } = useLeague();
  const { unreadCount } = useNotifications();
  const { live, upcoming, loading, error: gamesError } = useGames();
  const params = useLocalSearchParams<{ wallet?: string }>();
  const [slipError, setSlipError] = useState<string | null>(null);

  const [sport, setSport] = useState<string>(ALL);
  const [pending, setPending] = useState<{ game: Game; side: Side; key: string } | null>(null);
  const [detail, setDetail] = useState<Game | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 84;

  const openBets =
    bets.filter((b) => b.status === "pending").length +
    Object.values(myLeagueBets).reduce((n, list) => n + list.filter((b) => b.status === "pending").length, 0);

  // One lookup for "do I already have money on this game?", built from the
  // bets the context is already subscribed to. No extra reads.
  const positions = useMemo(() => {
    const map = new Map<string, MyPosition>();
    for (const b of bets) {
      if (b.status !== "pending" || map.has(b.gameId)) continue;
      map.set(b.gameId, { side: b.side, stake: b.stake, potentialPayout: b.potentialPayout });
    }
    return map;
  }, [bets]);

  const rows: Row[] = useMemo(() => {
    const match = (g: Game) => sport === ALL || g.sport === sport;
    const l = live.filter(match);
    const u = upcoming.filter(match);
    const out: Row[] = [];
    if (l.length) {
      out.push({ kind: "section", id: "sec-live", title: "Live now", live: true });
      l.forEach((g) => out.push({ kind: "game", id: g.id, game: g }));
    }
    if (u.length) {
      out.push({ kind: "section", id: "sec-upcoming", title: "Upcoming" });
      u.forEach((g) => out.push({ kind: "game", id: g.id, game: g }));
    }
    return out;
  }, [live, upcoming, sport]);

  // The idempotency key belongs to the *intent*, not to the request. Minting
  // it when the sheet opens means a double tap, a retry, or a remount all
  // resolve to the same bet server-side.
  const openBetSheet = useCallback((game: Game, side: Side) => {
    setSlipError(null);
    setPending({ game, side, key: newIdempotencyKey() });
  }, []);

  // Credits, plus every league that allows this sport and is still running
  // when the game starts — the same checks placeLeagueBet makes.
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
          // A different wallet is a different intent: never reuse the key.
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
      setPending(null);
    },
    [pending, placeLeagueBet]
  );

  // The Firestore listener is already live, so "refresh" is only a UX
  // affordance — it gives the user something to do while the 2-minute server
  // sync catches up. No extra reads are issued.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const team = pending
    ? pending.side === "home"
      ? pending.game.homeTeam
      : pending.game.awayTeam
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Games</Text>
          <View style={styles.headerRight}>
            {openBets > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${openBets} open bets. Open My bets`}
                onPress={() => router.push("/bets")}
                style={[styles.pendingBadge, { backgroundColor: colors.alpha(colors.accent, 0.16), borderColor: colors.alpha(colors.accent, 0.5) }]}
              >
                <Text style={[styles.pendingText, { color: colors.accent }]}>{openBets} open</Text>
              </Pressable>
            )}
            <TokenBalance tokens={balance} />
            <IconButton icon="bell-outline" label="Activity" badge={unreadCount} onPress={() => router.push("/activity")} />
          </View>
        </View>

        <FlatList
          horizontal
          data={[ALL, ...SPORTS]}
          keyExtractor={(x) => x}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => {
            const active = sport === item;
            return (
              <Pressable
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.secondary,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSport(item)}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {error && (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onPress={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error}</Text>
          <MaterialCommunityIcons name="close" size={15} color={colors.destructive} />
        </Pressable>
      )}

      {loading ? (
        <SkeletonList colors={colors} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          stickyHeaderIndices={rows
            .map((r, i) => (r.kind === "section" ? i : -1))
            .filter((i) => i >= 0)}
          renderItem={({ item }) =>
            item.kind === "section" ? (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                {item.live ? (
                  <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
                ) : (
                  <MaterialCommunityIcons name="calendar-clock" size={15} color={colors.mutedForeground} />
                )}
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{item.title}</Text>
              </View>
            ) : (
              <GameCard
                game={item.game}
                onBet={openBetSheet}
                onOpenDetail={setDetail}
                position={positions.get(item.game.id) ?? null}
              />
            )
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <EmptyState
              colors={colors}
              error={gamesError}
              sport={sport}
              onClearFilter={() => setSport(ALL)}
            />
          }
        />
      )}

      {/* Renders nothing while `game` is null, so it can live here unguarded. */}
      <GameDetailSheet
        game={detail}
        onClose={() => setDetail(null)}
        onBet={(game, side) => {
          setDetail(null);
          openBetSheet(game, side);
        }}
        bets={detail ? bets.filter((b) => b.gameId === detail.id) : []}
      />

      {pending && team && (
        <BetModal
          visible
          onClose={() => setPending(null)}
          onConfirm={confirmBet}
          teamName={team.name}
          teamAbbr={team.abbreviation}
          teamColor={team.color}
          odds={team.odds}
          wallets={wallets}
          defaultWallet={params.wallet}
          error={slipError}
          submitting={submitting}
          gameSummary={`${pending.game.awayTeam.abbreviation} @ ${pending.game.homeTeam.abbreviation} · ${pending.game.sport}`}
        />
      )}
    </View>
  );
}

function SkeletonList({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.listContent}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[styles.skeleton, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.skelBar, { backgroundColor: colors.secondary, width: "35%" }]} />
          <View style={styles.skelRow}>
            <View style={[styles.skelBar, { backgroundColor: colors.secondary, flex: 1, height: 46 }]} />
            <View style={[styles.skelBar, { backgroundColor: colors.secondary, flex: 1, height: 46 }]} />
          </View>
        </View>
      ))}
      <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 12 }} />
    </View>
  );
}

function EmptyState({
  colors,
  error,
  sport,
  onClearFilter,
}: {
  colors: ReturnType<typeof useColors>;
  error: string | null;
  sport: string;
  onClearFilter: () => void;
}) {
  const filtered = sport !== ALL;
  return (
    <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <MaterialCommunityIcons
        name={error ? "wifi-off" : "calendar-blank-outline"}
        size={34}
        color={colors.mutedForeground}
      />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {error ? "Can't reach the board" : filtered ? `No ${sport} games right now` : "No games on the board"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {error
          ? "You're offline, or the scores service is down. The board will fill in on its own once you're back."
          : "Fixtures land here as soon as they're scheduled. Check back closer to game day."}
      </Text>
      {filtered && !error && (
        <Pressable
          style={[styles.emptyBtn, { borderColor: colors.border }]}
          onPress={onClearFilter}
        >
          <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Show all sports</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingBottom: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  pendingBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pendingText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  filterList: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  listContent: { padding: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  skeleton: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  skelBar: { height: 12, borderRadius: 6 },
  skelRow: { flexDirection: "row", gap: 10 },
  empty: {
    alignItems: "center",
    gap: 10,
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 24,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  emptyBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  emptyBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

import { adAfterRow } from "@/constants/ads";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useUnseenCount } from "@/lib/settings";
import React, { useDeferredValue, useMemo, useState } from "react";
import ParlayTicket from "@/components/ParlayTicket";
import ChallengeCard from "@/components/ChallengeCard";
import BetRecordPanel, { betNet } from "@/components/BetRecordPanel";
import { Pressable } from "@/components/fx/Tap";
import { useMyFlashPicks, type FlashPick } from "@/hooks/useFlashPicks";
import { useNow } from "@/hooks/useNow";
import { useMyParlays } from "@/hooks/useMyParlays";
import { useToast } from "@/context/ToastContext";
import * as api from "@/lib/api";
import { openGameCenter } from "@/lib/gameCenter";
import { FlatList, StyleSheet, Text, View } from "react-native";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import BetTicket, { type TicketBet } from "@/components/BetTicket";
import GameQuickView from "@/components/GameQuickView";
import { ActionChip, Amount, ConfirmDialog, EmptyState, FilterPills, LoadingState, Pill, ScreenHeader, TabStrip, useBottomPad } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useApp } from "@/context/AppContext";
import { useChallenges, viewOf } from "@/context/ChallengeContext";
import { useLeague } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import { useGames } from "@/hooks/useGames";

type Tab = "open" | "settled";
type Row = { bet: TicketBet; key: string; placed: number; wallet: string | null; leagueId?: string; cancellable: boolean };

/**
 * Every bet you have, in both wallets.
 */
export default function MyBetsScreen() {
  const c = useColors();
  const bottomPad = useBottomPad(false);
  const params = useLocalSearchParams<{ wallet?: string; tab?: Tab }>();
  const { bets, betsLoaded, balance, cancelBet, profile } = useApp();
  const parlays = useMyParlays(profile?.uid);
  const flashPicks = useMyFlashPicks(profile?.uid);
  const { show } = useToast();
  const { leagues, myLeagueBets } = useLeague();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const mounted = useDeferredMount();
  const [tab, setTab] = useState<Tab>(params.tab === "settled" ? "settled" : "open");
  const [wallet, setWallet] = useState<string>(params.wallet ?? "all");
  const deferredTab = useDeferredValue(tab);
  const deferredWallet = useDeferredValue(wallet);
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
    if (!chUid || (deferredWallet !== "all" && deferredWallet !== "credits")) return [];
    const list = deferredTab === "open" ? [...chIn, ...chOut, ...chLive] : chHistory.slice(0, 30);
    return list.map((ch) => viewOf(ch, chUid));
  }, [chUid, deferredWallet, deferredTab, chIn, chOut, chLive, chHistory]);
  const openChallenges = chIn.length + chOut.length + chLive.length;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (deferredWallet === "all" || deferredWallet === "credits") {
      for (const b of bets) out.push({ bet: b, key: b.id, placed: (b.placedAt?.seconds ?? 0) * 1000, wallet: null, cancellable: true });
    }
    for (const lg of leagues) {
      if (deferredWallet !== "all" && deferredWallet !== lg.id) continue;
      for (const b of myLeagueBets[lg.id] ?? []) out.push({ bet: b, key: `${lg.id}:${b.id}`, placed: b.placedAt, wallet: lg.name, leagueId: lg.id, cancellable: false });
    }
    return out.sort((a, b) => b.placed - a.placed);
  }, [bets, leagues, myLeagueBets, deferredWallet]);

  const open = rows.filter((r) => r.bet.status === "pending");
  const settled = rows.filter((r) => r.bet.status !== "pending");
  const shownFlash = useMemo(() => {
    if (deferredWallet !== "all" && deferredWallet !== "credits") return [];
    return flashPicks.filter((p) => (deferredTab === "open" ? p.status === "pending" : p.status !== "pending"));
  }, [flashPicks, deferredWallet, deferredTab]);
  const list = deferredTab === "open" ? open : settled;
  // Red badges count only bets you haven't looked at yet.
  const openIds = useMemo(
    () => [...open.map((r) => r.key), ...flashPicks.filter((p) => p.status === "pending").map((p) => `fp_${p.id}`)],
    [open, flashPicks]
  );
  const settledIds = useMemo(
    () => [...settled.map((r) => r.key), ...flashPicks.filter((p) => p.status !== "pending").map((p) => `fp_${p.id}`)],
    [settled, flashPicks]
  );
  // Everything under Open for this wallet: bets, plus (own wallet) flash picks, parlays and live challenges.
  const ownWallet = deferredWallet === "all" || deferredWallet === "credits";
  const openCount =
    open.length +
    (ownWallet
      ? flashPicks.filter((p) => p.status === "pending").length +
        parlays.filter((p) => p.status === "pending" && !cancelledParlays[p.id]).length +
        openChallenges
      : 0);
  const openNew = useUnseenCount("bets.open", openIds, tab === "open");
  const settledNew = useUnseenCount("bets.settled", settledIds, tab === "settled");
  const won = settled.filter((r) => r.bet.status === "won").length;
  const lost = settled.filter((r) => r.bet.status === "lost").length;
  const pushes = settled.filter((r) => r.bet.status === "push").length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const walletCurrency: "credits" | "league" = leagueFilter ? "league" : "credits";

  const walletStats = useMemo(() => {
    const decided = settled.filter((r) => r.bet.status === "won" || r.bet.status === "lost");
    let streak = 0;
    const first = decided[0]?.bet.status;
    for (const r of decided) {
      if (r.bet.status !== first) break;
      streak++;
    }
    const net = settled.reduce((s, r) => s + betNet(r.bet), 0);
    const bestHit = settled
      .filter((r) => r.bet.status === "won")
      .reduce((m, r) => Math.max(m, r.bet.potentialPayout - r.bet.stake), 0);
    const staked = rows.reduce((s, r) => s + r.bet.stake, 0);
    return {
      streakLabel: first ? `${first === "won" ? "W" : "L"}${streak}` : null,
      streakWin: first === "won",
      net,
      bestHit,
      staked,
      recordBets: settled.map((r) => ({
        status: r.bet.status,
        stake: r.bet.stake,
        potentialPayout: r.bet.potentialPayout,
        t: r.placed,
      })),
    };
  }, [rows, settled]);

  const wallets = [
    { id: "all", label: "All" },
    { id: "credits", label: "Credits" },
    ...leagues.map((l) => ({ id: l.id, label: l.name })),
  ];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ObsidianBackdrop />
      <ScreenHeader
        back
        title="My Bets"
        subtitle={`${won}W · ${lost}L${pushes ? ` · ${pushes}P` : ""}${winRate !== null ? ` · ${winRate}% hit rate` : ""}`}
        right={<Amount value={balance} animate />}
      >
        <View style={styles.statsDrawer}>
          <BetRecordPanel bets={walletStats.recordBets} compact currency={walletCurrency} />
          <View style={styles.bentoStatsRow}>
            <View
              style={[
                styles.bentoStatCard,
                {
                  flex: 1.15,
                  backgroundColor: c.isDark ? (walletStats.net >= 0 ? "#102420" : "#26121A") : c.card,
                  borderColor: c.isDark
                    ? walletStats.net >= 0
                      ? "rgba(82, 224, 160, 0.42)"
                      : "rgba(251, 113, 133, 0.42)"
                    : c.border,
                },
              ]}
            >
              <GlassDomeSheen id="bets_net" glowColor={walletStats.net >= 0 ? "#34D399" : "#FB7185"} intensity={0.38} />
              <Text style={[styles.bentoKicker, { color: c.mutedForeground }]}>NET PROFIT</Text>
              <Amount
                value={walletStats.net}
                currency={walletCurrency}
                size="md"
                signed
                tone={walletStats.net > 0 ? "positive" : walletStats.net < 0 ? "negative" : "neutral"}
              />
            </View>
            <View
              style={[
                styles.bentoStatCard,
                {
                  flex: 1,
                  backgroundColor: c.isDark ? "#121E34" : c.card,
                  borderColor: c.isDark ? "rgba(130, 182, 250, 0.40)" : c.border,
                },
              ]}
            >
              <GlassDomeSheen id="bets_hit" glowColor="#60A5FA" intensity={0.34} />
              <Text style={[styles.bentoKicker, { color: c.mutedForeground }]}>BEST HIT · STAKED</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {walletStats.bestHit > 0 ? (
                  <Amount value={walletStats.bestHit} currency={walletCurrency} size="sm" signed tone="positive" />
                ) : (
                  <Text style={[styles.summaryDash, { color: c.foreground }]}>—</Text>
                )}
                <Text style={[styles.stakedMini, { color: c.subtleForeground }]} numberOfLines={1}>
                  / {walletStats.staked.toLocaleString()}
                </Text>
              </View>
            </View>
          </View>
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
            { value: "open", label: openCount > 0 ? `Open (${openCount})` : "Open", badge: openNew || undefined },
            { value: "settled", label: "Settled", badge: settledNew || undefined },
          ]}
        />
      </ScreenHeader>

      {!mounted ? (
        <View style={styles.list}><LoadingState label="Loading your bets…" /></View>
      ) : (
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
              {shownFlash.map((fp) => (
                <FlashPickTicket
                  key={`fp_${fp.id}`}
                  pick={fp}
                  game={gameById.get(fp.gameId) ?? null}
                  onOpen={() => openGameCenter(fp.gameId, "live")}
                />
              ))}
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
          (shownFlash.length > 0 || challengeViews.length > 0 || parlays.some((p) => (tab === "open" ? p.status === "pending" : p.status !== "pending"))) && (wallet === "all" || wallet === "credits") ? undefined : !betsLoaded ? (
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
      )}
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

function FlashPickTicket({
  pick,
  game,
  onOpen,
}: {
  pick: FlashPick;
  game: ReturnType<typeof useGames>["games"][number] | null;
  onOpen: () => void;
}) {
  const c = useColors();
  const pending = pick.status === "pending";
  const won = pick.status === "won";
  const lost = pick.status === "lost";
  const stake = pick.stake ?? 0;
  const matchup = game
    ? `${game.awayTeam.abbreviation} ${game.awayScore ?? 0} – ${game.homeScore ?? 0} ${game.homeTeam.abbreviation}`
    : pick.sport ?? "Live Game";
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}>
      <LiquidGlass
        variant="card"
        borderColor={pending ? c.alpha(c.live, 0.5) : won ? c.alpha(c.positive, 0.45) : undefined}
        borderWidth={pending ? 1.25 : 1}
        contentStyle={styles.flashCard}
      >
        <View style={styles.flashHead}>
          <View style={[styles.flashBadge, { backgroundColor: c.alpha(c.live, 0.16) }]}>
            <MaterialCommunityIcons name="flash" size={12} color={c.live} />
            <Text style={[styles.flashBadgeText, { color: c.live }]}>LIVE BET</Text>
          </View>
          {pick.sport ? <Text style={[styles.flashMeta, { color: c.mutedForeground }]}>{pick.sport}</Text> : null}
          <View style={{ marginLeft: "auto" }}>
            <Pill
              label={pending ? "LIVE" : won ? "WON" : lost ? "LOST" : "PUSH"}
              tone={pending ? "accent" : won ? "positive" : lost ? "negative" : "neutral"}
            />
          </View>
        </View>
        <View style={styles.flashBody}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.flashTitle, { color: c.foreground }]} numberOfLines={1}>
              {pick.teamAbbr} to score next
            </Text>
            <Text style={[styles.flashMeta, { color: c.mutedForeground }]} numberOfLines={1}>
              {matchup} · {stake > 0 ? `Stake ${stake.toLocaleString()} (${pick.odds ?? 1.91}x)` : "Free daily pick"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={[
                styles.flashPayout,
                { color: won ? c.positive : lost ? c.negative : "#FCE092" },
              ]}
            >
              {lost && stake > 0 ? `-${stake.toLocaleString()}` : lost ? "0" : `+${pick.reward.toLocaleString()}`}
            </Text>
            <Text style={[styles.flashMeta, { color: c.subtleForeground }]}>
              {pending ? "to win" : won ? "won" : lost ? "missed" : stake > 0 ? "refunded" : "push"}
            </Text>
          </View>
        </View>
      </LiquidGlass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flashCard: { padding: 13, gap: 8 },
  flashHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  flashBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  flashBadgeText: { fontSize: 10.5, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7 },
  flashBody: { flexDirection: "row", alignItems: "center", gap: 10 },
  flashTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },
  flashMeta: { fontSize: 12, fontFamily: "Inter_500Medium", fontVariant: ["tabular-nums"] },
  flashPayout: { fontSize: 16, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", gap: 8 },
  statsDrawer: { gap: 8 },
  bentoStatsRow: { flexDirection: "row", gap: 8 },
  bentoStatCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4, overflow: "hidden" },
  bentoKicker: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 },
  stakedMini: { fontSize: 11.5, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summaryDash: { fontSize: 15, fontFamily: "Inter_700Bold" },
  chips: { gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, maxWidth: 180 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16 },
});

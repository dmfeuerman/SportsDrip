import BackToLevels from "@/components/BackToLevels";
import { TourTarget } from "@/components/tour/TourTarget";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import CreateLeagueModal from "@/components/CreateLeagueModal";
import JoinLeagueSheet from "@/components/JoinLeagueSheet";
import { Amount, Button, Card, EmptyState, ErrorBanner, Pill, ScreenHeader, SectionHeader, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useLeague, useLeagueSummaries, type LeagueSummary } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { useLatestActivity } from "@/hooks/useLatestActivity";

/**
 * Leagues overview — now a tab of its own.
 *
 * Each card answers what you'd otherwise have to open the league for: your
 * rank and net worth, the field size, the pot, time left, and the last thing
 * that happened. Tap through for standings, bets, the bank and the feed.
 */
export default function LeaguesScreen() {
  const c = useColors();
  const bottom = useBottomPad();
  const params = useLocalSearchParams<{ create?: string; join?: string; code?: string; via?: string; t?: string }>();
  const { balance } = useApp();
  const { leagues, createLeague, joinLeague, error, clearError, ready } = useLeague();
  const { summaries } = useLeagueSummaries();
  const latest = useLatestActivity(leagues.filter((l) => l.status === "active").map((l) => l.id));

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => {
    if (params.create) setShowCreate(true);
    if (params.join || params.code) setShowJoin(true);
  }, [params.create, params.join, params.code, params.t]);

  const active = summaries.filter((s) => !s.closed);
  const closed = summaries.filter((s) => s.closed);

  const rows: Array<{ kind: "header"; title: string } | { kind: "league"; s: LeagueSummary }> = [
    ...active.map((s) => ({ kind: "league" as const, s })),
    ...(closed.length ? [{ kind: "header" as const, title: "Closed" }] : []),
    ...closed.map((s) => ({ kind: "league" as const, s })),
  ];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        leading={<BackToLevels />}
        title="Leagues"
        subtitle={active.length ? `${active.length} running` : "Season-long competitions with friends"}
        right={
          <>
            <TourTarget id="leagues.join"><Button label="Join" size="sm" variant="secondary" icon="key-variant" onPress={() => setShowJoin(true)} /></TourTarget>
            <TourTarget id="leagues.new"><Button label="New" size="sm" icon="plus" onPress={() => setShowCreate(true)} /></TourTarget>
          </>
        }
      />
      <ErrorBanner message={error} onDismiss={clearError} />

      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === "league" ? r.s.league.id : `h${i}`)}
        contentContainerStyle={[styles.list, { paddingBottom: bottom }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) =>
          item.kind === "header" ? (
            index === 0 ? <TourTarget id="leagues.list"><SectionHeader title={item.title} /></TourTarget> : <SectionHeader title={item.title} />
          ) : (
            <LeagueCard s={item.s} latest={latest[item.s.league.id]?.text} />
          )
        }
        ListEmptyComponent={
          ready ? (
            <View style={{ gap: 12 }}>
              <TourTarget id="leagues.list">
              <EmptyState
                icon="trophy-outline"
                title="No Leagues Yet"
                body="Everyone starts a season with the same stack of league tokens. Bet them, borrow from the bank or each other, and the best net worth when the clock runs out takes the pot."
                action="Start a League"
                onAction={() => setShowCreate(true)}
                secondary="Join With a Code"
                onSecondary={() => setShowJoin(true)}
              />
              </TourTarget>
              <Card>
                <Text style={[styles.howTitle, { color: c.foreground }]}>How Leagues Work</Text>
                {[
                  ["shield-star", "League tokens are separate from your credits."],
                  ["scale-balance", "Ranked on net worth: tokens, plus what you're owed, minus what you owe."],
                  ["bank-outline", "Loans charge one flat fee — borrow 100 at 10%, repay 110. Never more."],
                  ["trophy-outline", "Buy-ins form a pot, paid out in credits when the season ends."],
                ].map(([icon, text]) => (
                  <View key={text} style={styles.howRow}>
                    <MaterialCommunityIcons name={icon as never} size={16} color={c.league} />
                    <Text style={[styles.howText, { color: c.mutedForeground }]}>{text}</Text>
                  </View>
                ))}
              </Card>
            </View>
          ) : undefined
        }
      />

      <CreateLeagueModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        yourTokens={balance}
        onConfirm={async (name, startingLeagueTokens, duration, sports, buyIn, prizeDistribution, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours, mode, matchupsEnabled, matchupCadence, stimulusEnabled, bracketTemplateId, startsAt) => {
          const res = await createLeague({ name, startingLeagueTokens, duration, sports, buyIn, prizeDistribution, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours, mode, matchupsEnabled, matchupCadence, stimulusEnabled, bracketTemplateId, startsAt });
          if ("error" in res) return res.error;
          buzz.success();
          router.push({ pathname: "/league/[id]", params: { id: res.leagueId, created: "1" } });
          return null;
        }}
      />
      <JoinLeagueSheet
        visible={showJoin}
        initialCode={params.code}
        balance={balance}
        onClose={() => setShowJoin(false)}
        onJoin={async (code) => {
          const res = await joinLeague(code, params.via === "link" ? "link" : params.via === "notification" ? "notification" : "code");
          if ("error" in res) return res.error;
          buzz.success();
          setShowJoin(false);
          router.push({ pathname: "/league/[id]", params: { id: res.leagueId } });
          return null;
        }}
      />
    </View>
  );
}

function LeagueCard({ s, latest }: { s: LeagueSummary; latest?: string }) {
  const c = useColors();
  const { league, me } = s;
  const closed = s.closed;
  const total = Math.max(1, league.endsAt - league.createdAt);
  const progress = closed ? 1 : Math.min(1, Math.max(0, (Date.now() - league.createdAt) / total));
  const leader = s.standings[0];
  const leaderName = leader ? league.members[leader.uid]?.displayName ?? league.results?.find((r) => r.memberId === leader.uid)?.memberName : null;

  return (
    <Card
      onPress={() => router.push({ pathname: "/league/[id]", params: { id: league.id } })}
      accessibilityLabel={`${league.name}${closed ? ", closed" : ""}. You're ranked ${me?.rank ?? "unranked"} of ${s.memberCount}.`}
      tone={me?.rank === 1 && !closed ? "money" : undefined}
      style={styles.card}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {league.name}
          </Text>
          <View style={styles.pills}>
            <Pill label={closed ? "Closed" : `${s.daysLeft}d left`} tone={closed ? "neutral" : "accent"} icon={closed ? "lock-outline" : "clock-outline"} />
            <Pill label={`${s.memberCount} ${s.memberCount === 1 ? "player" : "players"}`} icon="account-multiple" />
            {league.mode && league.mode !== "bankroll" ? (
              <Pill label={league.mode === "pickem" ? "Pick'em" : "Survivor"} tone="league" icon={league.mode === "pickem" ? "checkbox-marked-circle-outline" : "skull-outline"} />
            ) : null}
            {league.pot > 0 && <Pill label={`${league.pot.toLocaleString()} pot`} tone="money" icon="trophy" />}
          </View>
        </View>
        <View style={styles.rankBox}>
          <Text style={[styles.rankBig, { color: me?.rank === 1 ? c.primary : c.foreground }]}>#{me?.rank ?? "–"}</Text>
          <Text style={[styles.rankOf, { color: c.mutedForeground }]}>of {s.memberCount}</Text>
        </View>
      </View>

      <View style={styles.cardStats}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.k, { color: c.subtleForeground }]}>NET WORTH</Text>
          <Amount value={me?.netWorth ?? 0} currency="league" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.k, { color: c.subtleForeground }]}>{me && me.debt > 0 ? "YOU OWE" : "LEADER"}</Text>
          {me && me.debt > 0 ? (
            <Amount value={me.debt} currency="league" tone="debt" />
          ) : (
            <Text style={[styles.v, { color: c.foreground }]} numberOfLines={1}>
              {leader?.uid === me?.uid ? "You" : leaderName ?? "—"}
            </Text>
          )}
        </View>
      </View>

      {!closed && (
        <View style={[styles.track, { backgroundColor: c.secondary }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: c.league }]} />
        </View>
      )}
      {latest ? (
        <Text style={[styles.latest, { color: c.mutedForeground }]} numberOfLines={1}>
          {latest}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12 },
  card: { gap: 12 },
  cardTop: { flexDirection: "row", gap: 12 },
  name: { fontSize: 17, fontFamily: "Inter_700Bold" },
  pills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  rankBox: { alignItems: "flex-end" },
  rankBig: { fontSize: 30, lineHeight: 34, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"], letterSpacing: -0.6 },
  rankOf: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardStats: { flexDirection: "row", gap: 12 },
  k: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 2 },
  v: { fontSize: 15, fontFamily: "Inter_700Bold" },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  latest: { fontSize: 12, fontFamily: "Inter_400Regular" },
  howTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 8 },
  howRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 },
  howText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
});

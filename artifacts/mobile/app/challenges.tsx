import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import ChallengeCard from "@/components/ChallengeCard";
import GameQuickView from "@/components/GameQuickView";
import { Amount, ConfirmDialog, EmptyState, ErrorBanner, IconButton, ScreenHeader, StatTile, TabStrip, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useChallenges, viewOf, type ChallengeView } from "@/context/ChallengeContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useGames } from "@/hooks/useGames";
import { useNow } from "@/hooks/useNow";

type Tab = "inbox" | "live" | "history";

/**
 * Every head-to-head with a friend: offers waiting on you (and on them),
 * accepted pots riding on a game, and what's been settled.
 */
export default function ChallengesScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const now = useNow(30_000);
  const params = useLocalSearchParams<{ tab?: string }>();
  const { balance } = useApp();
  const { uid, incoming, outgoing, live, history, escrowed, respond, cancel } = useChallenges();
  const { show } = useToast();
  const { games } = useGames();
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const [tab, setTab] = useState<Tab>(params.tab === "live" || params.tab === "history" ? params.tab : incoming.length || outgoing.length || !live.length ? "inbox" : "live");
  const [busy, setBusy] = useState<{ id: string; action: "accept" | "decline" | "cancel" } | null>(null);
  const [confirm, setConfirm] = useState<ChallengeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickGame, setQuickGame] = useState<string | null>(null);

  const views = (list: typeof incoming) => (uid ? list.map((ch) => viewOf(ch, uid)) : []);
  const inV = views(incoming);
  const outV = views(outgoing);
  const liveV = views(live);
  const histV = views(history);

  const record = useMemo(() => {
    const r = { won: 0, lost: 0, net: 0 };
    for (const v of histV) {
      if (v.result === "won") {
        r.won++;
        r.net += v.theirStake;
      } else if (v.result === "lost") {
        r.lost++;
        r.net -= v.myStake;
      }
    }
    return r;
  }, [histV]);

  async function accept(v: ChallengeView) {
    setBusy({ id: v.ch.id, action: "accept" });
    setError(null);
    const res = await respond(v.ch.id, true);
    setBusy(null);
    setConfirm(null);
    if (res.error) {
      buzz.error();
      setError(res.error);
      return;
    }
    if (res.status === "expired") {
      show({ kind: "warning", icon: "timer-sand", title: "Too late", body: "That game has started, so the challenge expired. Nothing was taken." });
      return;
    }
    buzz.success();
    show({
      id: `chacc_${v.ch.id}`,
      kind: "social",
      icon: "sword-cross",
      color: v.myTeam.color,
      title: `You're on with ${v.friendName}`,
      body: `${v.ch.pot.toLocaleString()} locked in the pot. ${v.myTeam.abbreviation} wins it for you.`,
    });
    setTab("live");
  }

  async function decline(v: ChallengeView) {
    setBusy({ id: v.ch.id, action: "decline" });
    setError(null);
    const res = await respond(v.ch.id, false);
    setBusy(null);
    if (res.error) setError(res.error);
  }

  async function withdraw(v: ChallengeView) {
    setBusy({ id: v.ch.id, action: "cancel" });
    setError(null);
    const err = await cancel(v.ch.id);
    setBusy(null);
    if (err) setError(err);
  }

  const card = (v: ChallengeView) => (
    <ChallengeCard
      key={v.ch.id}
      view={v}
      game={gameById.get(v.ch.gameId) ?? null}
      now={now}
      busy={busy?.id === v.ch.id ? busy.action : null}
      onOpen={() => setQuickGame(v.ch.gameId)}
      onAccept={() => setConfirm(v)}
      onDecline={() => void decline(v)}
      onCancel={() => void withdraw(v)}
    />
  );

  const findFriends = () => router.navigate("/(tabs)/friends");
  const browse = () => router.navigate("/(tabs)/games");

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title="Challenges"
        subtitle={`${record.won}W · ${record.lost}L against friends`}
        right={<IconButton icon="account-multiple-plus-outline" label="Challenge a friend" onPress={findFriends} />}
      >
        <View style={styles.stats}>
          <StatTile label="Credits" hint="free to use">
            <Amount value={balance} size="sm" />
          </StatTile>
          <StatTile label="In pots" hint={`${outV.length + liveV.length} open`}>
            <Amount value={escrowed} size="sm" tone="neutral" />
          </StatTile>
          <StatTile label="Net vs friends" hint="settled">
            <Amount value={record.net} size="sm" signed tone={record.net > 0 ? "positive" : record.net < 0 ? "negative" : "neutral"} />
          </StatTile>
        </View>
        <TabStrip
          value={tab}
          onChange={setTab}
          options={[
            { value: "inbox", label: "Inbox", badge: inV.length },
            { value: "live", label: "Locked in", badge: liveV.length },
            { value: "history", label: "History" },
          ]}
        />
      </ScreenHeader>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {tab === "inbox" ? (
          inV.length + outV.length === 0 ? (
            <EmptyState
              icon="sword-cross"
              title="No challenges waiting"
              body="Pick a game, tap a team, and switch the slip to “Challenge a friend”. Pot or your own odds — both stakes are locked in before kickoff."
              action="Browse games"
              onAction={browse}
              secondary="Pick a friend"
              onSecondary={findFriends}
            />
          ) : (
            <>
              {inV.length > 0 && <Text style={[styles.section, { color: c.foreground }]}>Waiting on you</Text>}
              {inV.map(card)}
              {outV.length > 0 && <Text style={[styles.section, { color: c.foreground }]}>Waiting on them</Text>}
              {outV.map(card)}
            </>
          )
        ) : tab === "live" ? (
          liveV.length === 0 ? (
            <EmptyState icon="lock-outline" title="Nothing locked in" body="Accepted challenges sit here until the final whistle. The pot pays out on its own." action="Browse games" onAction={browse} />
          ) : (
            liveV.map(card)
          )
        ) : histV.length === 0 ? (
          <EmptyState icon="history" title="No history yet" body="Settled challenges, and any that were declined or expired, land here." />
        ) : (
          histV.map(card)
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!confirm}
        title={confirm ? `Accept ${confirm.friendName}'s challenge?` : ""}
        body={
          confirm
            ? `You put ${confirm.myStake.toLocaleString()} credits on ${confirm.myTeam.name} (${confirm.myOdds.toFixed(2)}x). ${confirm.friendName} already has ${confirm.theirStake.toLocaleString()} on ${confirm.theirTeam.abbreviation}. Once you accept, the ${confirm.ch.pot.toLocaleString()} pot is locked — neither of you can back out — and the winner is paid when the game is final.`
            : ""
        }
        confirmLabel={confirm ? `Lock in ${confirm.myStake.toLocaleString()}` : "Accept"}
        busy={busy?.action === "accept"}
        error={confirm && confirm.myStake > balance ? `You have ${balance.toLocaleString()} credits — not enough to cover this.` : null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void accept(confirm)}
      />

      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stats: { flexDirection: "row", gap: 8 },
  list: { padding: 16 },
  section: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 10, marginTop: 4 },
});

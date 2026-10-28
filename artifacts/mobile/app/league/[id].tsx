import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import NumericInput from "@/components/NumericInput";
import LoanCard from "@/components/LoanCard";
import Shimmer from "@/components/fx/Shimmer";
import MemberAvatar from "@/components/MemberAvatar";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import GameQuickView from "@/components/GameQuickView";
import TeamChips from "@/components/TeamChips";
import {
  Amount,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  IconButton,
  Pill,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  StatTile,
  useBottomPad,
} from "@/components/ui";
import {
  BANK_PRINCIPAL_CAP_MULTIPLIER,
  isLeagueClosed,
  PEER_LOAN_MAX_PCT,
  PEER_LOAN_REQUESTS_ENABLED,
  PRIZE_PRESETS,
  type League,
  type LeagueBet,
  type LeagueLoan,
} from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { useLeague, useLeagueDetail } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import { usePublicProfiles } from "@/hooks/usePublicProfiles";
import { flatInterest, loanSnapshot, prizeSplit, type Standing } from "@/lib/loanMath";

type Tab = "standings" | "bets" | "bank" | "feed" | "info";

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * One league: standings, every member's bets, the bank and peer loans, the
 * feed, and the rules. Switch leagues from the chip row without backing out.
 */
export default function LeagueDetailScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const params = useLocalSearchParams<{ id: string; tab?: Tab; created?: string }>();
  const { leagues, getLeague, uid, error, clearError } = useLeague();
  const league = getLeague(params.id);
  const detail = useLeagueDetail(league);
  const [tab, setTab] = useState<Tab>(params.tab ?? "standings");

  if (!league) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScreenHeader back title="League" />
        <View style={{ padding: 16 }}>
          <EmptyState icon="trophy-broken" title="League not found" body="You may have left it, or it's still loading." action="All leagues" onAction={() => router.navigate("/(tabs)/leagues")} />
        </View>
      </View>
    );
  }

  const me = detail.standings.find((s) => s.uid === uid) ?? null;
  const myTokens = uid ? league.members[uid]?.leagueTokens ?? 0 : 0;
  const ended = league.status === "ended";
  // Read-only from here on: ended by the server, or past endsAt awaiting the sweep.
  const closed = isLeagueClosed(league, detail.now);
  const daysLeft = Math.max(0, Math.ceil((league.endsAt - detail.now) / 86_400_000));
  const pendingRequests = closed
    ? 0
    : detail.loans.filter((l) => l.kind === "peer" && (l.status === "requested" || l.status === "countered") && l.borrowerId !== uid).length;

  const invite = () => {
    if (closed) return;
    Share.share({
      message: `Join my "${league.name}" league on SportDrip — code ${league.code}`,
      title: "Join my league",
    }).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title={league.name}
        subtitle={closed ? "Closed · read-only" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · code ${league.code}`}
        right={closed ? <Pill label="Closed" tone="neutral" icon="lock-outline" /> : <IconButton icon="account-plus-outline" label="Invite" onPress={invite} />}
      >
        {leagues.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {leagues.map((l) => {
              const on = l.id === league.id;
              return (
                <Pressable
                  key={l.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => router.setParams({ id: l.id })}
                  style={[styles.switch, { backgroundColor: on ? c.leagueSoft : c.secondary, borderColor: on ? c.league : c.border }]}
                >
                  <Text style={[styles.switchText, { color: on ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                    {l.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <View style={styles.hero}>
          <StatTile label="Rank">
            <Text style={[styles.heroRank, { color: me?.rank === 1 ? c.primary : c.foreground }]}>
              #{me?.rank ?? "–"}
              <Text style={[styles.heroOf, { color: c.mutedForeground }]}> /{detail.standings.length}</Text>
            </Text>
          </StatTile>
          <StatTile label="Net worth">
            <Amount value={me?.netWorth ?? myTokens} currency="league" size="sm" />
          </StatTile>
          <StatTile label={me && me.debt > 0 ? "You owe" : "Tokens"}>
            <Amount value={me && me.debt > 0 ? me.debt : myTokens} currency="league" size="sm" tone={me && me.debt > 0 ? "debt" : undefined} />
          </StatTile>
        </View>
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "standings", label: "Table" },
            { value: "bets", label: "Bets" },
            { value: "bank", label: "Loans", badge: pendingRequests || undefined },
            { value: "feed", label: "Feed" },
            { value: "info", label: "Info" },
          ]}
        />
      </ScreenHeader>
      <ErrorBanner message={error} onDismiss={clearError} />

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.body, { paddingBottom: bottom + (closed ? 0 : 72) }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={closed ? 16 : 88}
      >
        {closed && (
          <Card style={styles.closedBanner} accessibilityLabel="This league is closed. You can view its history, but nothing can be changed.">
            <MaterialCommunityIcons name="lock-outline" size={18} color={c.mutedForeground} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.cardTitle, { color: c.foreground }]}>League closed</Text>
              <Text style={[styles.muted, { color: c.mutedForeground }]}>
                {ended ? "The season is over." : "The season is over — final results are being tallied."} Standings, bets, loans and the feed are view-only.
              </Text>
            </View>
          </Card>
        )}
        {!closed && params.created && league.memberIds.length === 1 && tab === "standings" && (
          <Card tone="league" style={{ gap: 8 }}>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>League created</Text>
            <Text style={[styles.muted, { color: c.mutedForeground }]}>Share code {league.code} or invite friends below. Everyone starts with {league.startingLeagueTokens.toLocaleString()} tokens.</Text>
          </Card>
        )}
        {tab === "standings" && <StandingsTab league={league} standings={detail.standings} uid={uid} closed={closed} onInvite={invite} />}
        {tab === "bets" && <BetsTab bets={detail.bets} uid={uid} leagueId={closed ? undefined : league.id} />}
        {tab === "bank" && <BankTab league={league} loans={detail.loans} uid={uid} me={me} tokens={myTokens} now={detail.now} closed={closed} />}
        {tab === "feed" && (
          <Card style={{ padding: 0 }}>
            {detail.activity.length === 0 ? (
              <Text style={[styles.muted, { color: c.mutedForeground, padding: 16 }]}>Nothing yet.</Text>
            ) : (
              detail.activity.map((a, i) => (
                <View key={a.id} style={[styles.feedRow, i < detail.activity.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
                  <MaterialCommunityIcons name={FEED_ICON[a.type] ?? "circle-small"} size={18} color={a.type === "bet_won" ? c.positive : a.type === "bet_lost" ? c.negative : c.mutedForeground} />
                  <Text style={[styles.feedText, { color: c.foreground }]}>{a.text}</Text>
                  <Text style={[styles.feedTime, { color: c.subtleForeground }]}>{ago(a.at, detail.now)}</Text>
                </View>
              ))
            )}
          </Card>
        )}
        {tab === "info" && <InfoTab league={league} uid={uid} closed={closed} />}
      </KeyboardAwareScrollViewCompat>

      {!closed && (
        <View style={[styles.dock, { backgroundColor: c.background, borderTopColor: c.border, paddingBottom: bottom - 12 }]}>
          <Button
            label={`Bet with ${myTokens.toLocaleString()} league tokens`}
            icon="ticket-outline"
            variant="league"
            size="lg"
            onPress={() => router.navigate({ pathname: "/(tabs)/games", params: { wallet: league.id } })}
          />
        </View>
      )}
    </View>
  );
}

const FEED_ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  created: "flag-outline",
  joined: "account-plus-outline",
  left: "account-minus-outline",
  bet_placed: "ticket-outline",
  bet_won: "arrow-up-bold",
  bet_lost: "arrow-down-bold",
  bet_push: "minus",
  bank_loan: "bank-outline",
  loan_request: "hand-coin-outline",
  loan_funded: "handshake-outline",
  repayment: "cash-refund",
  settings: "cog-outline",
  ended: "trophy",
};

// ── Standings ──────────────────────────────────────────────────────────────

const GOLD = "#F5C542";
const SILVER = "#C9D1CC";
const BRONZE = "#C4703B";

function StandingsTab({ league, standings, uid, closed, onInvite }: { league: League; standings: Standing[]; uid: string | null; closed: boolean; onInvite: () => void }) {
  const c = useColors();
  const { byId } = useCatalog();
  const { profile: myProfile } = useApp();
  const fetched = usePublicProfiles(standings.map((s) => s.uid));
  // Your own card reads the live profile, so a favourite-team edit shows at
  // once instead of after the public-profile cache expires.
  const profiles = useMemo(() => {
    if (!myProfile || !fetched[myProfile.uid]) return fetched;
    return { ...fetched, [myProfile.uid]: { ...fetched[myProfile.uid]!, favoriteTeams: myProfile.favoriteTeams ?? [] } };
  }, [fetched, myProfile]);
  const prizes = prizeSplit(league.pot, league.prizeDistribution, standings.length);
  const ended = league.status === "ended";
  const mine = league.results?.find((r) => r.memberId === uid);
  const [openUid, setOpenUid] = useState<string | null>(null);

  const info = (s: Standing) => {
    const m = league.members[s.uid];
    const r = league.results?.find((x) => x.memberId === s.uid);
    return {
      m,
      r,
      name: m?.displayName ?? r?.memberName ?? "Player",
      color: m?.avatarColor ?? r?.memberColor ?? c.mutedForeground,
      you: s.uid === uid,
      prize: prizes[s.rank - 1] ?? 0,
    };
  };

  const leader = standings[0]?.rank === 1 ? standings[0] : undefined;
  const rest = leader ? standings.slice(1) : standings;
  const opened = openUid ? standings.find((s) => s.uid === openUid) : undefined;
  const openedInfo = opened ? info(opened) : undefined;

  return (
    <View style={{ gap: 10 }}>
      {ended && mine && (
        <Card tone={mine.prizeTokens > 0 ? "money" : undefined} style={{ gap: 6 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>
            {mine.rank === 1 ? "Champion." : `You finished #${mine.rank} of ${league.results!.length}`}
          </Text>
          {mine.prizeTokens > 0 ? (
            <View style={styles.inline}>
              <Amount value={mine.prizeTokens} signed tone="positive" />
              <Text style={[styles.muted, { color: c.mutedForeground }]}>{mine.paid ? "paid to your credits" : "paying out…"}</Text>
            </View>
          ) : (
            <Text style={[styles.muted, { color: c.mutedForeground }]}>No prize this season. Net worth {(mine.netWorth ?? mine.leagueTokens).toLocaleString()}.</Text>
          )}
        </Card>
      )}

      {leader && (() => {
        const L = info(leader);
        const p = profiles[leader.uid];
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`First place, ${L.you ? "you" : L.name}, net worth ${leader.netWorth.toLocaleString()}. Open profile`}
            onPress={() => setOpenUid(leader.uid)}
            style={({ pressed }) => [styles.champ, { backgroundColor: c.card, borderColor: c.alpha(GOLD, 0.7), shadowColor: GOLD, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
          >
            <LinearGradient
              colors={[c.alpha(GOLD, 0.26), c.alpha(GOLD, 0.06), "transparent"] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {/* A slow gold glint: first place should look like first place. */}
            <Shimmer color={GOLD} intensity={0.22} every={3400} sweep={1300} />
            <View style={styles.champTop}>
              <View style={[styles.champBadge, { backgroundColor: GOLD }]}>
                <MaterialCommunityIcons name="crown" size={13} color="#2A1E00" />
                <Text style={styles.champBadgeText}>{closed ? "CHAMPION" : "1ST PLACE"}</Text>
              </View>
              <View style={{ flex: 1 }} />
              {L.prize > 0 && !closed ? <Pill label={`${L.prize.toLocaleString()} pot share`} tone="money" icon="trophy" /> : null}
              {L.r && L.r.prizeTokens > 0 ? <Pill label={`won ${L.r.prizeTokens.toLocaleString()}`} tone="money" icon="trophy" /> : null}
            </View>
            <View style={styles.champMain}>
              <MemberAvatar profile={p} name={L.name} color={L.color} catalog={byId} size={78} ring={GOLD} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.inline}>
                  <Text style={[styles.champName, { color: c.foreground }]} numberOfLines={1}>
                    {L.name}
                  </Text>
                  {L.you && <Pill label="YOU" tone="league" />}
                </View>
                <TeamChips teams={p?.favoriteTeams} compact max={3} />
                <Text style={[styles.memberSub, { color: c.mutedForeground }]} numberOfLines={1}>
                  {L.m ? `${L.m.betsWon}–${L.m.betsLost} record` : ""}
                  {leader.debt > 0 ? ` · owes ${leader.debt.toLocaleString()}` : ""}
                  {leader.receivable > 0 ? ` · owed ${leader.receivable.toLocaleString()}` : ""}
                </Text>
              </View>
            </View>
            <View style={[styles.champStats, { borderTopColor: c.alpha(GOLD, 0.25) }]}>
              <View style={{ flex: 1.4 }}>
                <Text style={[styles.champK, { color: c.subtleForeground }]}>NET WORTH</Text>
                <Amount value={leader.netWorth} currency="league" size="lg" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.champK, { color: c.subtleForeground }]}>LEAD</Text>
                <Text style={[styles.champV, { color: c.foreground }]}>
                  {standings[1] ? `+${Math.max(0, leader.netWorth - standings[1].netWorth).toLocaleString()}` : "—"}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={c.mutedForeground} />
            </View>
          </Pressable>
        );
      })()}

      <Text style={[styles.muted, { color: c.mutedForeground }]}>
        Ranked by net worth — tokens, plus what you're owed, minus what you owe. Tap anyone for their stats and bets.
      </Text>
      {rest.map((s) => {
        const R = info(s);
        const p = profiles[s.uid];
        const rankColor = s.rank === 1 ? GOLD : s.rank === 2 ? SILVER : s.rank === 3 ? BRONZE : c.mutedForeground;
        return (
          <Pressable
            key={s.uid}
            accessibilityRole="button"
            accessibilityLabel={`Rank ${s.rank}, ${R.you ? "you" : R.name}, net worth ${s.netWorth.toLocaleString()}${s.debt ? `, owes ${s.debt.toLocaleString()}` : ""}. Open profile`}
            onPress={() => setOpenUid(s.uid)}
            style={({ pressed }) => [styles.member, { backgroundColor: R.you ? c.leagueSoft : c.card, borderColor: R.you ? c.alpha(c.league, 0.5) : c.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.rankNum, { color: rankColor }]}>{s.rank}</Text>
            <MemberAvatar profile={p} name={R.name} color={R.color} catalog={byId} size={40} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.inline}>
                <Text style={[styles.memberName, { color: c.foreground }]} numberOfLines={1}>
                  {R.name}
                </Text>
                {R.you && <Pill label="YOU" tone="league" />}
              </View>
              <TeamChips teams={p?.favoriteTeams} compact max={3} />
              <Text style={[styles.memberSub, { color: c.mutedForeground }]} numberOfLines={2}>
                {s.tokens.toLocaleString()} tokens
                {s.debt > 0 ? ` · owes ${s.debt.toLocaleString()}` : ""}
                {s.receivable > 0 ? ` · owed ${s.receivable.toLocaleString()}` : ""}
                {R.m ? ` · ${R.m.betsWon}–${R.m.betsLost}` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Amount value={s.netWorth} currency="league" size="sm" />
              {R.prize > 0 && !closed ? <Pill label={`${R.prize.toLocaleString()} pot share`} tone="money" icon="trophy" /> : null}
              {R.r && R.r.prizeTokens > 0 ? <Text style={[styles.memberSub, { color: c.primary }]}>won {R.r.prizeTokens.toLocaleString()}</Text> : null}
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
          </Pressable>
        );
      })}
      {!closed && <InvitePanel league={league} onShare={onInvite} />}

      <PlayerProfileSheet
        uid={openUid}
        leagueId={league.id}
        onClose={() => setOpenUid(null)}
        seed={
          openedInfo && openUid
            ? {
                displayName: openedInfo.name,
                username: profiles[openUid]?.username,
                avatar: profiles[openUid]?.avatar,
                equipped: profiles[openUid]?.equipped,
                favoriteTeams: profiles[openUid]?.favoriteTeams,
              }
            : undefined
        }
        standing={
          opened
            ? { rank: opened.rank, of: standings.length, netWorth: opened.netWorth, tokens: opened.tokens, debt: opened.debt, receivable: opened.receivable }
            : undefined
        }
      />
    </View>
  );
}

function InvitePanel({ league, onShare }: { league: League; onShare: () => void }) {
  const c = useColors();
  const { profile } = useApp();
  const { inviteFriend } = useLeague();
  const { friends } = useFriends(profile?.uid ?? null);
  const [sent, setSent] = useState<Record<string, "busy" | "sent" | string>>({});
  const candidates = friends.filter((f) => !league.memberIds.includes(f.uid)).slice(0, 8);
  if (isLeagueClosed(league)) return null;

  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.inline}>
        <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Invite friends</Text>
        <Button size="sm" variant="secondary" icon="share-variant" label={league.code} onPress={onShare} />
      </View>
      {candidates.length === 0 ? (
        <Text style={[styles.muted, { color: c.mutedForeground }]}>Share the code — anyone with it can join{league.buyIn > 0 ? ` for ${league.buyIn.toLocaleString()} credits` : ""}.</Text>
      ) : (
        candidates.map((f) => {
          const st = sent[f.uid];
          return (
            <View key={f.uid} style={styles.inline}>
              <Text style={[styles.memberName, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                {f.displayName} <Text style={{ color: c.mutedForeground }}>@{f.username}</Text>
              </Text>
              <Button
                size="sm"
                label={st === "sent" ? "Invited" : "Invite"}
                variant={st === "sent" ? "secondary" : "primary"}
                loading={st === "busy"}
                disabled={st === "sent"}
                onPress={async () => {
                  setSent((p) => ({ ...p, [f.uid]: "busy" }));
                  const e = await inviteFriend(league.id, f.uid);
                  setSent((p) => ({ ...p, [f.uid]: e ? "" : "sent" }));
                }}
              />
            </View>
          );
        })
      )}
    </Card>
  );
}

// ── Bets ───────────────────────────────────────────────────────────────────

function BetsTab({ bets, uid, leagueId }: { bets: LeagueBet[]; uid: string | null; leagueId?: string }) {
  const c = useColors();
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const open = bets.filter((b) => b.status === "pending");
  const settled = bets.filter((b) => b.status !== "pending");
  if (bets.length === 0) {
    return <EmptyState icon="ticket-outline" title="No league bets yet" body="Bets placed with this league's tokens show up here — everyone's, so you can see who's swinging big." />;
  }
  const row = (b: LeagueBet) => {
    const label = b.status === "pending" ? "Open" : b.status === "won" ? "Won" : b.status === "lost" ? "Lost" : b.status === "push" ? "Push" : "Void";
    return (
      <Pressable
        key={b.id}
        accessibilityRole="button"
        accessibilityHint="Opens the game"
        onPress={() => setQuickGame(b.gameId)}
        style={({ pressed }) => [styles.betRow, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: b.teamColor, opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.memberName, { color: c.foreground }]} numberOfLines={1}>
            {b.uid === uid ? "You" : b.displayName} · {b.teamAbbr} <Text style={{ color: c.mutedForeground }}>v {b.opponentAbbr}</Text>
          </Text>
          <Text style={[styles.memberSub, { color: c.mutedForeground }]}>
            {b.stake.toLocaleString()} at {b.odds.toFixed(2)}x → {b.potentialPayout.toLocaleString()}
          </Text>
        </View>
        <Pill label={label} tone={b.status === "won" ? "positive" : b.status === "lost" ? "negative" : b.status === "pending" ? "league" : "neutral"} />
        <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      {open.length > 0 && <SectionHeader title={`Open (${open.length})`} />}
      {open.map(row)}
      {settled.length > 0 && <SectionHeader title="Settled" />}
      {settled.map(row)}
      <GameQuickView gameId={quickGame} onClose={() => setQuickGame(null)} defaultWallet={leagueId} />
    </View>
  );
}

// ── Bank & peer loans ──────────────────────────────────────────────────────

function BankTab({ league, loans, uid, me, tokens, now, closed }: { league: League; loans: LeagueLoan[]; uid: string | null; me: Standing | null; tokens: number; now: number; closed: boolean }) {
  const c = useColors();
  const { takeBankLoan, repayLoan, updateBankSettings } = useLeague();
  const isCreator = league.creatorId === uid;
  const [opening, setOpening] = useState(false);
  const ended = league.status === "ended";
  const asOf = ended ? league.endedAt ?? league.endsAt : Math.min(now, league.endsAt);

  const mine = loans.filter((l) => l.borrowerId === uid && (l.status === "active" || l.status === "repaid"));
  const activeMine = mine.filter((l) => l.status === "active");
  const lent = loans.filter((l) => l.lenderId === uid && (l.status === "active" || l.status === "repaid"));
  const totals = activeMine.reduce(
    (t, l) => {
      const s = loanSnapshot(l, asOf);
      return { owed: t.owed + s.totalOwed, charged: t.charged + s.interestCharged, paid: t.paid + s.interestPaid, principal: t.principal + s.principalOutstanding };
    },
    { owed: 0, charged: 0, paid: 0, principal: 0 }
  );
  const cap = Math.floor(league.startingLeagueTokens * BANK_PRINCIPAL_CAP_MULTIPLIER);
  const bankPrincipal = activeMine.filter((l) => l.kind === "bank").reduce((s, l) => s + l.principalOutstanding, 0);
  const room = Math.max(0, cap - bankPrincipal);

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const borrow = Number.parseInt(amount, 10) || 0;
  const fee = flatInterest(borrow, league.bankInterestRate);

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <Text style={[styles.cardTitle, { color: c.foreground }]}>Your finances</Text>
        <View style={styles.hero}>
          <StatTile label="Tokens">
            <Amount value={tokens} currency="league" size="sm" animate />
          </StatTile>
          <StatTile label="Owed">
            <Amount value={totals.owed} currency="league" size="sm" tone={totals.owed ? "debt" : "neutral"} />
          </StatTile>
          <StatTile label="Net worth">
            <Amount value={me?.netWorth ?? tokens} currency="league" size="sm" />
          </StatTile>
        </View>
        {activeMine.length > 0 && (
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            {totals.principal.toLocaleString()} principal outstanding · {totals.charged.toLocaleString()} flat interest, {totals.paid.toLocaleString()} of it paid.
          </Text>
        )}
      </Card>

      {!closed && <PeerMarket league={league} loans={loans} uid={uid} tokens={tokens} />}

      {league.bankLoanEnabled && !closed ? (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="bank-outline" size={18} color={c.league} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>League bank</Text>
            <Pill label={`${league.bankInterestRate}% flat`} tone="league" />
          </View>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            A one-time {league.bankInterestRate}% fee on what you borrow — it never grows. You can borrow {room.toLocaleString()} more (limit {cap.toLocaleString()} in principal). Debt counts against your net worth.
          </Text>
          <View style={[styles.input, { borderColor: borrow > room ? c.negative : c.border, backgroundColor: c.secondary }]}>
            <MaterialCommunityIcons name="shield-star" size={18} color={c.league} />
            <NumericInput
              style={[styles.inputText, { color: c.foreground }]}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="Amount to borrow"
              placeholderTextColor={c.subtleForeground}
              accessibilityLabel="Amount to borrow"
            />
          </View>
          {borrow > 0 && (
            <Text style={[styles.muted, { color: c.mutedForeground }]}>
              You'll repay {(borrow + fee).toLocaleString()} in total ({fee.toLocaleString()} interest), however long it takes.
            </Text>
          )}
          {err ? <Text style={[styles.muted, { color: c.negative }]}>{err}</Text> : null}
          <Button
            label={borrow > 0 ? `Borrow ${borrow.toLocaleString()}` : "Borrow"}
            variant="league"
            loading={busy}
            disabled={borrow < 10 || borrow > room}
            onPress={async () => {
              setBusy(true);
              setErr(null);
              const e = await takeBankLoan(league.id, borrow);
              setBusy(false);
              if (e) setErr(e);
              else {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                setAmount("");
              }
            }}
          />
        </Card>
      ) : !closed ? (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="bank-off-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>League bank is closed</Text>
          </View>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            {isCreator
              ? "Open it so members can borrow league tokens for a flat fee."
              : "Only the league creator can open the bank. You can still borrow from friends above."}
          </Text>
          {err ? <Text style={[styles.muted, { color: c.negative }]}>{err}</Text> : null}
          {isCreator && (
            <Button
              label={`Open the bank · ${league.bankInterestRate || 10}% flat`}
              icon="bank-outline"
              variant="league"
              loading={opening}
              onPress={async () => {
                setOpening(true);
                setErr(null);
                const e = await updateBankSettings(league.id, true, league.bankInterestRate || 10, league.bankInterestIntervalHours || 24);
                setOpening(false);
                if (e) setErr(e);
              }}
            />
          )}
        </Card>
      ) : null}

      {mine.length > 0 && <SectionHeader title="What you owe" />}
      {mine.map((l) => (
        <LoanCard key={l.id} loan={l} now={asOf} viewer="borrower" tokens={tokens} onRepay={closed ? undefined : (amt) => repayLoan(league.id, l.id, amt)} />
      ))}
      {lent.length > 0 && <SectionHeader title="What you're owed" />}
      {lent.map((l) => (
        <LoanCard key={l.id} loan={l} now={asOf} viewer="lender" tokens={tokens} />
      ))}
    </View>
  );
}

function PeerMarket({ league, loans, uid, tokens }: { league: League; loans: LeagueLoan[]; uid: string | null; tokens: number }) {
  const c = useColors();
  const { requestLoan, peerLoanAction } = useLeague();
  const open = loans.filter((l) => l.kind === "peer" && (l.status === "requested" || l.status === "countered"));
  const max = Math.floor(league.startingLeagueTokens * PEER_LOAN_MAX_PCT);
  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterRate, setCounterRate] = useState("");

  const act = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setErr(null);
    const e = await fn();
    setBusy(null);
    if (e) setErr(e);
    return e;
  };

  const amt = Number.parseInt(amount, 10) || 0;
  const r = Number.parseFloat(rate) || 0;
  const canRequest = PEER_LOAN_REQUESTS_ENABLED && !isLeagueClosed(league);

  // Requests locked: only already-open requests remain, so they can be funded or withdrawn.
  if (!canRequest && open.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      {canRequest ? (
        <>
          <SectionHeader title="Loans from friends" />
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            Name your amount and a flat return. A friend funds it from their own tokens, or counters. Borrow 100 at 10% and they get back 110 — never more.
          </Text>
          <Button
            label={show ? "Cancel" : "Ask friends for a loan"}
            icon={show ? "close" : "hand-coin-outline"}
            variant={show ? "secondary" : "league"}
            onPress={() => setShow((v) => !v)}
          />
        </>
      ) : (
        <SectionHeader title="Open loan requests" />
      )}
      {canRequest && show && (
        <Card style={{ gap: 8 }}>
          <NumericInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder={`Amount (max ${max.toLocaleString()})`} placeholderTextColor={c.subtleForeground} accessibilityLabel="Loan amount" />
          <NumericInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder={`Flat return % (bank charges ${league.bankInterestRate}%)`} placeholderTextColor={c.subtleForeground} accessibilityLabel="Interest rate" />
          {amt > 0 && r > 0 ? (
            <Text style={[styles.muted, { color: c.mutedForeground }]}>
              You'll repay {(amt + flatInterest(amt, r)).toLocaleString()} in total ({flatInterest(amt, r).toLocaleString()} interest).
            </Text>
          ) : null}
          <TextInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={msg} onChangeText={setMsg} maxLength={80} placeholder="Pitch (optional)" placeholderTextColor={c.subtleForeground} accessibilityLabel="Message" />
          <Button
            label="Post request"
            variant="league"
            loading={busy === "req"}
            disabled={amt < 10 || amt > max || r <= 0 || r > 50}
            onPress={async () => {
              const e = await act("req", () => requestLoan(league.id, amt, r, msg || undefined));
              if (!e) {
                setShow(false);
                setAmount("");
                setRate("");
                setMsg("");
              }
            }}
          />
        </Card>
      )}
      {err ? <Text style={[styles.muted, { color: c.negative }]}>{err}</Text> : null}
      {canRequest && open.length === 0 && !show ? <Text style={[styles.muted, { color: c.subtleForeground }]}>No open requests.</Text> : null}
      {open.map((l) => {
        const mineReq = l.borrowerId === uid;
        const declined = l.declinedBy?.includes(uid ?? "");
        const countered = l.status === "countered";
        return (
          <Card key={l.id} style={{ gap: 8 }} tone={mineReq ? undefined : "league"}>
            <View style={styles.inline}>
              <Text style={[styles.memberName, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                {mineReq ? "Your request" : `${l.borrowerName} wants`} · {l.principal.toLocaleString()}
              </Text>
              <Pill label={countered ? `Counter ${l.counterRate}%` : `${l.proposedRate}%`} tone={countered ? "warning" : "league"} />
            </View>
            {l.message ? <Text style={[styles.muted, { color: c.mutedForeground }]}>"{l.message}"</Text> : null}
            {countered && <Text style={[styles.muted, { color: c.mutedForeground }]}>{mineReq ? `${l.counterByName} offered ${l.counterRate}%.` : `${l.counterByName} countered at ${l.counterRate}%.`}</Text>}
            {mineReq ? (
              <View style={styles.inline}>
                {countered && (
                  <>
                    <Button size="sm" label="Accept" variant="league" loading={busy === `acc${l.id}`} onPress={() => act(`acc${l.id}`, () => peerLoanAction(league.id, l.id, "accept_counter"))} />
                    <Button size="sm" label="Reject" variant="secondary" loading={busy === `rej${l.id}`} onPress={() => act(`rej${l.id}`, () => peerLoanAction(league.id, l.id, "reject_counter"))} />
                  </>
                )}
                <Button size="sm" label="Withdraw" variant="ghost" loading={busy === `can${l.id}`} onPress={() => act(`can${l.id}`, () => peerLoanAction(league.id, l.id, "cancel"))} />
              </View>
            ) : countered || declined ? null : counterFor === l.id ? (
              <View style={styles.inline}>
                <NumericInput style={[styles.field, { flex: 1, color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={counterRate} onChangeText={setCounterRate} keyboardType="decimal-pad" placeholder="Your rate %" placeholderTextColor={c.subtleForeground} autoFocus />
                <Button size="sm" label="Send" loading={busy === `ctr${l.id}`} disabled={!(Number.parseFloat(counterRate) > 0)} onPress={async () => {
                  const e = await act(`ctr${l.id}`, () => peerLoanAction(league.id, l.id, "counter", Number.parseFloat(counterRate)));
                  if (!e) setCounterFor(null);
                }} />
              </View>
            ) : (
              <View style={styles.inline}>
                <Button size="sm" label={`Lend ${l.principal.toLocaleString()}`} variant="league" disabled={tokens < l.principal} loading={busy === `fund${l.id}`} onPress={() => act(`fund${l.id}`, () => peerLoanAction(league.id, l.id, "fund"))} />
                <Button size="sm" label="Counter" variant="secondary" onPress={() => { setCounterFor(l.id); setCounterRate(""); }} />
                <Button size="sm" label="Pass" variant="ghost" loading={busy === `dec${l.id}`} onPress={() => act(`dec${l.id}`, () => peerLoanAction(league.id, l.id, "decline"))} />
              </View>
            )}
            {!mineReq && tokens < l.principal && !countered ? <Text style={[styles.memberSub, { color: c.subtleForeground }]}>You'd need {l.principal.toLocaleString()} tokens to fund this.</Text> : null}
          </Card>
        );
      })}
    </View>
  );
}

// ── Info & settings ────────────────────────────────────────────────────────

function InfoTab({ league, uid, closed }: { league: League; uid: string | null; closed: boolean }) {
  const c = useColors();
  const { updateBankSettings, endLeague, leaveLeague } = useLeague();
  const isCreator = league.creatorId === uid;
  const preset = PRIZE_PRESETS.find((p) => p.value === league.prizeDistribution.preset);
  const [enabled, setEnabled] = useState(league.bankLoanEnabled);
  const [rate, setRate] = useState(String(league.bankInterestRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"end" | "leave" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState<string | null>(null);
  const shares = useMemo(() => prizeSplit(league.pot, league.prizeDistribution, Math.max(3, league.memberIds.length)), [league]);

  const rows: Array<[string, string]> = [
    ["Status", closed ? "Closed" : "Active"],
    // Invite code is withheld once closed — nobody new can join.
    ...(closed ? [] : [["Invite code", league.code] as [string, string]]),
    ["Starting tokens", league.startingLeagueTokens.toLocaleString()],
    ["Buy-in", league.buyIn > 0 ? `${league.buyIn.toLocaleString()} credits` : "Free"],
    ["Prize pot", `${league.pot.toLocaleString()} credits`],
    ["Prize split", preset?.label ?? "Custom"],
    ["Sports", league.allowedSports.join(", ")],
    [closed ? "Ended" : "Ends", new Date(league.endedAt ?? league.endsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })],
    ["Bank", league.bankLoanEnabled ? `${league.bankInterestRate}% flat` : "Closed"],
  ];

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ padding: 0 }}>
        {rows.map(([k, v], i) => (
          <View key={k} style={[styles.infoRow, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
            <Text style={[styles.muted, { color: c.mutedForeground }]}>{k}</Text>
            <Text style={[styles.memberName, { color: c.foreground, flexShrink: 1, textAlign: "right" }]}>{v}</Text>
          </View>
        ))}
      </Card>
      {league.pot > 0 && (
        <Card style={{ gap: 6 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Payouts</Text>
          {shares.map((s, i) =>
            s > 0 ? (
              <View key={i} style={styles.inline}>
                <Text style={[styles.muted, { color: c.mutedForeground, flex: 1 }]}>{["1st", "2nd", "3rd"][i]} place</Text>
                <Amount value={s} size="sm" />
              </View>
            ) : null
          )}
          <Text style={[styles.memberSub, { color: c.subtleForeground }]}>Paid in credits when the season ends. Open league bets are voided and refunded first.</Text>
        </Card>
      )}

      {isCreator && !closed && (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Bank settings</Text>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: c.border, true: c.league }} accessibilityLabel="Bank open" />
          </View>
          {enabled && (
            <NumericInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="Flat rate % (0.5–50)" placeholderTextColor={c.subtleForeground} accessibilityLabel="Bank rate" />
          )}
          <Text style={[styles.memberSub, { color: c.subtleForeground }]}>Changes apply to new loans. Existing loans keep the terms they were taken at.</Text>
          {saved ? <Text style={[styles.memberSub, { color: saved === "Saved" ? c.positive : c.negative }]}>{saved}</Text> : null}
          <Button
            label="Save bank settings"
            variant="secondary"
            loading={saving}
            disabled={enabled && !(Number.parseFloat(rate) >= 0.5 && Number.parseFloat(rate) <= 50)}
            onPress={async () => {
              setSaving(true);
              const e = await updateBankSettings(league.id, enabled, Number.parseFloat(rate) || league.bankInterestRate, league.bankInterestIntervalHours);
              setSaving(false);
              setSaved(e ?? "Saved");
            }}
          />
        </Card>
      )}

      {!closed && (
        <View style={{ gap: 8 }}>
          {isCreator && <Button label="End season now & pay out" icon="flag-checkered" variant="secondary" onPress={() => { setDlgErr(null); setConfirm("end"); }} />}
          <Button label="Leave league" icon="exit-to-app" variant="destructive" onPress={() => { setDlgErr(null); setConfirm("leave"); }} />
        </View>
      )}

      <ConfirmDialog
        visible={!closed && confirm === "end"}
        title="End the season now?"
        body={`Standings lock at current net worth. Open league bets are voided and refunded, and the ${league.pot.toLocaleString()}-credit pot pays out immediately. This can't be undone.`}
        confirmLabel="End & pay out"
        busy={busy}
        error={dlgErr}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          const e = await endLeague(league.id);
          setBusy(false);
          if (e) setDlgErr(e);
          else setConfirm(null);
        }}
      />
      <ConfirmDialog
        visible={!closed && confirm === "leave"}
        title="Leave this league?"
        body={`You'll drop out of the standings and can't rejoin.${league.buyIn > 0 ? ` Your ${league.buyIn.toLocaleString()}-credit buy-in stays in the pot.` : ""} You have to settle any loans and wait for open bets first.`}
        confirmLabel="Leave"
        destructive
        busy={busy}
        error={dlgErr}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          const e = await leaveLeague(league.id);
          setBusy(false);
          if (e) setDlgErr(e);
          else {
            setConfirm(null);
            router.navigate("/(tabs)/leagues");
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 16, gap: 12 },
  switch: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, maxWidth: 170 },
  switchText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  hero: { flexDirection: "row", gap: 8 },
  heroRank: { fontSize: 18, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  heroOf: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  muted: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  member: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, borderWidth: 1 },
  rankNum: { width: 22, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  betRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  feedText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  feedTime: { fontSize: 11, fontFamily: "Inter_500Medium" },
  input: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  inputText: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: "Inter_500Medium" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  closedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  champ: {
    borderWidth: 1.5,
    borderRadius: 22,
    padding: 16,
    gap: 14,
    overflow: "hidden",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  champTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  champBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  champBadgeText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, color: "#2A1E00" },
  champMain: { flexDirection: "row", alignItems: "center", gap: 14 },
  champName: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: -0.4, flexShrink: 1 },
  champStats: { flexDirection: "row", alignItems: "flex-end", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  champK: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 2 },
  champV: { fontSize: 18, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

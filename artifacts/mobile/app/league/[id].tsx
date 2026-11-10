import { MaterialCommunityIcons } from "@expo/vector-icons";
import PreseasonCard, { PredictionsCard } from "@/components/PreseasonCard";
import { useOptimisticReaction } from "@/hooks/useOptimisticReaction";
import { haptic as buzz } from "@/lib/motion";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable, Switch } from "@/components/fx/Tap";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import { QuotedParent, ReplyComposerBar, WinLossReplyThread, type ReplyQuote } from "@/components/chat/ReplyThread";
import { chatText } from "@/lib/chatText";
import WinLossReplyModal from "@/components/chat/WinLossReplyModal";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import NumericInput from "@/components/NumericInput";
import LoanCard from "@/components/LoanCard";
import Shimmer from "@/components/fx/Shimmer";
import MemberAvatar from "@/components/MemberAvatar";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import ReportDialog, { type ReportTarget } from "@/components/ReportDialog";
import ReactionRow from "@/components/chat/ReactionRow";
import BetChatCard from "@/components/chat/BetChatCard";
import BracketFill from "@/components/BracketFill";
import CoopGoalCard from "@/components/CoopGoalCard";
import TauntCard from "@/components/chat/TauntCard";
import GameQuickView, { type FollowIntent } from "@/components/GameQuickView";
import TeamChips from "@/components/TeamChips";
import { useChat } from "@/context/ChatContext";
import {
  Amount,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  FilterPills,
  IconButton,
  Pill,
  RoundBadge,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  StatTile,
  TabStrip,
  useBottomPad,
  ActionChip,
} from "@/components/ui";
import * as api from "@/lib/api";
import {
  BANK_PRINCIPAL_CAP_MULTIPLIER,
  cadenceLabel,
  isLeagueClosed, isLeagueStarted, leagueStartsAt,
  LEAGUE_MODES,
  MATCHUP_CADENCES,
  periodNoun,
  STIMULUS_PCTS,
  type MatchupCadence,
  PEER_LOAN_MAX_PCT,
  PEER_LOAN_REQUESTS_ENABLED,
  PRIZE_PRESETS,
  REACTION_EMOJIS,
  type League,
  type LeagueAuditEntry,
  type LeagueBet,
  type LeagueLoan,
  type LeagueMatchupDoc,
  type LeagueMessage,
  type LeagueMode,
  type LeagueParlay,
  type LeaguePick,
  type LeagueReport,
  type ReactionEmoji,
} from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useLeague, useLeagueDetail } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import { useGames } from "@/hooks/useGames";
import { usePublicProfiles } from "@/hooks/usePublicProfiles";
import InviteQR from "@/components/InviteQR";
import { trackEvent } from "@/lib/analytics";
import { newIdempotencyKey } from "@/lib/api";
import { inviteLink, inviteMessage } from "@/lib/invites";
import { flatInterest, loanSnapshot, prizeSplit, type Standing } from "@/lib/loanMath";
import { weekKey } from "@/lib/markets";
import { formatOdds, type OddsFormat } from "@/lib/odds";
import { markChatSeen, useChatSeen, useOddsFormat, useUnseenCount } from "@/lib/settings";

type Tab = "standings" | "bets" | "bank" | "feed" | "info";

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function LeagueDetailScreen() {
  const c = useColors();
  const fmt = useOddsFormat();
  const bottom = useBottomPad(false);
  const params = useLocalSearchParams<{ id: string; tab?: Tab; created?: string }>();
  const { leagues, getLeague, uid, error, clearError } = useLeague();
  const league = getLeague(params.id);
  const detail = useLeagueDetail(league);
  const [tab, setTab] = useState<Tab>(
    // Chat is the front door once a league is running; before it starts, the table carries the invite and preseason cards.
    params.tab ?? (params.created || !league || !isLeagueStarted(league, Date.now()) ? "standings" : "feed")
  );
  const seenAt = useChatSeen(league?.id);

  const unreadFeed = useMemo(() => {
    if (!league || tab === "feed") return 0;
    return detail.messages.filter((m) => m.uid !== uid && m.at > seenAt).length;
  }, [league, tab, detail.messages, uid, seenAt]);

  useEffect(() => {
    if (tab === "feed" && league) {
      const latest = detail.messages[0]?.at ?? Date.now();
      void markChatSeen(league.id, Math.max(Date.now(), latest));
    }
  }, [tab, league, detail.messages]);

  if (!league) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScreenHeader back title="League" />
        <View style={{ padding: 16 }}>
          <EmptyState icon="trophy-broken" title="League Not Found" body="You may have left it, or it's still loading." action="All Leagues" onAction={() => router.navigate("/(tabs)/leagues")} />
        </View>
      </View>
    );
  }

  const me = detail.standings.find((s) => s.uid === uid) ?? null;
  const myMember = uid ? league.members[uid] : undefined;
  const myTokens = myMember?.leagueTokens ?? 0;
  const ended = league.status === "ended";
  const closed = isLeagueClosed(league, detail.now);
  const daysLeft = Math.max(0, Math.ceil((league.endsAt - detail.now) / 86_400_000));
  const pendingRequests = closed
    ? 0
    : detail.loans.filter((l) => l.kind === "peer" && (l.status === "requested" || l.status === "countered") && l.borrowerId !== uid).length +
      (league.stimulusEnabled && league.stimulus && league.stimulus.expiresAt > detail.now && uid && !league.stimulus.votes.includes(uid) ? 1 : 0);

  const chatOpen = tab === "feed";
  const started = isLeagueStarted(league, detail.now);
  const startLabel = new Date(leagueStartsAt(league)).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const invite = () => {
    if (closed || started) return;
    trackEvent("share_card_tapped", { surface: "league_invite", league_id: league.id });
    Share.share({
      message: inviteMessage(league),
      url: inviteLink(league.code),
      title: `Join ${league.name} on SportDrip`,
    }).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title={league.name}
        subtitle={
          chatOpen
            ? `League chat · ${league.memberIds.length} member${league.memberIds.length === 1 ? "" : "s"}`
            : closed
              ? "Closed · read-only"
              : !started
                ? `Starts ${startLabel} · code ${league.code}`
                : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        }
        right={
          closed ? (
            <Pill label="Closed" tone="neutral" icon="lock-outline" />
          ) : started ? (
            <Pill label="Roster Locked" tone="neutral" icon="account-lock-outline" />
          ) : (
            <IconButton icon="account-plus-outline" label="Invite" onPress={invite} />
          )
        }
      >
        {/* Chat gets the whole screen: no league switcher or stat tiles above it. */}
        {!chatOpen && leagues.length > 1 && (
          <FilterPills
            value={league.id}
            onChange={(id) => router.setParams({ id })}
            inset={0}
            options={leagues.map((l) => ({ value: l.id, label: l.name, icon: "trophy-outline" as const, color: c.league }))}
          />
        )}
        {!chatOpen && (
        <View style={styles.hero}>
          <StatTile label="Rank">
            <Text style={[styles.heroRank, { color: me?.rank === 1 ? c.primary : c.foreground }]}>
              #{me?.rank ?? "–"}
              <Text style={[styles.heroOf, { color: c.mutedForeground }]}> /{detail.standings.length}</Text>
            </Text>
          </StatTile>
          <StatTile label={league.mode === "pickem" || league.mode === "bracket" ? "Points" : league.mode === "survivor" ? "Status" : league.mode === "matchups" ? "H2H record" : "Net worth"}>
            {league.mode === "matchups" ? (
              <Text style={[styles.heroRank, { color: c.foreground }]}>
                {myMember?.h2h?.w ?? 0}–{myMember?.h2h?.l ?? 0}
                {myMember?.h2h?.t ? `–${myMember.h2h.t}` : ""}
              </Text>
            ) : league.mode === "pickem" || league.mode === "bracket" ? (
              <Text style={[styles.heroRank, { color: c.foreground }]}>
                {myMember?.pickPoints ?? 0} pts
              </Text>
            ) : league.mode === "survivor" ? (
              <Text style={[styles.heroRank, { color: myMember?.eliminated ? c.negative : c.positive }]}>
                {myMember?.eliminated ? "Out" : "Alive"}
              </Text>
            ) : (
              <Amount value={me?.netWorth ?? myTokens} currency="league" size="sm" />
            )}
          </StatTile>
          <StatTile label={me && me.debt > 0 ? "You owe" : "Tokens"}>
            <Amount value={me && me.debt > 0 ? me.debt : myTokens} currency="league" size="sm" tone={me && me.debt > 0 ? "debt" : undefined} />
          </StatTile>
        </View>
        )}
        <TabStrip
          value={tab}
          onChange={setTab}
          options={[
            { value: "feed", label: "Chat", badge: unreadFeed || undefined },
            { value: "standings", label: "Table" },
            { value: "bets", label: "Bets" },
            { value: "bank", label: "Loans", badge: pendingRequests || undefined },
            { value: "info", label: "Info" },
          ]}
        />
      </ScreenHeader>
      <ErrorBanner message={error} onDismiss={clearError} />

      {tab === "feed" ? (
        <FeedTab
          league={league}
          activity={detail.activity}
          messages={detail.messages}
          bets={detail.bets}
          uid={uid}
          now={detail.now}
          closed={closed}
          fmt={fmt}
          bottomPad={bottom}
        />
      ) : (
        <>
          <KeyboardAwareScrollViewCompat
            contentContainerStyle={[styles.body, { paddingBottom: bottom + (closed ? 0 : 72) }]}
            showsVerticalScrollIndicator={false}
            bottomOffset={closed ? 16 : 88}
          >
            {closed && (
              <Card style={styles.closedBanner} accessibilityLabel="This league is closed. You can view its history, but nothing can be changed.">
                <MaterialCommunityIcons name="lock-outline" size={18} color={c.mutedForeground} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.cardTitle, { color: c.foreground }]}>League Closed</Text>
                  <Text style={[styles.muted, { color: c.mutedForeground }]}>
                    {ended ? "The season is over." : "The season is over — final results are being tallied."} Standings, bets, loans and the feed are view-only.
                  </Text>
                </View>
              </Card>
            )}
            {ended && (
              <ActionChip
                label="Your Season Wrapped"
                icon="gift-outline"
                tone="league"
                onPress={() => router.push({ pathname: "/wrapped/[id]", params: { id: league.id } } as never)}
              />
            )}
            {!closed && !started && tab === "standings" && <PreseasonCard league={league} uid={uid} onInvite={invite} />}
            {!closed && !started && params.created && league.memberIds.length === 1 && tab === "standings" && (
              <Card tone="league" style={{ gap: 8 }}>
                <Text style={[styles.cardTitle, { color: c.foreground }]}>League Created</Text>
                <Text style={[styles.muted, { color: c.mutedForeground }]}>Share code {league.code} or invite friends below. Everyone starts with {league.startingLeagueTokens.toLocaleString()} tokens.</Text>
              </Card>
            )}
            {tab === "standings" && !closed && <CoopGoalCard league={league} uid={uid} />}
            {tab === "standings" && (
              <StandingsTab
                league={league}
                standings={detail.standings}
                bets={detail.bets}
                matchups={detail.matchups}
                reports={detail.reports}
                uid={uid}
                closed={closed}
                onInvite={invite}
              />
            )}
            {tab === "bets" && (
              <BetsTab
                league={league}
                bets={detail.bets}
                parlays={detail.parlays}
                picks={detail.picks}
                uid={uid}
                leagueId={closed ? undefined : league.id}
                now={detail.now}
                fmt={fmt}
              />
            )}
            {tab === "bank" && <BankTab league={league} loans={detail.loans} uid={uid} me={me} tokens={myTokens} now={detail.now} closed={closed} />}
            {tab === "info" && <InfoTab league={league} betsCount={detail.bets.length} audit={detail.audit} uid={uid} closed={closed} onInvite={invite} />}
          </KeyboardAwareScrollViewCompat>

          {!closed && (
            <View style={[styles.dock, { backgroundColor: c.background, borderTopColor: c.border, paddingBottom: bottom - 12 }]}>
              <Button
                label={started ? `Bet with ${myTokens.toLocaleString()} league tokens` : `Betting opens ${startLabel}`}
                icon={started ? "ticket-outline" : "lock-clock"}
                variant="league"
                size="lg"
                disabled={!started}
                onPress={() => router.navigate({ pathname: "/(tabs)/games", params: { wallet: league.id } })}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const FEED_ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  created: "flag-outline",
  joined: "account-plus-outline",
  left: "account-minus-outline",
  bet_placed: "ticket-outline",
  bet_tailed: "account-multiple-plus",
  bet_faded: "account-switch",
  bet_won: "arrow-up-bold",
  bet_lost: "arrow-down-bold",
  bet_push: "minus",
  bet_voided: "undo-variant",
  bank_loan: "home-city-outline",
  loan_request: "hand-coin-outline",
  loan_funded: "handshake-outline",
  repayment: "cash-refund",
  settings: "cog-outline",
  stimulus: "cash-plus",
  ended: "trophy",
};

// ── Standings ──────────────────────────────────────────────────────────────

const GOLD = "#F5C542";
const SILVER = "#C9D1CC";
const BRONZE = "#C4703B";

function StandingsTab({
  league,
  standings,
  bets,
  matchups,
  reports,
  uid,
  closed,
  onInvite,
}: {
  league: League;
  standings: Standing[];
  bets: LeagueBet[];
  matchups: LeagueMatchupDoc[];
  reports: LeagueReport[];
  uid: string | null;
  closed: boolean;
  onInvite: () => void;
}) {
  const c = useColors();
  const { byId } = useCatalog();
  const { profile: myProfile } = useApp();
  const fetched = usePublicProfiles(standings.map((s) => s.uid));
  const [subView, setSubView] = useState<"table" | "matchups" | "locks">("table");
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
      prize: prizes[standings.indexOf(s)] ?? 0,
    };
  };

  const lockBoard = useMemo(() => {
    const map = new Map<string, { uid: string; name: string; won: number; lost: number; pending: number; net: number }>();
    for (const [id, m] of Object.entries(league.members)) {
      map.set(id, { uid: id, name: m.displayName, won: 0, lost: 0, pending: 0, net: 0 });
    }
    for (const b of bets) {
      if (!b.lockWeek && !b.lock) continue;
      const row = map.get(b.uid) ?? { uid: b.uid, name: b.displayName, won: 0, lost: 0, pending: 0, net: 0 };
      if (b.status === "won") {
        row.won += 1;
        row.net += b.potentialPayout - b.stake;
      } else if (b.status === "lost") {
        row.lost += 1;
        row.net -= b.stake;
      } else if (b.status === "pending") {
        row.pending += 1;
      }
      map.set(b.uid, row);
    }
    return [...map.values()].sort((a, b) => b.won - a.won || b.net - a.net);
  }, [league.members, bets]);

  const leader = standings[0]?.rank === 1 ? standings[0] : undefined;
  const rest = leader ? standings.slice(1) : standings;
  const opened = openUid ? standings.find((s) => s.uid === openUid) : undefined;
  const openedInfo = opened ? info(opened) : undefined;
  const latestReport = reports[0];
  const latestMatchup = matchups[0];
  const matchupsNew = useUnseenCount(`league.${league.id}.matchups`, latestMatchup ? [latestMatchup.week] : [], subView === "matchups");

  return (
    <View style={{ gap: 10 }}>
      {latestReport && latestReport.cards.length > 0 && (
        <Card
          tone="league"
          onPress={() => router.push({ pathname: "/league/[id]/recap" as never, params: { id: league.id, week: latestReport.week } })}
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <MaterialCommunityIcons name="newspaper-variant-outline" size={22} color={c.league} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>Tuesday League Report · {latestReport.week}</Text>
            <Text style={[styles.muted, { color: c.mutedForeground }]} numberOfLines={1}>
              {latestReport.cards[0]?.headline || latestReport.cards[0]?.title} — tap to view & share story cards
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={c.league} />
        </Card>
      )}

      <SegmentedControl
        value={subView}
        onChange={setSubView}
        options={[
          { value: "table", label: "Standings" },
          { value: "matchups", label: league.mode === "matchups" ? "Matchups" : "H2H Matchups", badge: matchupsNew || undefined },
          { value: "locks", label: "Locks 🔒" },
        ]}
      />

      {subView === "matchups" ? (
        <MatchupsSection league={league} matchups={matchups} uid={uid} />
      ) : subView === "locks" ? (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Lock of the Week Leaderboard</Text>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            One pick per week can be locked for the weekly Lock leaderboard.
          </Text>
          {lockBoard.map((row, idx) => (
            <View key={row.uid} style={[styles.inline, { paddingVertical: 6, borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
              <Text style={[styles.rankNum, { color: idx === 0 ? GOLD : c.mutedForeground }]}>{idx + 1}</Text>
              <Text style={[styles.memberName, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                {row.uid === uid ? "You" : row.name}
              </Text>
              <Pill label={`${row.won}–${row.lost}${row.pending ? ` (${row.pending} open)` : ""}`} tone={row.won > row.lost ? "positive" : row.lost > row.won ? "negative" : "neutral"} />
              <Amount value={row.net} currency="league" size="sm" signed tone={row.net > 0 ? "positive" : row.net < 0 ? "negative" : "neutral"} />
            </View>
          ))}
        </Card>
      ) : (
        <>
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
                      {L.m?.h2h?.w != null ? ` · H2H ${L.m.h2h.w}–${L.m.h2h.l ?? 0}` : ""}
                      {leader.debt > 0 ? ` · owes ${leader.debt.toLocaleString()}` : ""}
                      {leader.receivable > 0 ? ` · owed ${leader.receivable.toLocaleString()}` : ""}
                    </Text>
                  </View>
                </View>
                <View style={[styles.champStats, { borderTopColor: c.alpha(GOLD, 0.25) }]}>
                  <View style={{ flex: 1.4 }}>
                    <Text style={[styles.champK, { color: c.subtleForeground }]}>
                      {league.mode === "pickem" || league.mode === "bracket" ? "PICK POINTS" : league.mode === "survivor" ? "SURVIVOR" : league.mode === "matchups" ? "H2H RECORD" : "NET WORTH"}
                    </Text>
                    {league.mode === "matchups" ? (
                      <Text style={[styles.champV, { color: c.foreground }]}>
                        {L.m?.h2h?.w ?? 0}–{L.m?.h2h?.l ?? 0}{L.m?.h2h?.t ? `–${L.m.h2h.t}` : ""}
                      </Text>
                    ) : league.mode === "pickem" || league.mode === "bracket" ? (
                      <Text style={[styles.champV, { color: c.foreground }]}>{L.m?.pickPoints ?? 0} pts</Text>
                    ) : league.mode === "survivor" ? (
                      <Text style={[styles.champV, { color: L.m?.eliminated ? c.negative : c.positive }]}>
                        {L.m?.eliminated ? `Out (${L.m.eliminatedWeek ?? "eliminated"})` : "Alive"}
                      </Text>
                    ) : (
                      <Amount value={leader.netWorth} currency="league" size="lg" />
                    )}
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
            {league.mode === "matchups"
              ? `Ranked by head-to-head record (2 pts a win, 1 a tie), net worth breaks ties. New matchups ${MATCHUP_CADENCES.find((m) => m.value === (league.matchupCadence ?? "weekly"))?.desc.replace(/^New opponent /, "") ?? ""}.`
              : "Ranked by net worth — tokens, plus what you're owed, minus what you owe (ties broken by lower debt)."}{" "}
            Tap anyone for their stats and rivalry record.
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
                <RoundBadge label={s.rank} color={rankColor} size={28} filled={s.rank <= 3} />
                <MemberAvatar profile={p} name={R.name} color={R.color} catalog={byId} size={40} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.inline}>
                    <Text style={[styles.memberName, { color: c.foreground }]} numberOfLines={1}>
                      {R.name}
                    </Text>
                    {R.you && <Pill label="YOU" tone="league" />}
                    {R.m?.achievementCount ? <Pill label={`⭐${R.m.achievementCount}`} tone="warning" /> : null}
                    {p?.ladder?.tier ? <Pill label={p.ladder.tier} tone="accent" icon="stairs-up" /> : null}
                    {league.mode === "survivor" && (
                      <Pill
                        label={R.m?.eliminated ? `Out ${R.m.eliminatedWeek ?? ""}`.trim() : "Alive"}
                        tone={R.m?.eliminated ? "negative" : "positive"}
                      />
                    )}
                  </View>
                  <TeamChips teams={p?.favoriteTeams} compact max={3} />
                  <Text style={[styles.memberSub, { color: c.mutedForeground }]} numberOfLines={2}>
                    {league.mode === "pickem" || league.mode === "bracket" ? `${R.m?.pickPoints ?? 0} pick pts · ` : ""}
                    {league.mode === "matchups" ? `H2H ${R.m?.h2h?.w ?? 0}–${R.m?.h2h?.l ?? 0}${R.m?.h2h?.t ? `–${R.m.h2h.t}` : ""} · ` : ""}
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
        </>
      )}

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

function MatchupsSection({ league, matchups, uid }: { league: League; matchups: LeagueMatchupDoc[]; uid: string | null }) {
  const c = useColors();
  const { profile } = useApp();
  const { show } = useToast();
  const [sentTaunt, setSentTaunt] = useState<Record<string, boolean>>({});
  const danceMove = profile?.moves?.[0] ?? "cheer";
  const sendDance = async (matchupId: string, receiverUid: string) => {
    buzz.tick();
    try {
      await api.sendTaunt({ scope: "league", leagueId: league.id, matchupId, receiverUid, moveId: danceMove });
      setSentTaunt((m) => ({ ...m, [`${matchupId}_${receiverUid}`]: true }));
    } catch (e) {
      show({ kind: "warning", title: "Couldn't send", body: api.friendlyError(e) });
    }
  };
  const nameOf = (id: string | null, fallback?: string) => {
    if (!id) return "BYE";
    if (id === uid) return "You";
    return league.members[id]?.displayName ?? fallback ?? "Player";
  };
  const stars = (id: string | null) => {
    const n = id ? league.members[id]?.achievementCount : 0;
    return n ? ` ⭐${n} ` : "";
  };
  if (matchups.length === 0) {
    return (
      <EmptyState
        icon="sword-cross"
        title="No Matchups Yet"
        body={`${MATCHUP_CADENCES.find((m) => m.value === (league.matchupCadence ?? "weekly"))?.desc ?? "New opponent every Monday"} at 9am ET: members are paired head-to-head on net profit for the round. The top seeds meet in a playoff in the final round.`}
      />
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {matchups.map((w) => (
        <Card key={w.week} style={{ gap: 8 }}>
          <View style={styles.inline}>
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>
              {w.isPlayoff
                ? `🏆 Playoff Bracket · ${w.week}`
                : `${periodNoun(league.matchupCadence)} ${w.weekNumber ?? ""} · ${w.week.replace(/-([ab])$/, (_, h) => (h === "a" ? " (Mon–Wed)" : " (Thu–Sun)"))}`}
            </Text>
            {w.isPlayoff && <Pill label="PLAYOFFS" tone="money" icon="trophy" />}
          </View>
          {w.pairs.map((p, i) => (
            <View key={i} style={[styles.inline, { paddingVertical: 8, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.memberName, { color: p.winnerUid === p.aUid ? c.positive : c.foreground }]}>
                  {nameOf(p.aUid, p.aName)} {p.winnerUid === p.aUid ? "✓" : ""}
                  {stars(p.aUid)}
                </Text>
                {p.aDelta !== null ? <Amount value={p.aDelta} currency="league" size="sm" signed tone={p.aDelta >= 0 ? "positive" : "negative"} /> : null}
              </View>
              <Text style={[styles.muted, { color: c.subtleForeground }]}>{p.bracket === "playoff" ? "PLAYOFF" : "vs"}</Text>
              <View style={{ flex: 1, alignItems: "flex-end", gap: 2 }}>
                <Text style={[styles.memberName, { color: p.winnerUid === p.bUid ? c.positive : c.foreground }]}>
                  {stars(p.bUid)}
                  {p.winnerUid === p.bUid ? "✓ " : ""}{nameOf(p.bUid, p.bName)}
                </Text>
                {p.bDelta !== null && p.bUid ? <Amount value={p.bDelta} currency="league" size="sm" signed tone={p.bDelta >= 0 ? "positive" : "negative"} /> : null}
              </View>
              {uid && p.winnerUid === uid && p.bUid ? (
                <ActionChip
                  label={sentTaunt[`${w.week}_${p.aUid === uid ? p.bUid : p.aUid}`] ? "Sent" : "Send a dance"}
                  icon="human-handsup"
                  chevron={false}
                  tone="league"
                  disabled={!!sentTaunt[`${w.week}_${p.aUid === uid ? p.bUid : p.aUid}`]}
                  onPress={() => void sendDance(w.week, p.aUid === uid ? p.bUid! : p.aUid)}
                />
              ) : null}
            </View>
          ))}
        </Card>
      ))}
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
  if (isLeagueClosed(league) || isLeagueStarted(league)) return null;

  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.inline}>
        <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Invite Friends</Text>
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

// ── Bets, Parlays & Pick'em / Survivor ──────────────────────────────────────

function BetsTab({
  league,
  bets,
  parlays,
  picks,
  uid,
  leagueId,
  now,
  fmt,
}: {
  league: League;
  bets: LeagueBet[];
  parlays: LeagueParlay[];
  picks: LeaguePick[];
  uid: string | null;
  leagueId?: string;
  now: number;
  fmt: OddsFormat;
}) {
  const c = useColors();
  const { myLeagueBets, reactToItem, reportResult, voidLeagueBet } = useLeague();
  const { betComments } = useChat();
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [follow, setFollow] = useState<FollowIntent | null>(null);
  const [voidTarget, setVoidTarget] = useState<LeagueBet | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [reportedIds, setReportedIds] = useState<Record<string, boolean>>({});
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyQuote | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const isCreator = league.creatorId === uid;
  const open = bets.filter((b) => b.status === "pending");
  const settled = bets.filter((b) => b.status !== "pending");

  const followed = useMemo(() => {
    const out: Record<string, "tail" | "fade"> = {};
    for (const mine of (leagueId ? myLeagueBets[leagueId] : undefined) ?? []) {
      if (mine.tailOf) out[mine.tailOf] = "tail";
      if (mine.fadeOf) out[mine.fadeOf] = "fade";
    }
    return out;
  }, [leagueId, myLeagueBets]);

  const startFollow = (b: LeagueBet, kind: "tail" | "fade") => {
    if (!leagueId) return;
    buzz.tick();
    setFollow({
      betId: b.id,
      kind,
      leagueId,
      name: b.displayName,
      side: kind === "tail" ? b.side : b.side === "home" ? "away" : "home",
      // Never copy another member's stake (guardrail 3); the slip prefills your own.
      stake: 0,
      sourceTeamAbbr: b.teamAbbr,
    });
    setQuickGame(b.gameId);
  };

  const openBetInfo = (b: LeagueBet) => {
    if (b.status === "pending") {
      setFollow(null);
      setQuickGame(b.gameId);
      return;
    }
    buzz.tick();
    setBreakdown({
      id: b.id,
      gameId: b.gameId,
      sport: b.sport,
      teamName: b.teamName,
      teamAbbr: b.teamAbbr,
      teamColor: b.teamColor,
      opponentAbbr: b.opponentAbbr,
      side: b.side,
      market: b.market ?? "ml",
      selection: b.selection ?? null,
      line: b.line ?? null,
      label: b.label ?? null,
      lock: Boolean(b.lockWeek || b.lock),
      odds: b.odds,
      stake: b.stake,
      payout: b.potentialPayout,
      status: b.status,
      finalHomeScore: b.finalHomeScore ?? null,
      finalAwayScore: b.finalAwayScore ?? null,
      wallet: "league",
      leagueId: league.id,
      leagueName: league.name,
      ownerUid: b.uid,
      ownerName: b.displayName,
      placedAtMs: b.placedAt,
    });
  };

  const row = (b: LeagueBet) => {
    const label = b.status === "pending" ? "Open" : b.status === "won" ? "Won" : b.status === "lost" ? "Lost" : b.status === "push" ? "Push" : "Void";
    const mine = b.uid === uid;
    const upcoming = b.startsAt == null || b.startsAt > now;
    const canFollow = !!leagueId && !!uid && !mine && b.status === "pending" && upcoming;
    const already = (uid && b.followers?.[uid]) || followed[b.id];
    const tails = b.tails ?? 0;
    const fades = b.fades ?? 0;
    const quote: ReplyQuote = {
      id: b.id,
      kind: "bet_result",
      authorUid: b.uid,
      authorName: b.displayName,
      text: `${b.label ?? b.teamAbbr} v ${b.opponentAbbr} · ${label.toUpperCase()} (${formatOdds(b.odds, fmt)})`,
      betStatus: b.status,
      teamAbbr: b.teamAbbr,
      opponentAbbr: b.opponentAbbr,
      odds: b.odds,
      stake: b.stake,
      payout: b.potentialPayout,
      currency: "league",
    };
    const comments = betComments[b.id] ?? [];

    return (
      <View
        key={b.id}
        style={[styles.betRow, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: b.teamColor }]}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Pressable
            onPress={() => openBetInfo(b)}
            style={styles.betTop}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.inline}>
                <Pressable onPress={() => setProfileUid(b.uid)} hitSlop={6}>
                  <Text style={[styles.memberName, { color: c.primary }]}>
                    {mine ? "You" : b.displayName}
                  </Text>
                </Pressable>
                <Text style={[styles.memberName, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
                  · {b.label ?? b.teamAbbr} <Text style={{ color: c.mutedForeground }}>v {b.opponentAbbr}</Text>
                </Text>
                {b.lockWeek || b.lock ? <Pill label="LOCK" tone="accent" icon="lock" /> : null}
              </View>
              <Text style={[styles.memberSub, { color: c.mutedForeground }]}>
                {b.uid === uid
                  ? `${b.stake.toLocaleString()} at ${formatOdds(b.odds, fmt)} → ${b.potentialPayout.toLocaleString()}`
                  : `at ${formatOdds(b.odds, fmt)}`}
              </Text>
              {b.followOfName ? (
                <Text style={[styles.memberSub, { color: c.subtleForeground }]} numberOfLines={1}>
                  {b.tailOf ? `Tailing ${b.followOfName}` : `Fading ${b.followOfName}`}
                </Text>
              ) : null}
              {tails + fades > 0 ? (
                <Text style={[styles.memberSub, { color: c.league }]}>
                  {[tails ? `${tails} tail${tails === 1 ? "" : "s"}` : null, fades ? `${fades} fade${fades === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>
            <Pill label={label} tone={b.status === "won" ? "positive" : b.status === "lost" ? "negative" : b.status === "pending" ? "league" : "neutral"} />
            <MaterialCommunityIcons name={b.status === "pending" ? "chevron-right" : "information-outline"} size={18} color={c.subtleForeground} />
          </Pressable>

          {canFollow ? (
            already ? (
              <View style={styles.followRow}>
                <Pill label={already === "tail" ? "You tailed this" : "You faded this"} tone="league" icon={already === "tail" ? "account-multiple-plus" : "account-switch"} />
              </View>
            ) : (
              <View style={styles.followRow}>
                <Pressable
                  accessibilityLabel={`Tail ${b.displayName}: back ${b.teamAbbr}`}
                  onPress={() => startFollow(b, "tail")}
                  hitSlop={6}
                  style={({ pressed }) => [styles.followBtn, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.55), opacity: pressed ? 0.75 : 1 }]}
                >
                  <MaterialCommunityIcons name="account-multiple-plus" size={14} color={c.league} />
                  <Text style={[styles.followText, { color: c.foreground }]}>Tail {b.teamAbbr}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Fade ${b.displayName}: back ${b.opponentAbbr} instead`}
                  onPress={() => startFollow(b, "fade")}
                  hitSlop={6}
                  style={({ pressed }) => [styles.followBtn, { backgroundColor: c.secondary, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
                >
                  <MaterialCommunityIcons name="account-switch" size={14} color={c.mutedForeground} />
                  <Text style={[styles.followText, { color: c.foreground }]}>Fade → {b.opponentAbbr}</Text>
                </Pressable>
              </View>
            )
          ) : null}

          <View style={styles.inline}>
            <ReactionBar
              reactions={b.reactions}
              reactors={b.reactors}
              uid={uid}
              onToggle={(emoji) => (leagueId ? reactToItem(leagueId, "bet", b.id, emoji) : false)}
            />
            {isCreator && leagueId && b.status === "pending" && upcoming && (
              <Pressable
                onPress={() => setVoidTarget(b)}
                style={[styles.miniAction, { borderColor: c.border, backgroundColor: c.secondary }]}
              >
                <MaterialCommunityIcons name="undo-variant" size={12} color={c.negative} />
                <Text style={[styles.miniActionText, { color: c.negative }]}>Void</Text>
              </Pressable>
            )}
            {b.status !== "pending" && b.status !== "cancelled" && (
              <Pressable
                disabled={!!reportedIds[b.id] || !!b.disputed}
                onPress={async () => {
                  await reportResult(league.id, b.id, "Result disputed by member");
                  setReportedIds((p) => ({ ...p, [b.id]: true }));
                }}
                style={[styles.miniAction, { borderColor: c.border, backgroundColor: c.secondary }]}
              >
                <MaterialCommunityIcons name="flag-outline" size={12} color={c.mutedForeground} />
                <Text style={[styles.miniActionText, { color: c.mutedForeground }]}>
                  {reportedIds[b.id] || b.disputed ? "Reported" : "Report result"}
                </Text>
              </Pressable>
            )}
          </View>

          {b.status !== "pending" && (
            <WinLossReplyThread
              parentQuote={quote}
              replies={comments}
              myUid={uid}
              onPressReply={() => setReplyTarget(quote)}
              onPressAuthor={(authorId) => setProfileUid(authorId)}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 10 }}>
      {(league.mode === "pickem" || league.mode === "survivor") && (
        <ModePicksCard league={league} picks={picks} uid={uid} closed={!leagueId} />
      )}
      {league.mode === "bracket" && <BracketFill league={league} uid={uid} />}

      <ParlaysSection league={league} parlays={parlays} uid={uid} closed={!leagueId} fmt={fmt} />

      {bets.length === 0 ? (
        <EmptyState
          icon="ticket-outline"
          title="No League Bets Yet"
          body="Bets placed with this league's tokens show up here — everyone's, so you can see who's swinging big."
          action={leagueId ? "Make the first pick" : undefined}
          onAction={leagueId ? () => router.navigate({ pathname: "/(tabs)/games", params: { wallet: leagueId } }) : undefined}
        />
      ) : (
        <>
          {open.length > 0 && <SectionHeader title={`Open (${open.length})`} />}
          {open.map(row)}
          {settled.length > 0 && <SectionHeader title="Settled Results (Tap for Breakdown)" />}
          {settled.map(row)}
        </>
      )}

      <ConfirmDialog
        visible={!!voidTarget}
        title="Void this league bet?"
        body={
          voidTarget
            ? `Refund ${voidTarget.stake.toLocaleString()} tokens to ${voidTarget.displayName}? This action is logged in the Commissioner Audit Log.`
            : ""
        }
        confirmLabel="Void & refund"
        destructive
        busy={voidBusy}
        onCancel={() => setVoidTarget(null)}
        onConfirm={async () => {
          if (!voidTarget) return;
          setVoidBusy(true);
          await voidLeagueBet(league.id, voidTarget.id, "Voided by commissioner");
          setVoidBusy(false);
          setVoidTarget(null);
        }}
      />

      <BetBreakdownModal
        item={breakdown}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => setQuickGame(gId)}
        onReply={(item) =>
          setReplyTarget({
            id: item.id,
            kind: "bet_result",
            authorUid: item.ownerUid ?? "",
            authorName: item.ownerName ?? "Player",
            text: `${item.label ?? item.teamAbbr} v ${item.opponentAbbr} · ${item.status.toUpperCase()} (${formatOdds(item.odds, fmt)})`,
            betStatus: item.status,
            teamAbbr: item.teamAbbr,
            opponentAbbr: item.opponentAbbr,
            odds: item.odds,
            stake: item.stake,
            payout: item.payout,
            currency: "league",
          })
        }
      />

      <WinLossReplyModal
        target={replyTarget}
        leagueId={league.id}
        onClose={() => setReplyTarget(null)}
        onOpenProfile={(authorId) => {
          setReplyTarget(null);
          setProfileUid(authorId);
        }}
      />

      <PlayerProfileSheet
        uid={profileUid}
        leagueId={league.id}
        onClose={() => setProfileUid(null)}
      />

      <GameQuickView
        gameId={quickGame}
        onClose={() => {
          setQuickGame(null);
          setFollow(null);
        }}
        defaultWallet={leagueId}
        follow={follow}
      />
    </View>
  );
}

function ModePicksCard({
  league,
  picks,
  uid,
  closed,
}: {
  league: League;
  picks: LeaguePick[];
  uid: string | null;
  closed: boolean;
}) {
  const c = useColors();
  const { makePick } = useLeague();
  const { upcoming } = useGames();
  const wk = weekKey();
  const allowedUpcoming = upcoming.filter((g) => league.allowedSports.includes(g.sport) && g.startsAt < league.endsAt).slice(0, 6);
  const myPicksThisWeek = picks.filter((p) => p.uid === uid && p.week === wk);
  const [busyGame, setBusyGame] = useState<string | null>(null);
  const myMem = uid ? league.members[uid] : undefined;
  const isSurvivorOut = !!myMem?.eliminated;

  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.inline}>
        <MaterialCommunityIcons
          name={league.mode === "survivor" ? "skull-outline" : "checkbox-marked-circle-outline"}
          size={18}
          color={c.league}
        />
        <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>
          {league.mode === "survivor" ? `Survivor Pick · ${wk}` : `Weekly Pick'em · ${wk}`}
        </Text>
        <Pill label={`${myPicksThisWeek.length} picked`} tone="league" />
      </View>
      <Text style={[styles.muted, { color: c.mutedForeground }]}>
        {league.mode === "survivor"
          ? isSurvivorOut
            ? `You were eliminated in ${myMem?.eliminatedWeek ?? "an earlier week"}.`
            : "Pick one team to win straight-up this week. Lose and you're eliminated."
          : "Pick winners straight-up across this week's slate — 1 point per win."}
      </Text>
      {!closed && !isSurvivorOut && allowedUpcoming.map((g) => {
        const current = myPicksThisWeek.find((p) => p.gameId === g.id);
        return (
          <View key={g.id} style={[styles.inline, { paddingVertical: 4 }]}>
            <Text style={[styles.memberSub, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
              {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
            </Text>
            {(["away", "home"] as const).map((side) => {
              const team = side === "home" ? g.homeTeam : g.awayTeam;
              const picked = current?.side === side;
              return (
                <Button
                  key={side}
                  size="sm"
                  variant={picked ? "league" : "secondary"}
                  label={team.abbreviation}
                  loading={busyGame === `${g.id}_${side}`}
                  onPress={async () => {
                    setBusyGame(`${g.id}_${side}`);
                    await makePick(league.id, g.id, side);
                    setBusyGame(null);
                  }}
                />
              );
            })}
          </View>
        );
      })}
    </Card>
  );
}

function ParlaysSection({
  league,
  parlays,
  uid,
  closed,
  fmt,
}: {
  league: League;
  parlays: LeagueParlay[];
  uid: string | null;
  closed: boolean;
  fmt: OddsFormat;
}) {
  const c = useColors();
  const { createGroupParlay, addParlayLeg, rideParlay, lockParlay } = useLeague();
  const { upcoming } = useGames();
  const [creating, setCreating] = useState(false);
  const [stake, setStake] = useState("250");
  const [busy, setBusy] = useState<string | null>(null);
  const candidateGame = upcoming.find((g) => league.allowedSports.includes(g.sport) && g.startsAt < league.endsAt && (g.homeTeam.odds ?? 0) > 1);

  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.inline}>
        <MaterialCommunityIcons name="cards-playing-outline" size={18} color={c.league} />
        <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Group Parlays ({parlays.length})</Text>
        {!closed && candidateGame && (
          <Button
            size="sm"
            variant="secondary"
            icon={creating ? "close" : "plus"}
            label={creating ? "Cancel" : "Start parlay"}
            onPress={() => setCreating((v) => !v)}
          />
        )}
      </View>
      <Text style={[styles.muted, { color: c.mutedForeground }]}>
        Build a 2–4 leg ticket together. Friends can add legs or ride the ticket before kickoff.
      </Text>

      {creating && candidateGame && (
        <View style={{ gap: 8 }}>
          <NumericInput
            style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]}
            value={stake}
            onChangeText={(t) => setStake(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="Entry stake per rider"
            placeholderTextColor={c.subtleForeground}
          />
          <View style={styles.inline}>
            {(["away", "home"] as const).map((side) => {
              const t = side === "home" ? candidateGame.homeTeam : candidateGame.awayTeam;
              return (
                <Button
                  key={side}
                  size="sm"
                  variant="league"
                  label={`1st leg: ${t.abbreviation} ML`}
                  loading={busy === `new_${side}`}
                  onPress={async () => {
                    setBusy(`new_${side}`);
                    await createGroupParlay({
                      idempotencyKey: newIdempotencyKey(),
                      leagueId: league.id,
                      stake: Number.parseInt(stake, 10) || 250,
                      leg: {
                        gameId: candidateGame.id,
                        side,
                        market: "ml",
                        selection: side,
                      },
                    });
                    setBusy(null);
                    setCreating(false);
                  }}
                />
              );
            })}
          </View>
        </View>
      )}

      {parlays.map((p) => {
        const riders = Object.values(p.riders ?? {});
        const defaultStake = riders[0]?.stake ?? 250;
        const imRiding = !!(uid && p.riders?.[uid]);
        const nextGame = upcoming.find(
          (g) =>
            league.allowedSports.includes(g.sport) &&
            !p.legs.some((l) => l.gameId === g.id) &&
            (g.homeTeam.odds ?? 0) > 1
        );
        return (
          <View key={p.id} style={[styles.parlayBox, { borderColor: c.border, backgroundColor: c.secondary }]}>
            <View style={styles.inline}>
              <Text style={[styles.memberName, { color: c.foreground, flex: 1 }]}>
                {p.legs.length}-leg parlay · {formatOdds(p.combinedOdds, fmt)}
              </Text>
              <Pill label={p.status.toUpperCase()} tone={p.status === "won" ? "positive" : p.status === "lost" ? "negative" : "league"} />
            </View>
            {p.legs.map((l, i) => (
              <Text key={`${l.gameId}_${i}`} style={[styles.memberSub, { color: c.foreground }]}>
                • {l.label} ({formatOdds(l.odds, fmt)}) — by {l.name}
              </Text>
            ))}
            {p.bustedByName ? (
              <Text style={[styles.memberSub, { color: c.negative }]}>
                💀 Busted by {p.bustedByName}{p.bustedLeg ? ` (${p.bustedLeg})` : ""}
              </Text>
            ) : null}
            <Text style={[styles.memberSub, { color: c.mutedForeground }]}>
              {riders.length} rider{riders.length === 1 ? "" : "s"} ({riders.map((r) => (r.uid === uid ? `${r.name} · ${r.stake.toLocaleString()}` : r.name)).join(", ")})
            </Text>
            {!closed && p.status === "open" && (
              <View style={styles.inline}>
                {nextGame && p.legs.length < 4 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    label={`+ ${nextGame.homeTeam.abbreviation} ML`}
                    loading={busy === `leg_${p.id}`}
                    onPress={async () => {
                      setBusy(`leg_${p.id}`);
                      await addParlayLeg({ leagueId: league.id, parlayId: p.id, gameId: nextGame.id, side: "home", market: "ml", selection: "home" });
                      setBusy(null);
                    }}
                  />
                )}
                {!imRiding && (
                  <Button
                    size="sm"
                    variant="league"
                    label={`Ride (${defaultStake.toLocaleString()})`}
                    loading={busy === `ride_${p.id}`}
                    onPress={async () => {
                      setBusy(`ride_${p.id}`);
                      await rideParlay(league.id, p.id, defaultStake);
                      setBusy(null);
                    }}
                  />
                )}
                {p.creatorUid === uid && p.legs.length >= 2 && (
                  <Button
                    size="sm"
                    variant="primary"
                    label="Lock Ticket"
                    loading={busy === `lock_${p.id}`}
                    onPress={async () => {
                      setBusy(`lock_${p.id}`);
                      await lockParlay(league.id, p.id);
                      setBusy(null);
                    }}
                  />
                )}
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

function ReactionBar({
  reactions,
  reactors,
  uid,
  onToggle,
}: {
  reactions?: Record<string, number>;
  reactors?: Record<string, string>;
  uid: string | null;
  onToggle: (emoji: ReactionEmoji) => unknown;
}) {
  const c = useColors();
  const optimistic = useOptimisticReaction(reactors, uid, reactions);
  return (
    <View style={styles.reactionRow}>
      {REACTION_EMOJIS.map((emoji) => {
        const count = optimistic.counts[emoji] ?? 0;
        const mine = optimistic.mine === emoji;
        return (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            onPress={() => void optimistic.toggle(emoji, (e) => onToggle(e as ReactionEmoji))}
            style={[
              styles.reactionChip,
              {
                backgroundColor: mine ? c.leagueSoft : c.secondary,
                borderColor: mine ? c.league : c.border,
              },
            ]}
          >
            <Text style={{ fontSize: 11 }}>{emoji}</Text>
            {count > 0 ? (
              <Text style={[styles.reactionCount, { color: mine ? c.league : c.mutedForeground }]}>{count}</Text>
            ) : null}
          </Pressable>
        );
      })}
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

  const activeEdges = loans.filter((l) => l.status === "active");
  const lenderBoard = useMemo(() => {
    const map = new Map<string, { id: string; name: string; interestEarned: number; lentCount: number }>();
    for (const l of loans) {
      if (l.kind !== "peer" || !l.lenderId) continue;
      if (l.status !== "active" && l.status !== "repaid") continue;
      const cur = map.get(l.lenderId) ?? { id: l.lenderId, name: l.lenderName ?? "Lender", interestEarned: 0, lentCount: 0 };
      cur.interestEarned += l.interestPaid ?? 0;
      cur.lentCount += 1;
      map.set(l.lenderId, cur);
    }
    return [...map.values()].sort((a, b) => b.interestEarned - a.interestEarned || b.lentCount - a.lentCount);
  }, [loans]);

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <Text style={[styles.cardTitle, { color: c.foreground }]}>Your Finances</Text>
        <View style={styles.hero}>
          <StatTile label="Tokens">
            <Amount value={tokens} currency="league" size="sm" animate />
          </StatTile>
          <StatTile label="Owed">
            <Amount value={totals.owed} currency="league" size="sm" tone={totals.owed ? "debt" : "neutral"} />
          </StatTile>
          <StatTile label="Net Worth">
            <Amount value={me?.netWorth ?? tokens} currency="league" size="sm" />
          </StatTile>
        </View>
        {tokens === 0 && activeMine.length === 0 && !closed && uid && !league.members[uid]?.resetUsed ? (
          <ActionChip
            label={`Fresh start: reset to ${Math.floor(league.startingLeagueTokens * 0.25).toLocaleString()} (once per league)`}
            icon="restart"
            chevron={false}
            tone="league"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api.requestReset({ leagueId: league.id });
              } catch (e) {
                setErr(api.friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
        {activeMine.length > 0 && (
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            {totals.principal.toLocaleString()} principal outstanding · {totals.charged.toLocaleString()} flat interest, {totals.paid.toLocaleString()} of it paid.
          </Text>
        )}
      </Card>

      {(activeEdges.length > 0 || lenderBoard.length > 0) && (
        <Card style={{ gap: 8 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="graph-outline" size={18} color={c.league} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Who owes who & Loan Sharks</Text>
          </View>
          {activeEdges.map((l) => {
            const snap = loanSnapshot(l, asOf);
            return (
              <View key={l.id} style={styles.inline}>
                <Text style={[styles.memberSub, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                  {l.borrowerId === uid ? "You" : l.borrowerName} → {l.kind === "bank" ? "The House" : l.lenderId === uid ? "You" : l.lenderName}
                </Text>
                <Amount value={snap.totalOwed} currency="league" size="sm" tone="debt" />
              </View>
            );
          })}
          {lenderBoard.length > 0 && (
            <View style={{ gap: 4, marginTop: 4 }}>
              <Text style={[styles.champK, { color: c.subtleForeground }]}>TOP PEER LENDERS (INTEREST EARNED)</Text>
              {lenderBoard.map((row, idx) => (
                <View key={row.id} style={styles.inline}>
                  <Text style={[styles.memberSub, { color: c.foreground, flex: 1 }]}>
                    {idx === 0 ? "🦈 " : ""}{row.id === uid ? "You" : row.name} ({row.lentCount} loan{row.lentCount === 1 ? "" : "s"})
                  </Text>
                  <Amount value={row.interestEarned} currency="league" size="sm" signed tone="positive" />
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      {league.stimulusEnabled && !closed ? <StimulusCard league={league} uid={uid} now={now} /> : null}

      {!closed && <PeerMarket league={league} loans={loans} uid={uid} tokens={tokens} />}

      {league.bankLoanEnabled && !closed ? (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="home-city-outline" size={18} color={c.league} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>The House</Text>
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
                buzz.success();
                setAmount("");
              }
            }}
          />
        </Card>
      ) : !closed ? (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="home-off-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>The House Is Closed</Text>
          </View>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            {isCreator
              ? "Open it so members can borrow league tokens for a flat fee."
              : "Only the league creator can open The House. You can still borrow from friends above."}
          </Text>
          {err ? <Text style={[styles.muted, { color: c.negative }]}>{err}</Text> : null}
          {isCreator && (
            <Button
              label={`Open The House · ${league.bankInterestRate || 10}% flat`}
              icon="home-city-outline"
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

      {mine.length > 0 && <SectionHeader title="What You Owe" />}
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

/** Stimulus: ask The House to top everyone up; a majority yes pays out. */
function StimulusCard({ league, uid, now }: { league: League; uid: string | null; now: number }) {
  const c = useColors();
  const { stimulus } = useLeague();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = league.stimulus && league.stimulus.expiresAt > now ? league.stimulus : null;
  const needed = Math.floor(league.memberIds.length / 2) + 1;
  const iVoted = !!(open && uid && open.votes.includes(uid));
  const cooldownLeft = league.lastStimulusAt ? league.lastStimulusAt + 7 * 86_400_000 - now : 0;
  const act = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setErr(null);
    const e = await fn();
    setBusy(null);
    if (e) setErr(e);
    else buzz.success();
  };
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.inline}>
        <MaterialCommunityIcons name="cash-plus" size={18} color={c.positive} />
        <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Stimulus Vote</Text>
        {open ? <Pill label={`${open.votes.length}/${needed} yes`} tone="positive" /> : null}
      </View>
      {open ? (
        <>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            {open.uid === uid ? "You" : open.name} asked The House to give every member {open.amount.toLocaleString()} tokens ({open.pct}% of the
            starting stack). It pays out the moment {needed} of {league.memberIds.length} members say yes · closes{" "}
            {new Date(open.expiresAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.
          </Text>
          <View style={styles.inline}>
            <Button
              label={iVoted ? "You voted yes · undo" : `Vote yes (+${open.amount.toLocaleString()})`}
              variant={iVoted ? "secondary" : "primary"}
              icon={iVoted ? "undo" : "thumb-up-outline"}
              size="sm"
              loading={busy === "vote"}
              onPress={() => act("vote", () => stimulus({ leagueId: league.id, action: "vote", requestId: open.id, approve: !iVoted }))}
            />
            {open.uid === uid || league.creatorId === uid ? (
              <Button
                label="Withdraw"
                variant="ghost"
                size="sm"
                loading={busy === "cancel"}
                onPress={() => act("cancel", () => stimulus({ leagueId: league.id, action: "cancel", requestId: open.id }))}
              />
            ) : null}
          </View>
        </>
      ) : cooldownLeft > 0 ? (
        <Text style={[styles.muted, { color: c.mutedForeground }]}>
          The last stimulus paid out recently. You can ask again in {Math.ceil(cooldownLeft / 86_400_000)} day{Math.ceil(cooldownLeft / 86_400_000) === 1 ? "" : "s"}.
        </Text>
      ) : (
        <>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            Stacks running low? Ask The House to give everyone the same top-up. It's free money, not a loan, and needs {needed} of{" "}
            {league.memberIds.length} members to agree.
          </Text>
          <View style={styles.inline}>
            {STIMULUS_PCTS.map((pct) => {
              const amt = Math.round((league.startingLeagueTokens * pct) / 100);
              return (
                <Button
                  key={pct}
                  label={`${pct}% · ${amt.toLocaleString()}`}
                  variant="secondary"
                  size="sm"
                  loading={busy === `req${pct}`}
                  onPress={() => act(`req${pct}`, () => stimulus({ leagueId: league.id, action: "request", pct }))}
                />
              );
            })}
          </View>
        </>
      )}
      {league.stimulusTotal ? (
        <Text style={[styles.memberSub, { color: c.subtleForeground }]}>Paid out so far: {league.stimulusTotal.toLocaleString()} tokens per member.</Text>
      ) : null}
      {err ? <Text style={[styles.memberSub, { color: c.negative }]}>{err}</Text> : null}
    </Card>
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

  if (!canRequest && open.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      {canRequest ? (
        <>
          <SectionHeader title="Loans From Friends" />
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
        <SectionHeader title="Open Loan Requests" />
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
          <TextInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={msg} onChangeText={setMsg} placeholder="Note (optional)" placeholderTextColor={c.subtleForeground} maxLength={80} />
          <Button
            label="Post Request"
            variant="league"
            loading={busy === "req"}
            disabled={amt < 10 || amt > max || !(r > 0 && r <= 50)}
            onPress={async () => {
              const e = await act("req", () => requestLoan(league.id, amt, r, msg));
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
      {open.map((l) => {
        const mineReq = l.borrowerId === uid;
        const countered = l.status === "countered";
        const declined = !!(uid && l.declinedBy?.includes(uid));
        const baseRate = l.proposedRate ?? league.bankInterestRate ?? 0;
        const shownRate = countered && l.counterRate ? l.counterRate : baseRate;
        const shownInterest = flatInterest(l.principal, shownRate);
        return (
          <Card key={l.id} style={{ gap: 8 }}>
            <View style={styles.inline}>
              <Text style={[styles.memberName, { color: c.foreground, flex: 1 }]}>
                {mineReq ? "Your request" : `${l.borrowerName} wants`} · {l.principal.toLocaleString()}
              </Text>
              <Pill label={`+${shownInterest.toLocaleString()} (${shownRate}% flat)`} tone="league" />
            </View>
            {l.message ? <Text style={[styles.muted, { color: c.mutedForeground }]}>"{l.message}"</Text> : null}
            {countered && <Text style={[styles.memberSub, { color: c.accent }]}>{l.counterByName} countered at {l.counterRate}% flat (+{shownInterest.toLocaleString()} interest)</Text>}
            {mineReq ? (
              <View style={styles.inline}>
                {countered && (
                  <>
                    <Button size="sm" label={`Accept ${l.counterRate}%`} variant="league" loading={busy === `acc${l.id}`} onPress={() => act(`acc${l.id}`, () => peerLoanAction(league.id, l.id, "accept_counter"))} />
                    <Button size="sm" label="Decline" variant="secondary" loading={busy === `rj${l.id}`} onPress={() => act(`rj${l.id}`, () => peerLoanAction(league.id, l.id, "reject_counter"))} />
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

// ── Unified Chat & Activity Feed (Newest at Bottom + Fixed Bottom Input) ───

function formatChatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function chatDayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatChatDayPill(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yest = new Date(now.getTime() - 86_400_000);
  const yestKey = `${yest.getFullYear()}-${yest.getMonth()}-${yest.getDate()}`;
  const key = chatDayKey(at);
  if (key === todayKey) return "Today";
  if (key === yestKey) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

const CHAT_NAME_COLORS = ["#FF7A1A", "#2EE6A6", "#4C9BFF", "#B97BFF", "#FFC23D", "#FF5C8A"];
function chatSenderColor(senderUid: string): string {
  let h = 0;
  for (let i = 0; i < senderUid.length; i++) h = (h * 31 + senderUid.charCodeAt(i)) | 0;
  return CHAT_NAME_COLORS[Math.abs(h) % CHAT_NAME_COLORS.length]!;
}

function FeedTab({
  league,
  activity,
  messages,
  bets,
  uid,
  now,
  closed,
  fmt,
  bottomPad,
}: {
  league: League;
  activity: Array<{ id: string; type: string; uid?: string; name?: string; text: string; at: number }>;
  messages: LeagueMessage[];
  bets: LeagueBet[];
  uid: string | null;
  now: number;
  closed: boolean;
  fmt: OddsFormat;
  bottomPad: number;
}) {
  const c = useColors();
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { sendMessage, reactToItem } = useLeague();
  const { leagueReplyQuotes, recordLeagueMessageQuote, setActiveChatId } = useChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyQuote, setReplyQuote] = useState<ReplyQuote | null>(null);
  const [activeMenuMsgId, setActiveMenuMsgId] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [follow, setFollow] = useState<FollowIntent | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);

  useEffect(() => {
    setActiveChatId(league.id);
    return () => setActiveChatId(null);
  }, [league.id, setActiveChatId]);

  // Orient chronologically: oldest at top, newest messages at the bottom!
  const items = useMemo(() => {
    const merged: Array<
      | { kind: "msg"; at: number; m: LeagueMessage }
      | { kind: "act"; at: number; a: { id: string; type: string; uid?: string; name?: string; text: string; at: number } }
    > = [
      ...messages.map((m) => ({ kind: "msg" as const, at: m.at, m })),
      ...activity.map((a) => ({ kind: "act" as const, at: a.at, a })),
    ];
    return merged.sort((x, y) => x.at - y.at);
  }, [messages, activity]);

  const betById = useMemo(() => {
    const map = new Map<string, LeagueBet>();
    for (const b of bets) map.set(b.id, b);
    return map;
  }, [bets]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    buzz.light();
    setSendErr(null);
    setActiveMenuMsgId(null);
    const quote = replyQuote
      ? (Object.fromEntries(Object.entries(replyQuote).filter(([, v]) => v !== undefined)) as ReplyQuote)
      : null;
    const err = await sendMessage(league.id, body, quote);
    setSending(false);
    if (err) setSendErr(err);
    else {
      if (replyQuote) {
        recordLeagueMessageQuote(`msg_${Date.now()}`, replyQuote);
      }
      setText("");
      setReplyQuote(null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const outgoingBubbleBg = "#007AFF";
  const incomingBubbleBg = c.isDark ? "#1C1E26" : "#E9E9EB";
  const chatWallpaperBg = c.isDark ? "#090A0F" : "#F2F2F7";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: chatWallpaperBg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16, flexGrow: 1, justifyContent: "flex-end" }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {items.length === 0 ? (
          <View style={{ paddingVertical: 36, alignItems: "center" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 14,
                backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
              }}
            >
              <MaterialCommunityIcons name="trophy-outline" size={14} color={c.league} />
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.mutedForeground, textAlign: "center" }}>
                Nothing yet — drop a message below or place the first league bet.
              </Text>
            </View>
          </View>
        ) : (
          items.map((item, idx) => {
            const prev = idx > 0 ? items[idx - 1] : null;
            const next = idx < items.length - 1 ? items[idx + 1] : null;
            const showDateHeader = !prev || chatDayKey(prev.at) !== chatDayKey(item.at);

            if (item.kind === "act") {
              const a = item.a;
              const isWinAct = a.type === "bet_won";
              const isLossAct = a.type === "bet_lost";
              return (
                <View key={`act_${a.id}`} style={{ marginTop: 6 }}>
                  {showDateHeader ? (
                    <View style={{ alignItems: "center", marginVertical: 8 }}>
                      <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.mutedForeground }}>{formatChatDayPill(a.at)}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={{ alignItems: "center", marginVertical: 2 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 14,
                        maxWidth: "90%",
                        backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                      }}
                    >
                      <MaterialCommunityIcons
                        name={FEED_ICON[a.type] ?? "circle-small"}
                        size={14}
                        color={isWinAct ? c.positive : isLossAct ? c.negative : c.mutedForeground}
                      />
                      <Pressable disabled={!a.uid} onPress={() => a.uid && setProfileUid(a.uid)} style={{ flexShrink: 1 }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: c.mutedForeground }}>{a.text}</Text>
                      </Pressable>
                      {!closed && (isWinAct || isLossAct || a.type === "bet_placed") ? (
                        <Pressable
                          hitSlop={8}
                          onPress={() => {
                            buzz.tick();
                            setReplyQuote({
                              id: a.id,
                              kind: "bet_result",
                              authorUid: a.uid ?? "",
                              authorName: a.name ?? "Player",
                              text: a.text,
                              betStatus: isWinAct ? "won" : isLossAct ? "lost" : "pending",
                            });
                          }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#007AFF" }}>Reply</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }

            const m = item.m;
            if (m.kind === "system") {
              return (
                <View key={`msg_${m.id}`} style={{ marginTop: 6 }}>
                  {showDateHeader ? (
                    <View style={{ alignItems: "center", marginVertical: 8 }}>
                      <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.mutedForeground }}>{formatChatDayPill(m.at)}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={{ alignItems: "center", marginVertical: 2 }}>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, maxWidth: "85%", backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: c.mutedForeground, textAlign: "center" }}>{chatText(m.text)}</Text>
                    </View>
                  </View>
                </View>
              );
            }

            const mine = m.uid === uid;
            const attached = m.betId ? betById.get(m.betId) : undefined;
            const quote = m.replyTo ?? leagueReplyQuotes[m.id] ?? null;
            const sameAsPrev =
              !showDateHeader &&
              prev?.kind === "msg" &&
              prev.m.kind !== "system" &&
              prev.m.uid === m.uid &&
              m.at - prev.at < 5 * 60_000;
            const sameAsNext =
              !!next &&
              next.kind === "msg" &&
              next.m.kind !== "system" &&
              chatDayKey(next.at) === chatDayKey(m.at) &&
              next.m.uid === m.uid &&
              next.at - m.at < 5 * 60_000;
            const isFirstInGroup = !sameAsPrev;
            const isLastInGroup = !sameAsNext;
            const initials = (m.name || "P")
              .split(" ")
              .map((s: string) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const nameTint = chatSenderColor(m.uid);
            const menuOpen = activeMenuMsgId === m.id;
            const myReaction = uid ? m.reactors?.[uid] ?? null : null;

            return (
              <View key={`msg_${m.id}`} style={{ marginTop: sameAsPrev ? 2 : 10 }}>
                {showDateHeader ? (
                  <View style={{ alignItems: "center", marginVertical: 8 }}>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.mutedForeground }}>{formatChatDayPill(m.at)}</Text>
                    </View>
                  </View>
                ) : null}

                <View style={[{ maxWidth: "82%" }, mine ? { alignSelf: "flex-end", alignItems: "flex-end" } : { alignSelf: "flex-start" }]}>
                  <View style={[{ flexDirection: "row", alignItems: "flex-end", gap: 6 }, mine && { justifyContent: "flex-end" }]}>
                    {!mine ? (
                      isLastInGroup ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`View ${m.name}'s profile`}
                          onPress={() => setProfileUid(m.uid)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: c.border,
                            backgroundColor: c.secondary,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: nameTint }}>{initials}</Text>
                        </Pressable>
                      ) : (
                        <View style={{ width: 28, height: 28 }} />
                      )
                    ) : null}

                    <View style={{ flexShrink: 1, alignItems: mine ? "flex-end" : "flex-start" }}>
                      <Pressable
                        onPress={() => {
                          if (closed) return;
                          buzz.tick();
                          setActiveMenuMsgId((cur) => (cur === m.id ? null : m.id));
                        }}
                        onLongPress={() => {
                          if (closed) return;
                          buzz.medium();
                          setActiveMenuMsgId(m.id);
                        }}
                        style={[
                          {
                            borderRadius: 20,
                            paddingHorizontal: 12,
                            paddingTop: 8,
                            paddingBottom: 7,
                            minWidth: 68,
                            gap: 4,
                          },
                          mine
                            ? {
                                backgroundColor: outgoingBubbleBg,
                                borderTopRightRadius: sameAsPrev ? 8 : 20,
                                borderBottomRightRadius: isLastInGroup ? 4 : 8,
                              }
                            : {
                                backgroundColor: incomingBubbleBg,
                                borderColor: c.border,
                                borderWidth: c.isDark ? StyleSheet.hairlineWidth : 0,
                                borderTopLeftRadius: sameAsPrev ? 8 : 20,
                                borderBottomLeftRadius: isLastInGroup ? 4 : 8,
                              },
                        ]}
                      >
                        {!mine && isFirstInGroup ? (
                          <Pressable onPress={() => setProfileUid(m.uid)}>
                            <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: nameTint, marginBottom: 1 }}>{m.name}</Text>
                          </Pressable>
                        ) : null}

                        {quote ? (
                          <View
                            style={{
                              borderLeftWidth: 3,
                              borderLeftColor: mine ? "#FFFFFF" : quote.betStatus === "won" ? "#2EE6A6" : quote.betStatus === "lost" ? "#FF4D63" : "#007AFF",
                              borderRadius: 8,
                              paddingHorizontal: 9,
                              paddingVertical: 5,
                              marginBottom: 2,
                              backgroundColor: mine ? "rgba(0,0,0,0.18)" : c.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                            }}
                          >
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: mine ? "#FFFFFF" : "#007AFF" }} numberOfLines={1}>
                              {quote.authorName}
                              {quote.kind === "bet_result" && quote.betStatus ? ` · ${quote.betStatus.toUpperCase()}` : ""}
                            </Text>
                            <Text
                              style={{
                                fontSize: 12,
                                lineHeight: 16,
                                fontFamily: "Inter_400Regular",
                                color: mine ? "rgba(255,255,255,0.86)" : c.mutedForeground,
                              }}
                              numberOfLines={2}
                            >
                              {chatText(quote.text)}
                            </Text>
                          </View>
                        ) : null}

                        {m.kind === "taunt" ? (
                          <TauntCard taunt={m} />
                        ) : m.kind === "bet" ? (
                          <BetChatCard
                            message={m}
                            uid={uid}
                            leagueId={league.id}
                            now={now}
                            onTail={(gameId, intent) => {
                              if (closed) return;
                              setFollow(intent);
                              setQuickGame(gameId);
                            }}
                          />
                        ) : attached && !attached.hidden ? (
                          <View style={[styles.parlayBox, { borderColor: c.border, backgroundColor: c.secondary }]}>
                            <Text style={[styles.memberSub, { color: c.foreground }]}>
                              🎟 {attached.label ?? attached.teamAbbr} @ {formatOdds(attached.odds, fmt)}
                            </Text>
                          </View>
                        ) : null}

                        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "flex-end", columnGap: 8, rowGap: 2 }}>
                          <Text style={{ fontSize: 15, lineHeight: 20, fontFamily: "Inter_400Regular", color: mine ? "#FFFFFF" : c.foreground, flexShrink: 1 }}>
                            {chatText(m.text)}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-end", marginBottom: -1 }}>
                            <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: mine ? "rgba(255,255,255,0.72)" : c.subtleForeground }}>
                              {formatChatClock(m.at)}
                            </Text>
                            {mine ? (
                              <MaterialCommunityIcons name="check-all" size={14} color="rgba(255,255,255,0.85)" style={{ marginLeft: 2 }} />
                            ) : null}
                          </View>
                        </View>
                      </Pressable>

                      <ReactionRow
                        reactions={m.reactions}
                        reactors={m.reactors}
                        uid={uid}
                        align={mine ? "right" : "left"}
                        compact
                        canReact={!closed}
                        onReact={(emoji) => (closed ? false : reactToItem(league.id, "message", m.id, emoji as never))}
                      />
                    </View>
                  </View>

                  {menuOpen && !closed ? (
                    <View style={[{ marginTop: 6, marginBottom: 4, gap: 6 }, mine ? { alignSelf: "flex-end" } : { alignSelf: "flex-start", marginLeft: 34 }]}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 2,
                          paddingHorizontal: 6,
                          paddingVertical: 4,
                          borderRadius: 999,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: c.border,
                          backgroundColor: c.elevated,
                        }}
                      >
                        {REACTION_EMOJIS.map((emoji) => (
                          <Pressable
                            key={emoji}
                            onPress={() => {
                              buzz.tick();
                              void reactToItem(league.id, "message", m.id, emoji);
                              setActiveMenuMsgId(null);
                            }}
                            style={[
                              { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
                              myReaction === emoji && { backgroundColor: c.isDark ? "rgba(0,122,255,0.28)" : "#E5F1FF" },
                            ]}
                          >
                            <Text style={{ fontSize: 18 }}>{emoji}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          alignSelf: "flex-start",
                          borderRadius: 12,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: c.border,
                          backgroundColor: c.elevated,
                          overflow: "hidden",
                        }}
                      >
                        <Pressable
                          onPress={() => {
                            buzz.tick();
                            setReplyQuote({
                              id: m.id,
                              kind: m.kind === "bet" ? "bet_result" : "message",
                              authorUid: m.uid,
                              authorName: m.name,
                              text: chatText(m.text),
                            });
                            setActiveMenuMsgId(null);
                          }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7 }}
                        >
                          <MaterialCommunityIcons name="reply-outline" size={15} color="#007AFF" />
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#007AFF" }}>Reply</Text>
                        </Pressable>
                        {!mine && m.kind === "text" ? (
                          <Pressable
                            onPress={() => {
                              buzz.tick();
                              setReportTarget({
                                kind: "league_message",
                                uid: m.uid,
                                name: m.name,
                                path: `leagues/${league.id}/messages/${m.id}`,
                                text: m.text,
                              });
                              setActiveMenuMsgId(null);
                            }}
                            style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7 }}
                          >
                            <MaterialCommunityIcons name="flag-outline" size={14} color={c.negative} />
                            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.negative }}>Report</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {!closed && (
        <View
          style={{
            backgroundColor: c.isDark ? "rgba(18, 20, 28, 0.98)" : "rgba(249, 249, 251, 0.98)",
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            paddingBottom: Math.max(10, bottomPad - 12),
          }}
        >
          <ReplyComposerBar quote={replyQuote} onCancel={() => setReplyQuote(null)} />
          {sendErr ? (
            <Text accessibilityRole="alert" style={{ color: c.negative, fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 14, paddingTop: 8 }}>
              {sendErr}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 10, paddingTop: 8 }}>
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "flex-end",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                backgroundColor: c.isDark ? "#1C1E26" : "#FFFFFF",
                borderRadius: 20,
                paddingLeft: 14,
                paddingRight: 5,
                paddingVertical: 4,
                minHeight: 38,
                maxHeight: 110,
              }}
            >
              <TextInput
                style={{
                  flex: 1,
                  fontSize: 15,
                  lineHeight: 20,
                  fontFamily: "Inter_400Regular",
                  color: c.foreground,
                  paddingTop: Platform.OS === "ios" ? 5 : 4,
                  paddingBottom: Platform.OS === "ios" ? 5 : 4,
                  paddingRight: 8,
                }}
                value={text}
                onChangeText={setText}
                placeholder={replyQuote ? `Reply to ${replyQuote.authorName}…` : `Message ${league.name}…`}
                placeholderTextColor={c.mutedForeground}
                maxLength={400}
                multiline
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={handleSend}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={!text.trim() || sending}
                onPress={handleSend}
                style={({ pressed }) => ({
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: text.trim() ? "#007AFF" : c.isDark ? "rgba(255,255,255,0.08)" : "#E5E5EA",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <MaterialCommunityIcons name="arrow-up" size={18} color={text.trim() ? "#FFFFFF" : c.mutedForeground} />
              </Pressable>
            </View>
          </View>
        </View>
      )}

      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
      <PlayerProfileSheet
        uid={profileUid}
        leagueId={league.id}
        onClose={() => setProfileUid(null)}
      />
      <GameQuickView
        gameId={quickGame}
        onClose={() => {
          setQuickGame(null);
          setFollow(null);
        }}
        defaultWallet={league.id}
        follow={follow}
      />
    </KeyboardAvoidingView>
  );
}

// ── Info & settings ────────────────────────────────────────────────────────

function InfoTab({
  league,
  betsCount,
  audit,
  uid,
  closed,
  onInvite,
}: {
  league: League;
  betsCount: number;
  audit: LeagueAuditEntry[];
  uid: string | null;
  closed: boolean;
  onInvite: () => void;
}) {
  const c = useColors();
  const { updateBankSettings, updateLeagueSettings, voteEndLeague, endLeague, leaveLeague } = useLeague();
  const isCreator = league.creatorId === uid;
  const preset = PRIZE_PRESETS.find((p) => p.value === league.prizeDistribution.preset);
  const [enabled, setEnabled] = useState(league.bankLoanEnabled);
  const [rate, setRate] = useState(String(league.bankInterestRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"end" | "leave" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState<string | null>(null);
  const [voteBusy, setVoteBusy] = useState(false);

  const [editMode, setEditMode] = useState<LeagueMode>(league.mode ?? "bankroll");
  const [editMatchups, setEditMatchups] = useState<boolean>(league.matchupsEnabled !== false);
  const [editCadence, setEditCadence] = useState<MatchupCadence>(league.matchupCadence ?? "weekly");
  const [stimOn, setStimOn] = useState(!!league.stimulusEnabled);
  const [stimBusy, setStimBusy] = useState(false);
  const [editRulesBusy, setEditRulesBusy] = useState(false);
  const [editRulesMsg, setEditRulesMsg] = useState<string | null>(null);

  const shares = useMemo(() => prizeSplit(league.pot, league.prizeDistribution, Math.max(3, league.memberIds.length)), [league]);
  const votes = league.endVotes ?? [];
  const neededVotes = Math.floor(league.memberIds.length / 2) + 1;
  const iVoted = !!(uid && votes.includes(uid));

  const rows: Array<[string, string]> = [
    ["Status", closed ? "Closed" : "Active"],
    ["Format", LEAGUE_MODES.find((m) => m.value === (league.mode ?? "bankroll"))?.label ?? "Bankroll"],
    ...(closed || isLeagueStarted(league) ? [] : [["Invite code", league.code] as [string, string]]),
    [isLeagueStarted(league) ? "Started" : "Starts", new Date(leagueStartsAt(league)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })],
    ["Starting tokens", league.startingLeagueTokens.toLocaleString()],
    ["Buy-in", league.buyIn > 0 ? `${league.buyIn.toLocaleString()} credits` : "Free"],
    ["Prize pot", `${league.pot.toLocaleString()} credits`],
    ["Prize split", preset?.label ?? "Custom"],
    ["Sports", league.allowedSports.join(", ")],
    ["Length", league.duration === "Full Season" ? "Full season (follows the sports' calendars)" : league.duration ?? `${league.durationWeeks ?? "–"} weeks`],
    [closed ? "Ended" : "Ends", new Date(league.endedAt ?? league.endsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })],
    ["Matchups", league.mode === "matchups" || league.matchupsEnabled ? cadenceLabel(league.matchupCadence) : "Off"],
    ["The House", league.bankLoanEnabled ? `${league.bankInterestRate}% flat` : "Closed"],
    ["Stimulus votes", league.stimulusEnabled ? "On" : "Off"],
  ];

  return (
    <View style={{ gap: 12 }}>
      {!closed && !isLeagueStarted(league) && (
        <Card style={styles.qrCard}>
          <InviteQR value={inviteLink(league.code)} size={168} accessibilityLabel={`QR code to join ${league.name}, code ${league.code}`} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>Scan to Join</Text>
            <Text style={[styles.muted, { color: c.mutedForeground }]}>
              Point a phone camera at this to open {league.name} in SportDrip{league.buyIn > 0 ? ` (${league.buyIn.toLocaleString()}-credit buy-in)` : ""}.
            </Text>
            <Text style={[styles.qrCode, { color: c.foreground }]} selectable>
              {league.code}
            </Text>
            <Button size="sm" variant="secondary" icon="share-variant" label="Share Link" onPress={onInvite} />
          </View>
        </Card>
      )}
      <PredictionsCard league={league} />
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
          <Text style={[styles.memberSub, { color: c.subtleForeground }]}>Paid in credits when the season ends. Tied net worths split their shared positions equally.</Text>
        </Card>
      )}

      {isCreator && !closed && betsCount === 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Pre-season rules (before 1st bet)</Text>
          <SegmentedControl
            value={editMode}
            onChange={setEditMode}
            options={LEAGUE_MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          {editMode !== "matchups" ? (
            <View style={styles.inline}>
              <Text style={[styles.muted, { color: c.foreground, flex: 1 }]}>H2H Matchups</Text>
              <Switch value={editMatchups} onValueChange={setEditMatchups} trackColor={{ false: c.border, true: c.league }} />
            </View>
          ) : null}
          {editMode === "matchups" || editMatchups ? (
            <SegmentedControl
              value={editCadence}
              onChange={setEditCadence}
              options={MATCHUP_CADENCES.map((m) => ({ value: m.value, label: m.label }))}
            />
          ) : null}
          {editRulesMsg ? <Text style={[styles.memberSub, { color: editRulesMsg === "Saved" ? c.positive : c.negative }]}>{editRulesMsg}</Text> : null}
          <Button
            label="Save Rules"
            variant="secondary"
            loading={editRulesBusy}
            onPress={async () => {
              setEditRulesBusy(true);
              const e = await updateLeagueSettings({
                leagueId: league.id,
                mode: editMode,
                matchupsEnabled: editMode === "matchups" || editMatchups,
                matchupCadence: editCadence,
              });
              setEditRulesBusy(false);
              setEditRulesMsg(e ?? "Saved");
            }}
          />
        </Card>
      )}

      {isCreator && !closed && (
        <Card style={{ gap: 10 }}>
          <View style={styles.inline}>
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>The House Settings</Text>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: c.border, true: c.league }} accessibilityLabel="The House open" />
          </View>
          {enabled && (
            <NumericInput style={[styles.field, { color: c.foreground, borderColor: c.border, backgroundColor: c.secondary }]} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="Flat rate % (0.5–50)" placeholderTextColor={c.subtleForeground} accessibilityLabel="Bank rate" />
          )}
          <Text style={[styles.memberSub, { color: c.subtleForeground }]}>Changes apply to new loans. Existing loans keep the terms they were taken at.</Text>
          {saved ? <Text style={[styles.memberSub, { color: saved === "Saved" ? c.positive : c.negative }]}>{saved}</Text> : null}
          <Button
            label="Save House Settings"
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

      {isCreator && !closed && (
        <Card style={{ gap: 8 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="cash-plus" size={18} color={c.positive} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Stimulus Votes</Text>
            <Switch
              value={stimOn}
              disabled={stimBusy}
              accessibilityLabel="Stimulus votes"
              trackColor={{ false: c.border, true: c.positive }}
              onValueChange={async (v) => {
                setStimOn(v);
                setStimBusy(true);
                const e = await updateLeagueSettings({ leagueId: league.id, stimulusEnabled: v });
                setStimBusy(false);
                if (e) setStimOn(!v);
              }}
            />
          </View>
          <Text style={[styles.memberSub, { color: c.subtleForeground }]}>
            Lets any member ask The House to give everyone 10–50% of the starting stack. A majority yes pays all members the same amount (at most once a week). You can switch this on or off any time.
          </Text>
        </Card>
      )}

      {!closed && league.memberIds.length >= 2 && (
        <Card style={{ gap: 8 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="vote-outline" size={18} color={c.league} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Early-end majority vote</Text>
            <Pill label={`${votes.length}/${neededVotes} votes`} tone="league" />
          </View>
          <Text style={[styles.muted, { color: c.mutedForeground }]}>
            Ending a multi-member league early requires a majority vote ({neededVotes} of {league.memberIds.length} members) so no single person can freeze standings mid-slate.
          </Text>
          <Button
            label={iVoted ? "Withdraw my vote to end" : "Vote to end season now"}
            variant={iVoted ? "secondary" : "league"}
            loading={voteBusy}
            onPress={async () => {
              setVoteBusy(true);
              await voteEndLeague(league.id, !iVoted);
              setVoteBusy(false);
            }}
          />
        </Card>
      )}

      {audit.length > 0 && (
        <Card style={{ gap: 8 }}>
          <View style={styles.inline}>
            <MaterialCommunityIcons name="shield-check-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.cardTitle, { color: c.foreground, flex: 1 }]}>Commissioner Audit Log</Text>
          </View>
          {audit.map((a) => (
            <View key={a.id} style={styles.inline}>
              <Text style={[styles.memberSub, { color: c.foreground, flex: 1 }]}>
                {a.name}: {a.action}{a.reason ? ` (${a.reason})` : ""}
              </Text>
              <Text style={[styles.feedTime, { color: c.subtleForeground }]}>
                {new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {!closed && (
        <View style={{ gap: 8 }}>
          {isCreator && league.memberIds.length < 2 && (
            <Button label="End season now & pay out" icon="flag-checkered" variant="secondary" onPress={() => { setDlgErr(null); setConfirm("end"); }} />
          )}
          <Button label="Leave League" icon="exit-to-app" variant="destructive" onPress={() => { setDlgErr(null); setConfirm("leave"); }} />
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
  betTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  followRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  followBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  followText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  reactionRow: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
  reactionChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  reactionCount: { fontSize: 11, fontFamily: "Inter_700Bold" },
  miniAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  miniActionText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  parlayBox: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 6 },
  qrCard: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  qrCode: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: 4 },
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
  champK: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 2 },
  champV: { fontSize: 18, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

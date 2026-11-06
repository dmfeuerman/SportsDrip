import { MaterialCommunityIcons } from "@expo/vector-icons";
import TrophyArt, { trophyLook } from "@/components/TrophyArt";
import { haptic as buzz } from "@/lib/motion";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarHero from "@/components/avatar/AvatarHero";
import { isSceneBackdrop } from "@/components/avatar/AvatarBackdrop";
import BetBreakdownModal, { type BetBreakdownItem } from "@/components/BetBreakdownModal";
import { WinLossReplyThread, type ReplyQuote } from "@/components/chat/ReplyThread";
import WinLossReplyModal from "@/components/chat/WinLossReplyModal";
import GameQuickView from "@/components/GameQuickView";
import KeyboardSheet from "@/components/KeyboardSheet";
import TeamChips from "@/components/TeamChips";
import ReportDialog from "@/components/ReportDialog";
import { blockPlayer, unblockPlayer, useBlockedUids } from "@/lib/blocks";
import { Amount, Button, ChoiceDialog, ConfirmDialog, IconButton, Pill, SegmentedControl, StatTile, TabStrip } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { useApp } from "@/context/AppContext";
import BetRecordPanel from "@/components/BetRecordPanel";
import FriendSendSheet, { type SendTab } from "@/components/chat/FriendSendSheet";
import { useChallenges } from "@/context/ChallengeContext";
import { useChat } from "@/context/ChatContext";
import { useLeague } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import type { FavoriteTeam, ProfileBet, PublicUser } from "@/lib/api";
import { formatOdds, type OddsFormat } from "@/lib/odds";
import { useOddsFormat, useUnseenCount } from "@/lib/settings";

/** What the opener already knows, so the header paints before the fetch lands. */
export interface ProfileSeed {
  displayName: string;
  username?: string;
  avatar?: PublicUser["avatar"] | null;
  equipped?: PublicUser["equipped"];
  moves?: string[];
  favoriteTeams?: FavoriteTeam[];
}

/** League line the standings already computed; not refetched. */
export interface ProfileStanding {
  rank: number;
  of: number;
  netWorth: number;
  tokens: number;
  debt: number;
  receivable: number;
}

type BetTab = "open" | "history";
type Source = "all" | "league";

function ago(at: number | null) {
  if (!at) return "";
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (m < 60) return m < 1 ? "now" : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A player's card: who they are, who they root for, how they bet, and their
 * open and settled bets. Opened from league standings, chats, and the friends list.
 *
 * Includes:
 *  - Direct primary action buttons under profile details: Challenge (1v1) & Invite to League
 *  - Interactive settled bet / result cards that open BetBreakdownModal
 *  - Comment/reply threads on settled win/loss items
 */
export default function PlayerProfileSheet({
  uid,
  onClose,
  leagueId,
  seed,
  standing,
  footer,
  onRemoveFriend,
}: {
  uid: string | null;
  onClose: () => void;
  leagueId?: string;
  seed?: ProfileSeed;
  standing?: ProfileStanding;
  footer?: React.ReactNode;
  /** Friends only: shows a small "Remove friend" link at the bottom of the profile. */
  onRemoveFriend?: (uid: string) => Promise<unknown>;
}) {
  return (
    <KeyboardSheet visible={!!uid} onClose={onClose} style={{ height: "90%", paddingHorizontal: 0, paddingBottom: 0 }} headerStyle={{ marginHorizontal: 16 }}>
      {uid ? <Body key={uid} uid={uid} leagueId={leagueId} seed={seed} standing={standing} footer={footer} onRemoveFriend={onRemoveFriend} onDismiss={onClose} /> : null}
    </KeyboardSheet>
  );
}

function Body({
  uid,
  leagueId,
  seed,
  standing,
  footer,
  onRemoveFriend,
  onDismiss,
}: {
  uid: string;
  leagueId?: string;
  seed?: ProfileSeed;
  standing?: ProfileStanding;
  footer?: React.ReactNode;
  onRemoveFriend?: (uid: string) => Promise<unknown>;
  onDismiss: () => void;
}) {
  const c = useColors();
  const fmt = useOddsFormat();
  const insets = useSafeAreaInsets();
  const { byId } = useCatalog();
  const { profile: myProfile, progress: myProgress, balance: myBalance } = useApp();
  const { activeLeagues, inviteFriend } = useLeague();
  const { headToHead } = useChallenges();
  const { betComments } = useChat();
  const { data, loading, error, reload } = usePlayerProfile(uid, leagueId);

  const [tab, setTab] = useState<BetTab>("open");
  const [source, setSource] = useState<Source>(leagueId ? "league" : "all");
  const [avatarGesture, setAvatarGesture] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showLeagueSelector, setShowLeagueSelector] = useState(false);
  const [editMenu, setEditMenu] = useState(false);
  // Edit actions live on other screens: close the sheet, then go there.
  const goEdit = (to: () => void) => {
    setEditMenu(false);
    onDismiss();
    setTimeout(to, 250);
  };
  const [inviteStatus, setInviteStatus] = useState<Record<string, "busy" | "sent" | "error">>({});
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<BetBreakdownItem | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyQuote | null>(null);
  const [sendTab, setSendTab] = useState<SendTab | null>(null);

  const p = data?.profile;
  const name = p?.displayName ?? seed?.displayName ?? "Player";
  const username = p?.username ?? seed?.username;
  const avatar = p?.avatar ?? seed?.avatar ?? (loading && !data ? null : DEFAULT_AVATAR);
  const equipped = p?.equipped ?? seed?.equipped ?? {};
  const teams = p?.favoriteTeams?.length ? p.favoriteTeams : seed?.favoriteTeams ?? [];
  const relation = data?.relation;
  const isSelf = uid === myProfile?.uid || relation === "self";
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const blocked = useBlockedUids().has(uid);
  const level = isSelf ? myProgress.level : (p?.level ?? null);
  const sceneText = isSceneBackdrop(isSelf ? myProfile?.background : p?.background);

  const hasGlobal = !!data?.bets;
  const hasLeague = !!data?.league;
  const src: Source = hasGlobal && hasLeague ? source : hasLeague ? "league" : "all";
  const bets: ProfileBet[] = (src === "league" ? data?.league?.bets : data?.bets) ?? [];
  const betCurrency = src === "league" ? "league" : "credits";
  const open = bets.filter((b) => b.status === "pending");
  const settled = bets.filter((b) => b.status !== "pending");
  const openNew = useUnseenCount(`profile.${uid ?? ""}.open`, open.map((b) => b.id), !!uid && tab === "open");
  const settledNew = useUnseenCount(`profile.${uid ?? ""}.history`, settled.map((b) => b.id), !!uid && tab === "history");
  const shown = tab === "open" ? open : settled;

  const derived = useMemo(() => {
    const done = settled.filter((b) => b.status === "won" || b.status === "lost");
    let streak = 0;
    const first = done[0]?.status;
    for (const b of done) {
      if (b.status !== first) break;
      streak++;
    }
    const best = done.filter((b) => b.status === "won").reduce((m, b) => Math.max(m, b.potentialPayout - b.stake), 0);
    return { streak: first ? `${first === "won" ? "W" : "L"}${streak}` : "—", best };
  }, [settled]);

  const s = p?.stats;
  const decided = s ? s.betsWon + s.betsLost : 0;
  const hit = decided ? Math.round(((s?.betsWon ?? 0) / decided) * 100) : null;
  const rivalry = data?.league?.rivalry;
  const hasRivalry = !!rivalry && rivalry.myWins + rivalry.theirWins + rivalry.pushes > 0;
  const trophies = p?.trophies ?? [];
  const activePunishment = p?.punishment && p.punishment.expiresAt > Date.now() ? p.punishment : null;

  const h2h = useMemo(() => (isSelf ? null : headToHead(uid)), [isSelf, headToHead, uid]);
  const invitableLeagues = useMemo(
    () => activeLeagues.filter((l) => !l.memberIds.includes(uid)),
    [activeLeagues, uid]
  );

  const handleChallenge = () => {
    buzz.medium();
    onDismiss();
    router.navigate({ pathname: "/(tabs)/games", params: { challenge: uid, challengeName: name } });
  };

  const handleMessage = () => {
    buzz.tick();
    onDismiss();
    router.push({ pathname: "/messages" as never, params: { uid, name } });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView scrollEnabled={!avatarGesture} contentContainerStyle={[styles.body, !footer && { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Header: the same character card as Home */}
        <AvatarHero
          avatar={avatar}
          equipped={equipped}
          catalog={byId}
          moves={p?.moves ?? seed?.moves}
          onGesture={setAvatarGesture}
          background={isSelf ? myProfile?.background : p?.background}
          header={
            <>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  accessibilityRole="header"
                  style={[styles.name, { color: sceneText ? "#FFFFFF" : c.foreground }, sceneText && styles.onScene]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                {username || level ? (
                  <Text style={[styles.handle, { color: sceneText ? "rgba(255,255,255,0.8)" : c.mutedForeground }, sceneText && styles.onScene]}>
                    {[username ? `@${username}` : null, level ? `Level ${level}` : null].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
              </View>
              {standing?.rank === 1 && (
                <View style={[styles.crown, { backgroundColor: c.primary }]}>
                  <MaterialCommunityIcons name="crown" size={16} color={c.primaryForeground} />
                </View>
              )}
              {!isSelf ? (
                <IconButton icon="message-text-outline" label={`Message ${name}`} onPress={handleMessage} />
              ) : (
                <IconButton icon="pencil-outline" label="Edit my profile" onPress={() => setEditMenu(true)} />
              )}
            </>
          }
        />

        <View style={styles.inline}>
          {isSelf && <Pill label="You" tone="accent" />}
          {relation === "friend" && <Pill label="Friend" tone="positive" icon="account-check" />}
          {relation === "league" && <Pill label="League-mate" tone="league" icon="shield-star" />}
          {p?.streak?.count ? <Pill label={`🔥 ${p.streak.count}d streak`} tone="accent" /> : null}
          {activePunishment ? <Pill label={`Last place · ${activePunishment.leagueName}`} tone="negative" icon="emoticon-sad-outline" /> : null}
          {p?.memberSince ? <Text style={[styles.meta, { color: c.subtleForeground }]}>Since {new Date(p.memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</Text> : null}
          {p?.balance != null && (
            <View style={{ marginLeft: "auto" }}>
              <Amount value={p.balance} size="sm" />
            </View>
          )}
        </View>

        {/* Credits brag */}
        {(() => {
          const credits = isSelf ? myBalance : p?.balance;
          if (credits == null) return null;
          return (
            <View style={[styles.brag, { backgroundColor: c.alpha("#FFD54A", 0.12), borderColor: "#FFD54A" }]} accessibilityLabel={`${credits.toLocaleString()} credits`}>
              <View style={styles.inline}>
                <MaterialCommunityIcons name="crown" size={16} color="#FFD54A" />
                <Text style={[styles.bragLabel, { color: "#FFD54A" }]}>{isSelf ? "MY BANKROLL" : "BANKROLL"}</Text>
              </View>
              <Text style={[styles.bragValue, { color: c.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
                {credits.toLocaleString()}
              </Text>
              <Text style={[styles.bragUnit, { color: c.mutedForeground }]}>CREDITS</Text>
            </View>
          );
        })()}

        {/* Primary Friend Profile Actions directly under profile details: Challenge & Invite to League */}
        {!isSelf && (
          <View style={[styles.actionsCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.primaryActionsRow}>
              <Button
                label="Challenge"
                icon="sword-cross"
                variant="primary"
                onPress={handleChallenge}
                style={{ flex: 1 }}
              />
              <Button
                label="Invite to League"
                icon="trophy-outline"
                variant="league"
                onPress={() => {
                  buzz.tick();
                  setShowLeagueSelector((v) => !v);
                }}
                style={{ flex: 1 }}
              />
            </View>

            {relation === "friend" ? (
              <View style={styles.primaryActionsRow}>
                <Button label="Send Clothes" icon="tshirt-crew-outline" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setSendTab("gift")} />
                <Button label="Credits" icon="cash-fast" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setSendTab("credits")} />
                <Button label="Loan" icon="hand-coin-outline" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setSendTab("loan")} />
              </View>
            ) : null}

            {h2h && h2h.won + h2h.lost + h2h.push > 0 ? (
              <Text style={[styles.meta, { color: c.mutedForeground }]}>
                1v1 Challenge Record: You lead {h2h.won}–{h2h.lost}
                {h2h.push ? `–${h2h.push}` : ""} against {name}
              </Text>
            ) : null}

            {/* Inline League Invite Selector */}
            {showLeagueSelector && (
              <View style={[styles.leagueSelectorBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
                <View style={styles.inline}>
                  <MaterialCommunityIcons name="trophy-outline" size={15} color={c.league} />
                  <Text style={[styles.leagueTitle, { color: c.foreground, flex: 1 }]}>
                    Select a league to invite {name}
                  </Text>
                </View>
                {invitableLeagues.length === 0 ? (
                  <View style={styles.inline}>
                    <Text style={[styles.meta, { color: c.mutedForeground, flex: 1 }]}>
                      {activeLeagues.length === 0
                        ? "You don't have any active leagues yet."
                        : `${name} is already a member of all your active leagues.`}
                    </Text>
                    {activeLeagues.length === 0 && (
                      <Button
                        size="sm"
                        label="Create League"
                        variant="league"
                        onPress={() => {
                          onDismiss();
                          router.navigate({ pathname: "/(tabs)/leagues", params: { create: "1" } });
                        }}
                      />
                    )}
                  </View>
                ) : (
                  invitableLeagues.map((lg) => {
                    const key = `${lg.id}:${uid}`;
                    const st = inviteStatus[key];
                    return (
                      <View key={lg.id} style={styles.leagueInviteRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.betTitle, { color: c.foreground }]} numberOfLines={1}>
                            {lg.name}
                          </Text>
                          <Text style={[styles.time, { color: c.mutedForeground }]}>
                            {lg.buyIn > 0 ? `${lg.buyIn.toLocaleString()} credits buy-in` : "Free buy-in"} · Code {lg.code}
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          label={st === "sent" ? "Invited ✓" : st === "error" ? "Retry" : "Send Invite"}
                          variant={st === "sent" ? "secondary" : "league"}
                          loading={st === "busy"}
                          disabled={st === "sent"}
                          onPress={async () => {
                            setInviteStatus((prev) => ({ ...prev, [key]: "busy" }));
                            const err = await inviteFriend(lg.id, uid);
                            setInviteStatus((prev) => ({ ...prev, [key]: err ? "error" : "sent" }));
                          }}
                        />
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {hasRivalry && rivalry && (
          <View style={[styles.rivalryBox, { backgroundColor: c.alpha(c.accent, 0.12), borderColor: c.alpha(c.accent, 0.45) }]}>
            <MaterialCommunityIcons name="sword-cross" size={16} color={c.accent} />
            <Text style={[styles.leagueTitle, { color: c.foreground }]}>
              You're {rivalry.myWins}–{rivalry.theirWins}{rivalry.pushes ? `–${rivalry.pushes}` : ""} vs {name} on opposing league picks
            </Text>
          </View>
        )}

        {(() => {
          const pinned = p?.featuredTrophy ? trophies.find((t) => t.id === p.featuredTrophy) : null;
          return pinned ? (
            <View style={[styles.pinned, { backgroundColor: c.alpha(c.primary, 0.12), borderColor: c.primary }]}>
              {(() => {
                const look = trophyLook(pinned);
                return <TrophyArt design={look.design} metal={look.metal} icon={look.icon} size={60} uid={`pin_${pinned.id}`} />;
              })()}
              <View style={{ flex: 1 }}>
                <Text style={[styles.pinnedKicker, { color: c.primary }]}>FEATURED TROPHY</Text>
                <Text style={[styles.leagueTitle, { color: c.foreground }]}>{pinned.kind === "achievement" ? pinned.title : pinned.title || pinned.leagueName}</Text>
                {pinned.kind !== "achievement" && pinned.leagueName && pinned.leagueName !== pinned.title ? (
                  <Text style={[styles.meta, { color: c.mutedForeground }]}>{pinned.leagueName}</Text>
                ) : null}
              </View>
            </View>
          ) : null;
        })()}
        {trophies.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.section, { color: c.foreground }]}>Trophy Shelf ({trophies.length})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trophyRow}>
              {trophies.map((t, idx) => {
                const look = trophyLook(t);
                return (
                  <View key={`${t.id ?? t.leagueId}_${idx}`} style={styles.trophyMini} accessibilityLabel={t.title}>
                    <TrophyArt design={look.design} metal={look.metal} icon={look.icon} size={44} uid={`shelf_${t.id ?? idx}`} />
                    <Text style={[styles.trophyMiniText, { color: c.mutedForeground }]} numberOfLines={1}>
                      {t.kind === "achievement" ? t.title : t.leagueName ?? t.title}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Favourite teams */}
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: c.foreground }]}>Favorite Teams</Text>
          {teams.length ? (
            <TeamChips teams={teams} max={5} />
          ) : (
            <Text style={[styles.meta, { color: c.subtleForeground }]}>{isSelf ? "Pick yours from the Locker tab." : "None picked yet."}</Text>
          )}
        </View>

        {/* League line */}
        {standing && (
          <View style={[styles.leagueBox, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.4) }]}>
            <View style={styles.inline}>
              <MaterialCommunityIcons name={standing.rank === 1 ? "crown" : "podium"} size={16} color={standing.rank === 1 ? c.primary : c.league} />
              <Text style={[styles.leagueTitle, { color: c.foreground }]}>
                #{standing.rank} of {standing.of}
                {data?.league ? ` · ${data.league.leagueName}` : ""}
              </Text>
            </View>
            <View style={styles.tiles}>
              <StatTile label="Net Worth" style={styles.tile}>
                <Amount value={standing.netWorth} currency="league" size="sm" />
              </StatTile>
              <StatTile label="Tokens" style={styles.tile}>
                <Amount value={standing.tokens} currency="league" size="sm" />
              </StatTile>
              <StatTile label={standing.debt > 0 ? "Owes" : "Record"} style={styles.tile}>
                {standing.debt > 0 ? (
                  <Amount value={standing.debt} currency="league" size="sm" tone="debt" />
                ) : (
                  <Text style={[styles.tileValue, { color: c.foreground }]}>
                    {data?.league ? `${data.league.betsWon}–${data.league.betsLost}` : "—"}
                  </Text>
                )}
              </StatTile>
            </View>
          </View>
        )}

        {/* Lifetime stats */}
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: c.foreground }]}>Career</Text>
          <View style={styles.tiles}>
            <StatTile label="Bets" style={styles.tile}>{s?.betsPlaced ?? "—"}</StatTile>
            <StatTile label="Record" style={styles.tile}>{s ? `${s.betsWon}–${s.betsLost}${s.betsPush ? `–${s.betsPush}` : ""}` : "—"}</StatTile>
            <StatTile label="Hit Rate" style={styles.tile}>{hit === null ? "—" : `${hit}%`}</StatTile>
          </View>
          <View style={styles.tiles}>
            <StatTile label="Won" style={styles.tile}>
              {s ? <Amount value={s.creditsWon} size="sm" /> : "—"}
            </StatTile>
            <StatTile label="Streak" style={styles.tile}>{bets.length ? derived.streak : "—"}</StatTile>
            <StatTile label="Best Hit" style={styles.tile}>
              {derived.best > 0 ? <Amount value={derived.best} currency={betCurrency} size="sm" signed tone="positive" /> : "—"}
            </StatTile>
          </View>
          <BetRecordPanel bets={settled.map((b) => ({ status: b.status, stake: b.stake, potentialPayout: b.potentialPayout, t: b.settledAt ?? b.placedAt ?? 0 }))} />
        </View>

        {/* Bets & Interactive Recent Results */}
        <View style={{ gap: 8 }}>
          <View style={styles.inline}>
            <Text style={[styles.section, { color: c.foreground, flex: 1 }]}>Bets & Recent Results</Text>
            {loading && <ActivityIndicator size="small" color={c.mutedForeground} />}
          </View>

          {error ? (
            <View style={[styles.notice, { borderColor: c.border }]}>
              <Text style={[styles.meta, { color: c.negative, flex: 1 }]}>{error}</Text>
              <Button size="sm" variant="secondary" label="Retry" onPress={reload} />
            </View>
          ) : !data && loading ? null : !hasGlobal && !hasLeague ? (
            <View style={[styles.notice, { borderColor: c.border }]}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={c.mutedForeground} />
              <Text style={[styles.meta, { color: c.mutedForeground, flex: 1 }]}>Become friends with {name} to see their bets.</Text>
            </View>
          ) : (
            <>
              {hasGlobal && hasLeague && (
                <SegmentedControl
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: "league", label: "This League" },
                    { value: "all", label: "All Bets" },
                  ]}
                />
              )}
              <TabStrip
                bleed={false}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "open", label: "Active", badge: openNew || undefined },
                  { value: "history", label: "Recent Results", badge: settledNew || undefined },
                ]}
              />
              {shown.length === 0 ? (
                <Text style={[styles.meta, { color: c.subtleForeground, textAlign: "center", paddingVertical: 12 }]}>
                  {tab === "open" ? "No open bets right now." : "Nothing settled yet."}
                </Text>
              ) : (
                shown.map((b) => {
                  const quote: ReplyQuote = {
                    id: b.id,
                    kind: "bet_result",
                    authorUid: uid,
                    authorName: name,
                    text: `${b.label ?? b.teamName} v ${b.opponentAbbr} · ${b.status.toUpperCase()} (${formatOdds(b.odds, fmt)})`,
                    betStatus: b.status,
                    teamAbbr: b.teamAbbr,
                    opponentAbbr: b.opponentAbbr,
                    odds: b.odds,
                    stake: b.stake,
                    payout: b.potentialPayout,
                    currency: betCurrency,
                  };
                  const comments = betComments[b.id] ?? [];

                  return (
                    <View key={b.id} style={styles.betCardWrap}>
                      <BetRow
                        b={b}
                        currency={betCurrency}
                        fmt={fmt}
                        onPress={() => {
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
                            lock: b.lock,
                            odds: b.odds,
                            stake: b.stake,
                            payout: b.potentialPayout,
                            status: b.status,
                            finalHomeScore: b.finalHomeScore,
                            finalAwayScore: b.finalAwayScore,
                            wallet: betCurrency,
                            leagueId: src === "league" ? leagueId : null,
                            leagueName: src === "league" ? data?.league?.leagueName : null,
                            ownerUid: uid,
                            ownerName: name,
                            placedAtMs: b.placedAt,
                            settledAtMs: b.settledAt,
                          });
                        }}
                      />
                      {/* Reply thread underneath Win/Loss items */}
                      {b.status !== "pending" && (
                        <WinLossReplyThread
                          parentQuote={quote}
                          replies={comments}
                          myUid={myProfile?.uid ?? null}
                          onPressReply={() => setReplyTarget(quote)}
                        />
                      )}
                    </View>
                  );
                })
              )}
            </>
          )}
        </View>

        <ChoiceDialog
          visible={editMenu}
          title="Edit Your Profile"
          body="What do you want to change?"
          actions={[
            { label: "Character & Outfit", icon: "account-edit-outline", onPress: () => goEdit(() => router.push("/customize")) },
            { label: "Favorite Teams", icon: "heart-outline", variant: "secondary", onPress: () => goEdit(() => router.navigate({ pathname: "/(tabs)/avatar", params: { editTeams: "1" } })) },
            { label: "Scene", icon: "image-filter-hdr", variant: "secondary", onPress: () => goEdit(() => router.push({ pathname: "/shop", params: { tab: "backgrounds" } })) },
            { label: "Featured Trophy", icon: "trophy-outline", variant: "secondary", onPress: () => goEdit(() => router.push("/trophies" as never)) },
          ]}
          onCancel={() => setEditMenu(false)}
        />

        {onRemoveFriend && relation === "friend" && !isSelf ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name} as a friend`}
            hitSlop={10}
            disabled={removing}
            onPress={() => setConfirmRemove(true)}
            style={({ pressed }) => [styles.removeLink, { opacity: pressed || removing ? 0.6 : 1 }]}
          >
            <Text style={[styles.removeText, { color: c.negative }]}>Remove Friend</Text>
          </Pressable>
        ) : null}
        {!isSelf ? (
          <View style={styles.safetyRow}>
            <Pressable accessibilityRole="button" onPress={() => setReporting(true)} style={({ pressed }) => [styles.removeLink, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.removeText, { color: c.mutedForeground }]}>Report</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => (blocked ? void unblockPlayer(uid) : setConfirmBlock(true))}
              style={({ pressed }) => [styles.removeLink, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.removeText, { color: c.negative }]}>{blocked ? "Unblock" : "Block"}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <ReportDialog target={reporting ? { kind: "user", uid, name } : null} onClose={() => setReporting(false)} />
      <ConfirmDialog
        visible={confirmBlock}
        title={`Block ${name}?`}
        body="You won't see their messages, they're removed from your friends, and they can't message you or send you friend requests. Unblock any time in Settings."
        confirmLabel="Block"
        destructive
        onCancel={() => setConfirmBlock(false)}
        onConfirm={() => {
          setConfirmBlock(false);
          void blockPlayer(uid).then((err) => {
            if (!err) onDismiss();
          });
        }}
      />
      {footer ? <View style={[styles.footer, { borderTopColor: c.border, paddingBottom: insets.bottom + 16 }]}>{footer}</View> : null}
      {onRemoveFriend ? (
        <ConfirmDialog
          visible={confirmRemove}
          title="Remove friend?"
          body={`${name} will be removed from your friends. You can send a new request later.`}
          confirmLabel="Remove"
          destructive
          busy={removing}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setRemoving(true);
            buzz.light();
            await onRemoveFriend(uid);
            setRemoving(false);
            setConfirmRemove(false);
            onDismiss();
          }}
        />
      ) : null}

      <FriendSendSheet friend={sendTab ? { uid, name } : null} initialTab={sendTab ?? "gift"} onClose={() => setSendTab(null)} />

      <BetBreakdownModal
        item={breakdown}
        onClose={() => setBreakdown(null)}
        onOpenGame={(gId) => setQuickGame(gId)}
        onReply={(item) =>
          setReplyTarget({
            id: item.id,
            kind: "bet_result",
            authorUid: uid,
            authorName: name,
            text: `${item.label ?? item.teamName} v ${item.opponentAbbr} · ${item.status.toUpperCase()} (${formatOdds(item.odds, fmt)})`,
            betStatus: item.status,
            teamAbbr: item.teamAbbr,
            opponentAbbr: item.opponentAbbr,
            odds: item.odds,
            stake: item.stake,
            payout: item.payout,
            currency: item.wallet,
          })
        }
      />

      <WinLossReplyModal
        target={replyTarget}
        leagueId={src === "league" ? leagueId : null}
        onClose={() => setReplyTarget(null)}
      />

      <GameQuickView
        gameId={quickGame}
        onClose={() => setQuickGame(null)}
        defaultWallet={src === "league" ? leagueId : undefined}
        onLeave={onDismiss}
      />
    </View>
  );
}

function BetRow({ b, currency, fmt, onPress }: { b: ProfileBet; currency: "credits" | "league"; fmt: OddsFormat; onPress: () => void }) {
  const c = useColors();
  const label = b.status === "pending" ? "Open" : b.status === "won" ? "Won" : b.status === "lost" ? "Lost" : b.status === "push" ? "Push" : "Void";
  const tone = b.status === "won" ? "positive" : b.status === "lost" ? "negative" : b.status === "pending" ? "accent" : "neutral";
  const mine = b.side === "home" ? b.finalHomeScore : b.finalAwayScore;
  const theirs = b.side === "home" ? b.finalAwayScore : b.finalHomeScore;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens full bet breakdown"
      onPress={onPress}
      style={({ pressed }) => [styles.bet, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: b.teamColor, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.betTitle, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>
            {b.label ?? b.teamName} <Text style={{ color: c.mutedForeground }}>v {b.opponentAbbr}</Text>
          </Text>
          {b.lock ? <Pill label="LOCK" tone="accent" /> : null}
        </View>
        <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
          {b.sport ? `${b.sport} · ` : ""}
          {b.stake.toLocaleString()} @ {formatOdds(b.odds, fmt)} → {b.potentialPayout.toLocaleString()}
          {mine != null && theirs != null ? ` · ${mine}–${theirs}` : ""}
        </Text>
        <Text style={[styles.time, { color: c.subtleForeground }]}>{ago(b.settledAt ?? b.placedAt)} · Tap for breakdown</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Pill label={label} tone={tone} />
        {b.status === "won" ? <Amount value={b.potentialPayout - b.stake} currency={currency} size="sm" signed tone="positive" /> : null}
        {b.status === "lost" ? <Amount value={-b.stake} currency={currency} size="sm" signed tone="negative" /> : null}
      </View>
      <MaterialCommunityIcons name="information-outline" size={18} color={c.subtleForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trophyRow: { gap: 10, paddingRight: 8 },
  trophyMini: { width: 64, alignItems: "center", gap: 2 },
  trophyMiniText: { fontSize: 10, fontFamily: "Inter_600SemiBold", maxWidth: 64 },
  pinned: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, padding: 10 },
  pinnedKicker: { fontSize: 10, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  crown: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_900Black", letterSpacing: -1 },
  handle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  onScene: { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  section: { fontSize: 15, fontFamily: "Inter_700Bold" },
  actionsCard: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  primaryActionsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  leagueSelectorBox: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 8 },
  leagueInviteRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rivalryBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  leagueBox: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  leagueTitle: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 1 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1 },
  tileValue: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  betCardWrap: { gap: 4 },
  bet: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4 },
  betTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  removeLink: { alignSelf: "center", paddingVertical: 8, marginTop: 4 },
  safetyRow: { flexDirection: "row", justifyContent: "center", gap: 24 },
  removeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  brag: { borderWidth: 2, borderRadius: 22, paddingVertical: 18, paddingHorizontal: 16, alignItems: "center", gap: 2, shadowColor: "#FFD54A", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  bragLabel: { fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.5 },
  bragValue: { fontSize: 56, fontFamily: "Inter_900Black", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  bragUnit: { fontSize: 13, fontFamily: "Inter_800ExtraBold", letterSpacing: 3 },
});

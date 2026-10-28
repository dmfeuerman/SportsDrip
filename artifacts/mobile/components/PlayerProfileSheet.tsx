import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarHero from "@/components/avatar/AvatarHero";
import GameQuickView from "@/components/GameQuickView";
import KeyboardSheet from "@/components/KeyboardSheet";
import TeamChips from "@/components/TeamChips";
import { Amount, Button, CloseButton, IconButton, Pill, SegmentedControl, StatTile } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import type { FavoriteTeam, ProfileBet, PublicUser } from "@/lib/api";

/** What the opener already knows, so the header paints before the fetch lands. */
export interface ProfileSeed {
  displayName: string;
  username?: string;
  avatar?: PublicUser["avatar"] | null;
  equipped?: PublicUser["equipped"];
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
 * open and settled bets. Opened from league standings and the friends list.
 * What's shown is decided server-side (getPlayerProfile) — non-friends never
 * receive global bet history.
 */
export default function PlayerProfileSheet({
  uid,
  onClose,
  leagueId,
  seed,
  standing,
  footer,
  options,
}: {
  uid: string | null;
  onClose: () => void;
  leagueId?: string;
  seed?: ProfileSeed;
  standing?: ProfileStanding;
  footer?: React.ReactNode;
  options?: React.ReactNode;
}) {
  return (
    <KeyboardSheet visible={!!uid} onClose={onClose} style={{ height: "90%", paddingHorizontal: 0, paddingBottom: 0 }} headerStyle={{ marginHorizontal: 16 }}>
      {uid ? <Body key={uid} uid={uid} leagueId={leagueId} seed={seed} standing={standing} footer={footer} options={options} onDismiss={onClose} /> : null}
    </KeyboardSheet>
  );
}

function Body({
  uid,
  leagueId,
  seed,
  standing,
  footer,
  options,
  onDismiss,
}: {
  uid: string;
  leagueId?: string;
  seed?: ProfileSeed;
  standing?: ProfileStanding;
  footer?: React.ReactNode;
  options?: React.ReactNode;
  onDismiss: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { byId } = useCatalog();
  const { data, loading, error, reload } = usePlayerProfile(uid, leagueId);
  const [tab, setTab] = useState<BetTab>("open");
  const [source, setSource] = useState<Source>(leagueId ? "league" : "all");
  const [avatarGesture, setAvatarGesture] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [quickGame, setQuickGame] = useState<string | null>(null);

  const p = data?.profile;
  const name = p?.displayName ?? seed?.displayName ?? "Player";
  const username = p?.username ?? seed?.username;
  // Same fallback as Home once the fetch settles; null (spinner) while it is still loading.
  const avatar = p?.avatar ?? seed?.avatar ?? (loading && !data ? null : DEFAULT_AVATAR);
  const equipped = p?.equipped ?? seed?.equipped ?? {};
  const teams = p?.favoriteTeams?.length ? p.favoriteTeams : seed?.favoriteTeams ?? [];
  const relation = data?.relation;

  const hasGlobal = !!data?.bets;
  const hasLeague = !!data?.league;
  const src: Source = hasGlobal && hasLeague ? source : hasLeague ? "league" : "all";
  const bets: ProfileBet[] = (src === "league" ? data?.league?.bets : data?.bets) ?? [];
  const betCurrency = src === "league" ? "league" : "credits";
  const open = bets.filter((b) => b.status === "pending");
  const settled = bets.filter((b) => b.status !== "pending");
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

  return (
    <View style={{ flex: 1 }}>
      <ScrollView scrollEnabled={!avatarGesture} contentContainerStyle={[styles.body, !footer && { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Header: the same character card as Home */}
        <AvatarHero
          avatar={avatar}
          equipped={equipped}
          catalog={byId}
          onGesture={setAvatarGesture}
          header={
            <>
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityRole="header" style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
                  {name}
                </Text>
                {username ? <Text style={[styles.handle, { color: c.mutedForeground }]}>@{username}</Text> : null}
              </View>
              {standing?.rank === 1 && (
                <View style={[styles.crown, { backgroundColor: c.primary }]}>
                  <MaterialCommunityIcons name="crown" size={16} color={c.primaryForeground} />
                </View>
              )}
              {options ? (
                <IconButton icon="dots-horizontal" label="Options" onPress={() => setShowOptions(true)} />
              ) : null}
            </>
          }
        />
        <View style={styles.inline}>
          {relation === "self" && <Pill label="You" tone="accent" />}
          {relation === "friend" && <Pill label="Friend" tone="positive" icon="account-check" />}
          {relation === "league" && <Pill label="League-mate" tone="league" icon="shield-star" />}
          {p?.memberSince ? <Text style={[styles.meta, { color: c.subtleForeground }]}>Since {new Date(p.memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</Text> : null}
          {p?.balance != null && (
            <View style={{ marginLeft: "auto" }}>
              <Amount value={p.balance} size="sm" />
            </View>
          )}
        </View>

        {/* Favourite teams */}
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: c.foreground }]}>Favorite teams</Text>
          {teams.length ? (
            <TeamChips teams={teams} max={5} />
          ) : (
            <Text style={[styles.meta, { color: c.subtleForeground }]}>{relation === "self" ? "Pick yours from the Locker tab." : "None picked yet."}</Text>
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
              <StatTile label="Net worth" style={styles.tile}>
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
            <StatTile label="Hit rate" style={styles.tile}>{hit === null ? "—" : `${hit}%`}</StatTile>
          </View>
          <View style={styles.tiles}>
            <StatTile label="Won" style={styles.tile}>
              {s ? <Amount value={s.creditsWon} size="sm" /> : "—"}
            </StatTile>
            <StatTile label="Streak" style={styles.tile}>{bets.length ? derived.streak : "—"}</StatTile>
            <StatTile label="Best hit" style={styles.tile}>
              {derived.best > 0 ? <Amount value={derived.best} currency={betCurrency} size="sm" signed tone="positive" /> : "—"}
            </StatTile>
          </View>
        </View>

        {/* Bets */}
        <View style={{ gap: 8 }}>
          <View style={styles.inline}>
            <Text style={[styles.section, { color: c.foreground, flex: 1 }]}>Bets</Text>
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
                    { value: "league", label: "This league" },
                    { value: "all", label: "All bets" },
                  ]}
                />
              )}
              <SegmentedControl
                value={tab}
                onChange={setTab}
                options={[
                  { value: "open", label: "Active", badge: open.length || undefined },
                  { value: "history", label: "History", badge: settled.length || undefined },
                ]}
              />
              {shown.length === 0 ? (
                <Text style={[styles.meta, { color: c.subtleForeground, textAlign: "center", paddingVertical: 12 }]}>
                  {tab === "open" ? "No open bets right now." : "Nothing settled yet."}
                </Text>
              ) : (
                shown.map((b) => <BetRow key={b.id} b={b} currency={betCurrency} onPress={() => setQuickGame(b.gameId)} />)
              )}
            </>
          )}
        </View>
      </ScrollView>
      {footer ? <View style={[styles.footer, { borderTopColor: c.border, paddingBottom: insets.bottom + 16 }]}>{footer}</View> : null}
      {options && showOptions ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={() => setShowOptions(false)} accessibilityLabel="Close options" />
          <View style={[styles.options, { backgroundColor: c.elevated, borderColor: c.border }]}>
            <View style={styles.inline}>
              <Text style={[styles.section, { color: c.foreground, flex: 1 }]}>Options</Text>
              <CloseButton onPress={() => setShowOptions(false)} />
            </View>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {options}
          </View>
        </View>
      ) : null}
      {/* Inside the profile's Modal so iOS can stack the game sheet on it. */}
      <GameQuickView
        gameId={quickGame}
        onClose={() => setQuickGame(null)}
        defaultWallet={src === "league" ? leagueId : undefined}
        onLeave={onDismiss}
      />
    </View>
  );
}

function BetRow({ b, currency, onPress }: { b: ProfileBet; currency: "credits" | "league"; onPress: () => void }) {
  const c = useColors();
  const label = b.status === "pending" ? "Open" : b.status === "won" ? "Won" : b.status === "lost" ? "Lost" : b.status === "push" ? "Push" : "Void";
  const tone = b.status === "won" ? "positive" : b.status === "lost" ? "negative" : b.status === "pending" ? "accent" : "neutral";
  const mine = b.side === "home" ? b.finalHomeScore : b.finalAwayScore;
  const theirs = b.side === "home" ? b.finalAwayScore : b.finalHomeScore;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the game"
      onPress={onPress}
      style={({ pressed }) => [styles.bet, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: b.teamColor, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.betTitle, { color: c.foreground }]} numberOfLines={1}>
          {b.teamName} <Text style={{ color: c.mutedForeground }}>v {b.opponentAbbr}</Text>
        </Text>
        <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
          {b.sport ? `${b.sport} · ` : ""}
          {b.stake.toLocaleString()} @ {b.odds.toFixed(2)}x → {b.potentialPayout.toLocaleString()}
          {mine != null && theirs != null ? ` · ${mine}–${theirs}` : ""}
        </Text>
        <Text style={[styles.time, { color: c.subtleForeground }]}>{ago(b.settledAt ?? b.placedAt)}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Pill label={label} tone={tone} />
        {b.status === "won" ? <Amount value={b.potentialPayout - b.stake} currency={currency} size="sm" signed tone="positive" /> : null}
        {b.status === "lost" ? <Amount value={-b.stake} currency={currency} size="sm" signed tone="negative" /> : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={c.subtleForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  crown: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_900Black", letterSpacing: -1 },
  handle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  section: { fontSize: 15, fontFamily: "Inter_700Bold" },
  leagueBox: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  leagueTitle: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 1 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1 },
  tileValue: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  bet: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4 },
  betTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  options: { marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import TeamChips from "@/components/TeamChips";
import { Button, ConfirmDialog, IconButton } from "@/components/ui";
import { useLeague } from "@/context/LeagueContext";
import { useNotifications } from "@/context/NotificationContext";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import type { PublicUser } from "@/lib/api";

/** Stable empty result set. A fresh `[]` is a new identity every render. */
const EMPTY_RESULTS: PublicUser[] = [];

/**
 * New screen. Requirement §2 and §21 in full: search a user, send a request,
 * accept or decline, view friends, remove, and see each friend's avatar in the
 * outfit they're actually wearing.
 *
 * None of this could exist before — there were no user profile documents to
 * search and no friendship model at all (AUDIT B4).
 *
 * The duplicate-relationship problem §2 asks about is solved server-side by the
 * canonical sorted pair id, not by checks in this UI. A double-tap on Add, two
 * devices racing, or both people adding each other at the same moment all
 * converge on one friendship document.
 */
export default function FriendsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { profile } = useApp();
  const { byId } = useCatalog();
  const {
    friends,
    incoming,
    senders,
    outgoing,
    friendUids,
    outgoingUids,
    loading,
    error,
    clearError,
    search,
    sendRequest,
    respond,
    remove,
  } = useFriends(profile?.uid ?? null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const params = useLocalSearchParams<{ open?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const { unreadCount } = useNotifications();
  const { activeLeagues, inviteFriend } = useLeague();
  const [invited, setInvited] = useState<Record<string, "busy" | "sent" | "error">>({});

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 84;

  // Debounced search. Two characters minimum, matching the callable's floor.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      // Writing a fresh [] here is what turned an unstable dep into an
      // infinite loop. Keep the existing array when it is already empty.
      setResults((prev) => (prev.length === 0 ? prev : EMPTY_RESULTS));
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  const act = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await fn();
    setBusy(null);
  }, []);

  const searching_ui = query.trim().length >= 2;

  // Every user this screen knows about, so the profile sheet can paint its
  // header before getPlayerProfile answers.
  const known = useMemo(() => {
    const m = new Map<string, PublicUser>();
    for (const u of Object.values(senders)) m.set(u.uid, u);
    for (const u of results) m.set(u.uid, u);
    for (const u of friends) m.set(u.uid, u);
    return m;
  }, [senders, results, friends]);
  const selected = selectedUid ? known.get(selectedUid) ?? null : null;

  // Deep link from an invite / friend notification: /(tabs)/friends?open=<uid>
  useEffect(() => {
    if (params.open) {
      setSelectedUid(params.open);
      router.setParams({ open: undefined });
    }
  }, [params.open]);

  const incomingFrom = useMemo(() => new Set(incoming.map((r) => r.from)), [incoming]);

  const renderActions = (uid: string) => {
    if (uid === profile?.uid) return null;
    if (incomingFrom.has(uid)) {
      return (
        <View style={styles.actionRow}>
          <Button
            label="Accept request"
            icon="account-check"
            style={{ flex: 1 }}
            loading={busy === `req:${uid}`}
            onPress={() => act(`req:${uid}`, () => respond(uid, true))}
          />
          <Button label="Decline" variant="secondary" loading={busy === `dec:${uid}`} onPress={() => act(`dec:${uid}`, () => respond(uid, false))} />
        </View>
      );
    }
    if (!friendUids.has(uid)) {
      const pending = outgoingUids.has(uid);
      return (
        <Button
          label={pending ? "Request sent" : "Add friend"}
          icon={pending ? "clock-outline" : "account-plus"}
          variant={pending ? "secondary" : "primary"}
          disabled={pending}
          loading={busy === uid}
          onPress={() => act(uid, () => sendRequest(uid))}
        />
      );
    }
    return null;
  };

  const renderOptions = (uid: string) => {
    if (uid === profile?.uid || !friendUids.has(uid)) return null;
    const open = activeLeagues.filter((l) => !l.memberIds.includes(uid));
    return (
      <>
        {open.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Invite to a league</Text>
            {open.map((l) => {
              const k = `${l.id}:${uid}`;
              const st = invited[k];
              return (
                <View key={l.id} style={styles.actionRow}>
                  <Text style={[styles.userName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Button
                    size="sm"
                    label={st === "sent" ? "Invited" : st === "error" ? "Retry" : "Invite"}
                    variant={st === "sent" ? "secondary" : "league"}
                    loading={st === "busy"}
                    disabled={st === "sent"}
                    onPress={async () => {
                      setInvited((p) => ({ ...p, [k]: "busy" }));
                      const e = await inviteFriend(l.id, uid);
                      setInvited((p) => ({ ...p, [k]: e ? "error" : "sent" }));
                    }}
                  />
                </View>
              );
            })}
          </View>
        )}
        {open.length > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
        <Pressable
          style={({ pressed }) => [styles.removeBtn, { backgroundColor: colors.destructive, opacity: pressed || busy === uid ? 0.75 : 1 }]}
          disabled={busy === uid}
          onPress={() => setConfirmRemove(uid)}
        >
          {busy === uid ? (
            <ActivityIndicator color={colors.destructiveForeground} />
          ) : (
            <Text style={[styles.removeText, { color: colors.destructiveForeground }]}>Remove friend</Text>
          )}
        </Pressable>
        <ConfirmDialog
          visible={confirmRemove === uid}
          title="Remove friend?"
          body={`${known.get(uid)?.displayName ?? "This player"} will be removed from your friends. You can send a new request later.`}
          confirmLabel="Remove"
          destructive
          busy={busy === uid}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            await act(uid, () => remove(uid));
            setConfirmRemove(null);
            setSelectedUid(null);
          }}
        />
      </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Friends</Text>
          <IconButton icon="bell-outline" label="Activity" badge={unreadCount} onPress={() => router.push("/activity")} />
        </View>
        <View style={[styles.searchBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by username"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          {query.length > 0 && !searching && (
            <Pressable onPress={() => setQuery("")}>
              <MaterialCommunityIcons name="close-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {error && (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onPress={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error}</Text>
        </Pressable>
      )}

      <FlatList
        data={searching_ui ? results : friends}
        keyExtractor={(u) => u.uid}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          searching_ui ? undefined : (
            <>
              {incoming.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                    Requests ({incoming.length})
                  </Text>
                  {incoming.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => setSelectedUid(r.from)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${senders[r.from]?.displayName ?? "player"}'s profile`}
                      style={[styles.reqRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.thumb,
                          { backgroundColor: colors.secondary, width: 34, height: 40 },
                        ]}
                      >
                        {senders[r.from] ? (
                          <AvatarDisplay
                            avatar={senders[r.from]!.avatar}
                            equipped={senders[r.from]!.equipped}
                            catalog={byId}
                            size="xs"
                          />
                        ) : (
                          <MaterialCommunityIcons name="account-plus" size={18} color={colors.primary} />
                        )}
                      </View>
                      <Text style={[styles.reqText, { color: colors.foreground }]} numberOfLines={1}>
                        {senders[r.from]
                          ? `${senders[r.from]!.displayName} (@${senders[r.from]!.username})`
                          : "A player wants to be friends"}
                      </Text>
                      <Pressable
                        style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
                        disabled={busy === r.id}
                        onPress={() => act(r.id, () => respond(r.from, true))}
                      >
                        <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>
                          Accept
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.declineBtn, { borderColor: colors.alpha(colors.foreground, 0.25), backgroundColor: colors.secondary }]}
                        disabled={busy === r.id}
                        onPress={() => act(r.id, () => respond(r.from, false))}
                      >
                        <MaterialCommunityIcons name="close" size={18} color={colors.foreground} />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              )}
              {friends.length > 0 && (
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Your friends ({friends.length})
                </Text>
              )}
            </>
          )
        }
        renderItem={({ item }) => {
          const isFriend = friendUids.has(item.uid);
          const isPending = outgoingUids.has(item.uid);
          return (
            <Pressable
              style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setSelectedUid(item.uid)}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.displayName}'s profile`}
            >
              <View style={[styles.thumb, { backgroundColor: colors.secondary }]}>
                <AvatarDisplay avatar={item.avatar} equipped={item.equipped} catalog={byId} size="xs" />
              </View>
              <View style={styles.userInfo}>
                <Text style={[styles.userName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={[styles.userHandle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  @{item.username}
                </Text>
                {isFriend && item.stats && (
                  <Text style={[styles.userRecord, { color: colors.mutedForeground }]}>
                    {item.stats.betsWon}W · {item.stats.betsLost}L
                  </Text>
                )}
                <TeamChips teams={item.favoriteTeams} compact max={3} style={{ marginTop: 3 }} />
              </View>

              {isFriend ? (
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedForeground} />
              ) : isPending ? (
                <View style={[styles.pendingPill, { borderColor: colors.border }]}>
                  <Text style={[styles.pendingText, { color: colors.mutedForeground }]}>Sent</Text>
                </View>
              ) : (
                <Pressable
                  style={[styles.addBtn, { backgroundColor: colors.primary, opacity: busy === item.uid ? 0.5 : 1 }]}
                  disabled={busy === item.uid}
                  onPress={() => act(item.uid, () => sendRequest(item.uid))}
                >
                  <Text style={[styles.addText, { color: colors.primaryForeground }]}>Add</Text>
                </Pressable>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons
                name={searching_ui ? "account-search-outline" : "account-group-outline"}
                size={32}
                color={colors.mutedForeground}
              />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {searching_ui ? "No one by that name" : "No friends yet"}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                {searching_ui
                  ? "Usernames are exact — check the spelling."
                  : "Search a username above to send your first request."}
              </Text>
            </View>
          )
        }
      />

      {/* Player profile: stats, favourite teams, active + settled bets (§21) */}
      <PlayerProfileSheet
        uid={selectedUid}
        onClose={() => setSelectedUid(null)}
        seed={selected ? { displayName: selected.displayName, username: selected.username, avatar: selected.avatar, equipped: selected.equipped, favoriteTeams: selected.favoriteTeams } : undefined}
        footer={selectedUid ? renderActions(selectedUid) : null}
        options={selectedUid ? renderOptions(selectedUid) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
  leagueBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  leagueBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
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
  list: { padding: 16 },
  section: { gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 8 },
  reqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  reqText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  acceptBtn: { paddingHorizontal: 16, minHeight: 36, justifyContent: "center", borderRadius: 10 },
  acceptText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  declineBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  thumb: { width: 54, height: 64, borderRadius: 12, alignItems: "center", justifyContent: "flex-start", paddingTop: 4, overflow: "hidden" },
  userInfo: { flex: 1, gap: 1 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  userHandle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  userRecord: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  addBtn: { paddingHorizontal: 16, minHeight: 36, justifyContent: "center", borderRadius: 10 },
  addText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  pendingPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  pendingText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", gap: 8, padding: 32, borderRadius: 16, borderWidth: 1, marginTop: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingTop: 14,
    gap: 16,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  vsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  vsSide: { flex: 1, alignItems: "center", gap: 4 },
  vsStage: {
    width: "100%",
    height: 190,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  vs: { fontSize: 14, fontFamily: "Inter_700Bold" },
  vsName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  vsCredits: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statsBox: { flexDirection: "row", borderWidth: 1, borderRadius: 14, paddingVertical: 12 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  removeBtn: { borderRadius: 14, paddingVertical: 16, minHeight: 52, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
});

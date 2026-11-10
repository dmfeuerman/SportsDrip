import BackToLevels from "@/components/BackToLevels";
import { TourTarget } from "@/components/tour/TourTarget";
import { lastSeenLabel, ONLINE_MS, usePresence } from "@/lib/presence";
import { useNow } from "@/hooks/useNow";
import { useUnseenCount } from "@/lib/settings";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import SponsoredCard from "@/components/ads/SponsoredCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import InviteFriendsCard from "@/components/InviteFriendsCard";
import TeamChips from "@/components/TeamChips";
import { Button, IconButton } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useChallenges } from "@/context/ChallengeContext";
import { useChat } from "@/context/ChatContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import type { PublicUser } from "@/lib/api";

/** Stable empty result set. A fresh `[]` is a new identity every render. */
const EMPTY_RESULTS: PublicUser[] = [];

/** The friends list: search, requests, chat and challenges. `embedded` drops the screen header chrome (it lives inside the Leagues tab). */
export default function FriendsPanel({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { profile } = useApp();
  const { byId } = useCatalog();
  const {
    friends,
    incoming,
    senders,
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
  const presence = usePresence(friends.map((f) => f.uid));
  const clock = useNow(60_000);
  const params = useLocalSearchParams<{ open?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const { incoming: challengeInbox, live: challengesLive, headToHead } = useChallenges();
  const challengesNew = useUnseenCount("challenges.inbox", challengeInbox.map((ch) => ch.id), false);
  const { unreadChatCount, unreadForFriend } = useChat();

  const topPad = embedded ? -4 : Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 84;

  // Debounced search. Two characters minimum, matching the callable's floor.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
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
    buzz.light();
    await fn();
    setBusy(null);
  }, []);

  const searching_ui = query.trim().length >= 2;

  const known = useMemo(() => {
    const m = new Map<string, PublicUser>();
    for (const u of Object.values(senders)) m.set(u.uid, u);
    for (const u of results) m.set(u.uid, u);
    for (const u of friends) m.set(u.uid, u);
    return m;
  }, [senders, results, friends]);
  const selected = selectedUid ? known.get(selectedUid) ?? null : null;

  // Deep link from an invite / friend notification: /(tabs)/leagues?seg=friends&open=<uid>
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
            label="Accept Request"
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.titleRow}>
          {embedded ? <View style={{ flex: 1 }} /> : (
            <>
              <BackToLevels />
              <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>Friends</Text>
            </>
          )}
          <View style={styles.actionRow}>
            <TourTarget id="friends.chat">
            <IconButton
              icon="chat-processing-outline"
              label="Chat"
              badge={unreadChatCount || undefined}
              onPress={() => router.push("/messages" as never)}
            />
            </TourTarget>
            <TourTarget id="friends.challenges">
            <IconButton
              icon="sword-cross"
              label="Challenges"
              badge={challengesNew || undefined}
              onPress={() => router.push("/challenges")}
            />
            </TourTarget>
          </View>
        </View>
        <TourTarget id="friends.search">
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
        </TourTarget>
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

      {!searching_ui && (challengeInbox.length > 0 || challengesLive.length > 0) && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/challenges")}
          style={[styles.banner, { backgroundColor: colors.alpha(colors.accent, 0.12), borderColor: colors.alpha(colors.accent, 0.55) }]}
        >
          <MaterialCommunityIcons name="sword-cross" size={15} color={colors.accent} />
          <Text style={[styles.bannerText, { color: colors.foreground }]} numberOfLines={1}>
            {challengeInbox.length > 0
              ? `${challengeInbox.length} challenge${challengeInbox.length > 1 ? "s" : ""} waiting on you`
              : `${challengesLive.length} challenge${challengesLive.length > 1 ? "s" : ""} locked in`}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>
      )}

      <FlatList
        ListFooterComponent={<SponsoredCard compact style={{ marginVertical: 12 }} />}
        data={searching_ui ? results : friends}
        keyExtractor={(u) => u.uid}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          searching_ui ? undefined : (
            <>
              <TourTarget id="friends.invite"><InviteFriendsCard /></TourTarget>
              {incoming.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                    Requests ({incoming.length})
                  </Text>
                  {incoming.map((r) => (
                    <View
                      key={r.id}
                      style={[styles.reqRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Pressable
                        onPress={() => setSelectedUid(r.from)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
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
                      </Pressable>
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
                    </View>
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
          const dmUnread = isFriend ? unreadForFriend(item.uid) : 0;
          return (
            <View style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}
                onPress={() => setSelectedUid(item.uid)}
                accessibilityLabel={`View ${item.displayName}'s profile`}
              >
                <View>
                  <View style={[styles.thumb, { backgroundColor: colors.secondary }]}>
                    <AvatarDisplay avatar={item.avatar} equipped={item.equipped} catalog={byId} size="xs" />
                  </View>
                  {isFriend && (presence[item.uid]?.at ?? 0) > clock - ONLINE_MS ? (
                    <View accessibilityLabel="Online now" style={[styles.onlineDot, { backgroundColor: colors.positive, borderColor: colors.card }]} />
                  ) : null}
                </View>
                <View style={styles.userInfo}>
                  <Text style={[styles.userName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.displayName}
                    {isFriend && (item.friendStreak?.count ?? 0) > 0 ? (
                      <Text accessibilityLabel={`${item.friendStreak!.count}-day friend streak`} style={{ color: colors.warning }}>
                        {`  🔥 ${item.friendStreak!.count}`}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.userHandle, { color: colors.mutedForeground }]} numberOfLines={1}>
                    @{item.username}
                    {isFriend && lastSeenLabel(presence[item.uid]?.at, clock) ? (
                      <Text style={{ color: (presence[item.uid]?.at ?? 0) > clock - ONLINE_MS ? colors.positive : colors.subtleForeground }}>
                        {`  ·  ${lastSeenLabel(presence[item.uid]?.at, clock)}`}
                      </Text>
                    ) : null}
                  </Text>
                  {isFriend && item.stats && (
                    <Text style={[styles.userRecord, { color: colors.mutedForeground }]}>
                      {item.stats.betsWon}W · {item.stats.betsLost}L
                      {(() => {
                        const r = headToHead(item.uid);
                        return r.won + r.lost > 0 ? <Text style={{ color: colors.accent }}>{`  ·  H2H ${r.won}–${r.lost}`}</Text> : null;
                      })()}
                    </Text>
                  )}
                  <TeamChips teams={item.favoriteTeams} compact max={3} style={{ marginTop: 3 }} />
                </View>
              </Pressable>

              {isFriend ? (
                <View style={styles.actionRow}>
                  <IconButton
                    icon="message-text-outline"
                    label={`Message ${item.displayName}`}
                    badge={dmUnread || undefined}
                    onPress={() => router.push({ pathname: "/messages" as never, params: { uid: item.uid, name: item.displayName } })}
                  />
                  <Pressable onPress={() => setSelectedUid(item.uid)} hitSlop={8}>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>
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
            </View>
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

      {/* Player profile: stats, favourite teams, Challenge & Invite buttons, active + settled bets */}
      <PlayerProfileSheet
        uid={selectedUid}
        onClose={() => setSelectedUid(null)}
        seed={selected ? { displayName: selected.displayName, username: selected.username, avatar: selected.avatar, equipped: selected.equipped, favoriteTeams: selected.favoriteTeams } : undefined}
        footer={selectedUid ? renderActions(selectedUid) : null}
        onRemoveFriend={(uid) => remove(uid)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
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
  onlineDot: { position: "absolute", right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5 },
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
  divider: { height: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});

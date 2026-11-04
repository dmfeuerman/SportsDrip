import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QuotedParent, ReplyComposerBar, type ReplyQuote } from "@/components/chat/ReplyThread";
import MemberAvatar from "@/components/MemberAvatar";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import { BackButton, EmptyState, Pill, TabStrip } from "@/components/ui";
import type { LeagueMessage } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { useChat, type DirectMessage } from "@/context/ChatContext";
import { useLeague, useLeagueDetail } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import { chatText } from "@/lib/chatText";
import { DEMO, demoFriends } from "@/lib/demo";
import { markChatSeen, useAllChatSeen } from "@/lib/settings";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { REACTION_EMOJIS } from "@/constants/leagueTypes";

/** Sets, switches or clears my one reaction on a DM (rules allow only my own key). */
function reactToDm(m: DirectMessage, uid: string, emoji: string) {
  const db = getDb();
  if (!db || DEMO) return;
  const same = m.reactors?.[uid] === emoji;
  updateDoc(doc(db, "directMessages", m.threadId, "messages", m.id), { [`reactors.${uid}`]: same ? deleteField() : emoji }).catch(() => {});
}

type ChatMode = "dm" | "league";

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Global Direct & League Messaging Center (/messages).
 *
 * Implements the standard messaging app pattern:
 *  - Switch between Direct Messages (DMs) with friends and League Chat rooms.
 *  - FlatList oriented with the newest messages at the bottom.
 *  - Fixed input message box anchored to the bottom with a send button.
 *  - KeyboardAvoidingView so the input is never obscured by the iOS/Android keyboard.
 *  - Inline reply threads with quoted parent bubble and curved stem.
 *  - Tapping any friend's name or avatar opens PlayerProfileSheet with Challenge & Invite actions.
 */
export default function MessagesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ uid?: string; name?: string; leagueId?: string }>();
  const { profile } = useApp();
  const { byId } = useCatalog();
  const myUid = profile?.uid ?? "me";
  const { friends: liveFriends } = useFriends(profile?.uid ?? null);
  const friends = useMemo(
    () => (liveFriends.length > 0 ? liveFriends : DEMO ? demoFriends : []),
    [liveFriends]
  );

  const { leagues, sendMessage: sendLeagueMessage } = useLeague();
  const {
    threadIdFor,
    dmMessagesByThread,
    sendDirectMessage,
    leagueReplyQuotes,
    recordLeagueMessageQuote,
    unreadForFriend,
    markThreadRead,
    setActiveChatId,
  } = useChat();
  const chatSeen = useAllChatSeen();

  const [mode, setMode] = useState<ChatMode>(params.leagueId ? "league" : "dm");
  const [selectedFriendUid, setSelectedFriendUid] = useState<string | null>(
    params.uid ?? friends[0]?.uid ?? null
  );
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(
    params.leagueId ?? leagues[0]?.id ?? null
  );
  const [replyQuote, setReplyQuote] = useState<ReplyQuote | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [profileUid, setProfileUid] = useState<string | null>(null);

  const listRef = useRef<React.ComponentRef<typeof FlatList<any>> | null>(null);

  useEffect(() => {
    if (params.uid) {
      setMode("dm");
      setSelectedFriendUid(params.uid);
    } else if (params.leagueId) {
      setMode("league");
      setSelectedLeagueId(params.leagueId);
    }
  }, [params.uid, params.leagueId]);

  useEffect(() => {
    if (!selectedFriendUid && friends[0]?.uid) {
      setSelectedFriendUid(friends[0].uid);
    }
  }, [friends, selectedFriendUid]);

  useEffect(() => {
    if (!selectedLeagueId && leagues[0]?.id) {
      setSelectedLeagueId(leagues[0].id);
    }
  }, [leagues, selectedLeagueId]);

  const activeFriend = useMemo(
    () =>
      friends.find((f) => f.uid === selectedFriendUid) ??
      (selectedFriendUid && params.name
        ? { uid: selectedFriendUid, username: selectedFriendUid, displayName: params.name, avatar: profile?.avatar!, equipped: {} }
        : null),
    [friends, selectedFriendUid, params.name, profile?.avatar]
  );

  const activeLeague = useMemo(
    () => leagues.find((l) => l.id === selectedLeagueId),
    [leagues, selectedLeagueId]
  );
  const leagueDetail = useLeagueDetail(mode === "league" ? activeLeague : undefined);

  const activeThreadId =
    mode === "dm" && selectedFriendUid
      ? threadIdFor(selectedFriendUid)
      : mode === "league" && selectedLeagueId
        ? selectedLeagueId
        : null;

  useEffect(() => {
    setActiveChatId(activeThreadId);
    if (activeThreadId) {
      markThreadRead(activeThreadId);
    }
    return () => setActiveChatId(null);
  }, [activeThreadId, markThreadRead, setActiveChatId]);

  // Chronological message list (oldest -> newest so newest is at the bottom)
  const dmMessages: DirectMessage[] = useMemo(() => {
    if (!selectedFriendUid) return [];
    const tId = threadIdFor(selectedFriendUid);
    return (dmMessagesByThread[tId] ?? []).slice().sort((a, b) => a.at - b.at);
  }, [selectedFriendUid, threadIdFor, dmMessagesByThread]);

  const leagueMessages: LeagueMessage[] = useMemo(() => {
    if (mode !== "league") return [];
    // Filter to real chat messages and bet shares, ordered oldest -> newest (newest at bottom)
    return leagueDetail.messages.slice().sort((a, b) => a.at - b.at);
  }, [mode, leagueDetail.messages]);

  // Count how many replies each parent message has
  const replyCountByParentId = useMemo(() => {
    const counts: Record<string, number> = {};
    if (mode === "dm") {
      for (const m of dmMessages) {
        if (m.replyTo?.id) counts[m.replyTo.id] = (counts[m.replyTo.id] ?? 0) + 1;
      }
    } else {
      for (const m of leagueMessages) {
        const q = m.replyTo ?? leagueReplyQuotes[m.id];
        if (q?.id) counts[q.id] = (counts[q.id] ?? 0) + 1;
      }
    }
    return counts;
  }, [mode, dmMessages, leagueMessages, leagueReplyQuotes]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    buzz.light();

    if (mode === "dm" && activeFriend) {
      const err = await sendDirectMessage(activeFriend.uid, activeFriend.displayName, body, replyQuote);
      setSending(false);
      if (!err) {
        setText("");
        setReplyQuote(null);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } else if (mode === "league" && activeLeague) {
      const quote = replyQuote
        ? (Object.fromEntries(Object.entries(replyQuote).filter(([, v]) => v !== undefined)) as ReplyQuote)
        : null;
      const err = await sendLeagueMessage(activeLeague.id, body, quote);
      setSending(false);
      if (!err) {
        if (replyQuote) {
          recordLeagueMessageQuote(`latest_${Date.now()}`, replyQuote);
        }
        setText("");
        setReplyQuote(null);
        markChatSeen(activeLeague.id, Date.now());
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } else {
      setSending(false);
    }
  };

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: c.border, backgroundColor: c.background }]}>
        <View style={styles.headerTop}>
          <BackButton />
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: c.foreground }]}>Messages</Text>
            <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
              {mode === "dm"
                ? activeFriend
                  ? `Direct chat with ${activeFriend.displayName}`
                  : "Direct messages with friends"
                : activeLeague
                  ? `${activeLeague.name} · ${Object.keys(activeLeague.members ?? {}).length} members`
                  : "League chat rooms"}
            </Text>
          </View>
          {mode === "dm" && activeFriend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${activeFriend.displayName}'s profile`}
              onPress={() => setProfileUid(activeFriend.uid)}
              style={[styles.profileBtn, { backgroundColor: c.secondary, borderColor: c.border }]}
            >
              <MaterialCommunityIcons name="account-details-outline" size={16} color={c.primary} />
              <Text style={[styles.profileBtnText, { color: c.foreground }]}>Profile</Text>
            </Pressable>
          ) : mode === "league" && activeLeague ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${activeLeague.name}`}
              onPress={() => router.push({ pathname: "/league/[id]", params: { id: activeLeague.id } })}
              style={[styles.profileBtn, { backgroundColor: c.leagueSoft, borderColor: c.league }]}
            >
              <MaterialCommunityIcons name="trophy-outline" size={16} color={c.league} />
              <Text style={[styles.profileBtnText, { color: c.foreground }]}>League</Text>
            </Pressable>
          ) : null}
        </View>

        <TabStrip<ChatMode>
          bleed={false}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setReplyQuote(null);
          }}
          options={[
            { value: "dm", label: "Direct Messages" },
            { value: "league", label: "League Chats", badge: leagues.length || undefined },
          ]}
        />

        {/* Horizontal Room / Friend Selector */}
        {mode === "dm" ? (
          friends.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomStrip}>
              {friends.map((f) => {
                const active = f.uid === selectedFriendUid;
                const unread = unreadForFriend(f.uid);
                return (
                  <Pressable
                    key={f.uid}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setSelectedFriendUid(f.uid);
                      setReplyQuote(null);
                    }}
                    style={[
                      styles.roomChip,
                      {
                        backgroundColor: active ? c.primarySoft : c.secondary,
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                  >
                    <MemberAvatar profile={f} name={f.displayName} color={c.primary} catalog={byId} size={26} />
                    <Text style={[styles.roomChipText, { color: active ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                      {f.displayName}
                    </Text>
                    {unread > 0 && !active ? (
                      <View style={[styles.unreadDot, { backgroundColor: c.negative }]}>
                        <Text style={styles.unreadDotText}>{unread}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null
        ) : leagues.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomStrip}>
            {leagues.map((l) => {
              const active = l.id === selectedLeagueId;
              const seen = chatSeen[l.id] ?? 0;
              const hasNew = (l.lastActivityAt ?? 0) > seen && !active;
              return (
                <Pressable
                  key={l.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setSelectedLeagueId(l.id);
                    setReplyQuote(null);
                  }}
                  style={[
                    styles.roomChip,
                    {
                      backgroundColor: active ? c.leagueSoft : c.secondary,
                      borderColor: active ? c.league : c.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="trophy-outline" size={15} color={active ? c.league : c.mutedForeground} />
                  <Text style={[styles.roomChipText, { color: active ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                    {l.name}
                  </Text>
                  {hasNew ? <View style={[styles.dotOnly, { backgroundColor: c.league }]} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Message History (Newest at the Bottom) */}
      {mode === "dm" ? (
        !activeFriend ? (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon="message-text-outline"
              title="No direct chats yet"
              body="Add a friend to start messaging 1-on-1, share picks, and challenge them head-to-head."
              action="Find Friends"
              onAction={() => router.navigate("/(tabs)/friends")}
            />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={dmMessages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: m }: { item: DirectMessage }) => {
              const mine = m.senderUid === myUid;
              const initials = (m.senderName || "P")
                .split(" ")
                .map((s: string) => s[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const repliesCount = replyCountByParentId[m.id] ?? 0;

              return (
                <View style={[styles.msgGroup, mine ? styles.msgGroupRight : styles.msgGroupLeft]}>
                  {m.replyTo ? (
                    <QuotedParent
                      quote={m.replyTo}
                      isMine={mine}
                      replyCount={replyCountByParentId[m.replyTo.id]}
                    />
                  ) : null}

                  <View style={[styles.msgRow, mine && styles.msgRowRight]}>
                    {!mine && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${m.senderName}'s profile`}
                        onPress={() => setProfileUid(m.senderUid)}
                        style={[styles.senderDisc, { backgroundColor: c.secondary, borderColor: c.border }]}
                      >
                        <Text style={[styles.senderDiscText, { color: c.foreground }]}>{initials}</Text>
                      </Pressable>
                    )}

                    <View style={[styles.bubbleCol, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                      {!mine && (
                        <Pressable onPress={() => setProfileUid(m.senderUid)}>
                          <Text style={[styles.senderLabel, { color: c.mutedForeground }]}>{m.senderName}</Text>
                        </Pressable>
                      )}
                      <Pressable
                        onLongPress={() => {
                          buzz.tick();
                          setReplyQuote({
                            id: m.id,
                            kind: "message",
                            authorUid: m.senderUid,
                            authorName: m.senderName,
                            text: chatText(m.text),
                          });
                        }}
                        style={[
                          styles.bubble,
                          mine
                            ? { backgroundColor: "#007AFF", borderBottomRightRadius: 4 }
                            : { backgroundColor: c.isDark ? c.card : "#E9E9EB", borderColor: c.border, borderWidth: c.isDark ? 1 : 0, borderBottomLeftRadius: 4 },
                        ]}
                      >
                        <Text style={[styles.bubbleText, { color: mine ? "#FFFFFF" : c.foreground }]}>
                          {chatText(m.text)}
                        </Text>
                      </Pressable>

                      <View style={[styles.msgMetaRow, { gap: 4 }]}>
                        {REACTION_EMOJIS.slice(0, 3).map((e) => {
                          const n = Object.values(m.reactors ?? {}).filter((x) => x === e).length;
                          const on = m.reactors?.[myUid] === e;
                          if (mine && n === 0) return null;
                          return (
                            <Pressable
                              key={e}
                              accessibilityRole="button"
                              accessibilityLabel={`React ${e}`}
                              hitSlop={4}
                              disabled={mine}
                              onPress={() => {
                                buzz.tick();
                                reactToDm(m, myUid, e);
                              }}
                              style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: on ? c.league : c.border, backgroundColor: on ? c.leagueSoft : "transparent", flexDirection: "row", gap: 2 }}
                            >
                              <Text style={{ fontSize: 11 }}>{e}</Text>
                              {n > 0 ? <Text style={[styles.msgTime, { color: c.mutedForeground }]}>{n}</Text> : null}
                            </Pressable>
                          );
                        })}
                        <Text style={[styles.msgTime, { color: c.subtleForeground }]}>{formatClock(m.at)}</Text>
                        <Pressable
                          hitSlop={8}
                          onPress={() => {
                            buzz.tick();
                            setReplyQuote({
                              id: m.id,
                              kind: "message",
                              authorUid: m.senderUid,
                              authorName: m.senderName,
                              text: chatText(m.text),
                            });
                          }}
                        >
                          <Text style={[styles.replyLink, { color: "#007AFF" }]}>
                            {repliesCount > 0 ? `${repliesCount} ${repliesCount === 1 ? "Reply" : "Replies"} · Reply` : "Reply"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
                  Start the conversation with {activeFriend.displayName} below.
                </Text>
              </View>
            }
          />
        )
      ) : !activeLeague ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="trophy-outline"
            title="No league chats yet"
            body="Join or start a league to unlock your league's dedicated group chat room."
            action="Explore Leagues"
            onAction={() => router.navigate("/(tabs)/leagues")}
          />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={leagueMessages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: m }: { item: LeagueMessage }) => {
            const mine = m.uid === myUid;
            const quote = m.replyTo ?? leagueReplyQuotes[m.id] ?? null;
            const initials = (m.name || "P")
              .split(" ")
              .map((s: string) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const repliesCount = replyCountByParentId[m.id] ?? 0;

            return (
              <View style={[styles.msgGroup, mine ? styles.msgGroupRight : styles.msgGroupLeft]}>
                {quote ? (
                  <QuotedParent
                    quote={quote}
                    isMine={mine}
                    replyCount={replyCountByParentId[quote.id]}
                  />
                ) : null}

                <View style={[styles.msgRow, mine && styles.msgRowRight]}>
                  {!mine && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View ${m.name}'s profile`}
                      onPress={() => setProfileUid(m.uid)}
                      style={[styles.senderDisc, { backgroundColor: c.secondary, borderColor: c.border }]}
                    >
                      <Text style={[styles.senderDiscText, { color: c.foreground }]}>{initials}</Text>
                    </Pressable>
                  )}

                  <View style={[styles.bubbleCol, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                    {!mine && (
                      <Pressable onPress={() => setProfileUid(m.uid)}>
                        <Text style={[styles.senderLabel, { color: c.mutedForeground }]}>{m.name}</Text>
                      </Pressable>
                    )}

                    <Pressable
                      onLongPress={() => {
                        buzz.tick();
                        setReplyQuote({
                          id: m.id,
                          kind: m.kind === "bet" ? "bet_result" : "message",
                          authorUid: m.uid,
                          authorName: m.name,
                          text: chatText(m.text),
                          teamAbbr: m.teamAbbr,
                          opponentAbbr: m.opponentAbbr,
                          odds: m.odds,
                          stake: m.stake,
                        });
                      }}
                      style={[
                        styles.bubble,
                        mine
                          ? { backgroundColor: "#007AFF", borderBottomRightRadius: 4 }
                          : { backgroundColor: c.isDark ? c.card : "#E9E9EB", borderColor: c.border, borderWidth: c.isDark ? 1 : 0, borderBottomLeftRadius: 4 },
                      ]}
                    >
                      {m.kind === "bet" && m.teamAbbr ? (
                        <View style={{ marginBottom: 4 }}>
                          <Pill label={`🎟 ${m.label ?? m.teamAbbr} vs ${m.opponentAbbr}`} tone="league" />
                        </View>
                      ) : null}
                      <Text style={[styles.bubbleText, { color: mine ? "#FFFFFF" : c.foreground }]}>
                        {chatText(m.text)}
                      </Text>
                    </Pressable>

                    <View style={styles.msgMetaRow}>
                      <Text style={[styles.msgTime, { color: c.subtleForeground }]}>{formatClock(m.at)}</Text>
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          buzz.tick();
                          setReplyQuote({
                            id: m.id,
                            kind: m.kind === "bet" ? "bet_result" : "message",
                            authorUid: m.uid,
                            authorName: m.name,
                            text: chatText(m.text),
                          });
                        }}
                      >
                        <Text style={[styles.replyLink, { color: "#007AFF" }]}>
                          {repliesCount > 0 ? `${repliesCount} ${repliesCount === 1 ? "Reply" : "Replies"} · Reply` : "Reply"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
                No messages in {activeLeague.name} yet. Drop the first message below!
              </Text>
            </View>
          }
        />
      )}

      {/* Reply composer quote banner */}
      <ReplyComposerBar quote={replyQuote} onCancel={() => setReplyQuote(null)} />

      {/* Fixed Bottom Input Bar */}
      {((mode === "dm" && activeFriend) || (mode === "league" && activeLeague)) && (
        <View
          style={[
            styles.inputDock,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.secondary,
                borderColor: c.border,
                color: c.foreground,
              },
            ]}
            value={text}
            onChangeText={setText}
            placeholder={
              replyQuote
                ? `Reply to ${replyQuote.authorName}…`
                : mode === "dm" && activeFriend
                  ? `Message ${activeFriend.displayName}…`
                  : `Message ${activeLeague?.name ?? "league"}…`
            }
            placeholderTextColor={c.mutedForeground}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!text.trim() || sending}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: text.trim() ? "#007AFF" : c.secondary,
                opacity: !text.trim() ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="arrow-up"
              size={20}
              color={text.trim() ? "#FFFFFF" : c.mutedForeground}
            />
          </Pressable>
        </View>
      )}

      {/* Friend Profile Sheet with Challenge & Invite to League actions */}
      <PlayerProfileSheet
        uid={profileUid}
        leagueId={mode === "league" ? selectedLeagueId ?? undefined : undefined}
        onClose={() => setProfileUid(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: -0.6 },
  headerSub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  profileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  profileBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  roomStrip: { gap: 8, paddingTop: 2 },
  roomChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  roomChipText: { fontSize: 13, fontFamily: "Inter_700Bold", maxWidth: 130 },
  unreadDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDotText: { color: "#FFFFFF", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  dotOnly: { width: 8, height: 8, borderRadius: 4 },
  emptyContainer: { flex: 1, padding: 20, justifyContent: "center" },
  messagesList: { paddingHorizontal: 16, paddingVertical: 14, gap: 12, flexGrow: 1, justifyContent: "flex-end" },
  msgGroup: { gap: 2, maxWidth: "85%" },
  msgGroupLeft: { alignSelf: "flex-start" },
  msgGroupRight: { alignSelf: "flex-end", alignItems: "flex-end" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgRowRight: { justifyContent: "flex-end" },
  senderDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  senderDiscText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  bubbleCol: { gap: 3, flexShrink: 1 },
  senderLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginLeft: 6 },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_400Regular" },
  msgMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  msgTime: { fontSize: 10, fontFamily: "Inter_500Medium" },
  replyLink: { fontSize: 11, fontFamily: "Inter_700Bold" },
  emptyChat: { paddingVertical: 40, alignItems: "center" },
  emptyChatText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  inputDock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});

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
import Animated, { ZoomIn } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReplyComposerBar, type ReplyQuote } from "@/components/chat/ReplyThread";
import BetChatCard from "@/components/chat/BetChatCard";
import TauntCard from "@/components/chat/TauntCard";
import FriendMoneyCard, { LeagueLoanChatCard, LoanNegotiateModal } from "@/components/chat/FriendMoneyCard";
import FriendSendSheet from "@/components/chat/FriendSendSheet";
import GameQuickView, { type FollowIntent } from "@/components/GameQuickView";
import MemberAvatar from "@/components/MemberAvatar";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import ReportDialog, { type ReportTarget } from "@/components/ReportDialog";
import { EmptyState, LoadingState, TabStrip } from "@/components/ui";
import { PEER_LOAN_MAX_PCT, REACTION_EMOJIS, type LeagueLoan, type LeagueMessage } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { useChat, type DirectMessage } from "@/context/ChatContext";
import { useLeague, useLeagueDetail } from "@/context/LeagueContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import { useNow } from "@/hooks/useNow";
import { chatText } from "@/lib/chatText";
import { DEMO, demoFriends } from "@/lib/demo";
import { markChatSeen, useAllChatSeen } from "@/lib/settings";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import * as api from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import ReactionRow from "@/components/chat/ReactionRow";

/** Sets, switches or clears my one reaction on a DM (rules allow only my own key). */
async function reactToDm(m: DirectMessage, uid: string, emoji: string): Promise<string | null> {
  const db = getDb();
  if (!db || DEMO) return null;
  const same = m.reactors?.[uid] === emoji;
  try {
    await updateDoc(doc(db, "directMessages", m.threadId, "messages", m.id), { [`reactors.${uid}`]: same ? deleteField() : emoji });
    return null;
  } catch {
    return "Couldn't react. Try again.";
  }
}

type ChatMode = "dm" | "league";

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayKeyOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayPill(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yest = new Date(now.getTime() - 86_400_000);
  const yestKey = `${yest.getFullYear()}-${yest.getMonth()}-${yest.getDate()}`;
  const key = dayKeyOf(at);
  if (key === todayKey) return "Today";
  if (key === yestKey) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

const SENDER_COLORS = ["#FF7A1A", "#2EE6A6", "#4C9BFF", "#B97BFF", "#FFC23D", "#FF5C8A"];
function senderColorFor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length]!;
}

/**
 * Embedded WhatsApp / iMessage style quote block inside a chat bubble.
 */
function InlineReplyPreview({
  quote,
  mine,
  isDark,
}: {
  quote: ReplyQuote;
  mine: boolean;
  isDark: boolean;
}) {
  const accentColor = mine
    ? "#FFFFFF"
    : quote.betStatus === "won"
      ? "#2EE6A6"
      : quote.betStatus === "lost"
        ? "#FF4D63"
        : "#007AFF";

  return (
    <View
      style={[
        styles.inlineQuote,
        {
          backgroundColor: mine
            ? "rgba(0, 0, 0, 0.18)"
            : isDark
              ? "rgba(255, 255, 255, 0.07)"
              : "rgba(0, 0, 0, 0.06)",
          borderLeftColor: accentColor,
        },
      ]}
    >
      <Text
        style={[
          styles.inlineQuoteAuthor,
          { color: mine ? "#FFFFFF" : accentColor },
        ]}
        numberOfLines={1}
      >
        {quote.authorName}
        {quote.kind === "bet_result" && quote.betStatus ? ` · ${quote.betStatus.toUpperCase()}` : ""}
      </Text>
      <Text
        style={[
          styles.inlineQuoteText,
          { color: mine ? "rgba(255,255,255,0.86)" : isDark ? "rgba(255,255,255,0.72)" : "#555860" },
        ]}
        numberOfLines={2}
      >
        {chatText(quote.text)}
      </Text>
    </View>
  );
}

/**
 * Floating iOS Tapback / WhatsApp context bar shown when a user taps or long-presses a message.
 */
function MessageActionTray({
  mine,
  myReaction,
  onReact,
  onReply,
  onReport,
  onClose,
}: {
  mine: boolean;
  myReaction?: string | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onReport?: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  return (
    <Animated.View
      entering={ZoomIn.springify().damping(16).stiffness(260)}
      style={[
        styles.actionTrayWrap,
        mine ? { alignSelf: "flex-end" } : { alignSelf: "flex-start", marginLeft: 34 },
      ]}
    >
      <View style={[styles.reactionStrip, { backgroundColor: c.elevated, borderColor: c.border, shadowColor: "#000" }]}>
        {REACTION_EMOJIS.map((emoji) => {
          const active = myReaction === emoji;
          return (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React ${emoji}`}
              onPress={() => {
                buzz.tick();
                onReact(emoji);
                onClose();
              }}
              style={[
                styles.trayEmojiBtn,
                active && { backgroundColor: c.isDark ? "rgba(0,122,255,0.28)" : "#E5F1FF" },
              ]}
            >
              <Text style={styles.trayEmoji}>{emoji}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.trayActionsRow, { backgroundColor: c.elevated, borderColor: c.border, shadowColor: "#000" }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reply to message"
          onPress={() => {
            buzz.tick();
            onReply();
            onClose();
          }}
          style={styles.trayActionBtn}
        >
          <MaterialCommunityIcons name="reply-outline" size={15} color="#007AFF" />
          <Text style={[styles.trayActionText, { color: "#007AFF" }]}>Reply</Text>
        </Pressable>
        {onReport ? (
          <>
            <View style={[styles.trayDivider, { backgroundColor: c.border }]} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report message"
              onPress={() => {
                buzz.tick();
                onReport();
                onClose();
              }}
              style={styles.trayActionBtn}
            >
              <MaterialCommunityIcons name="flag-outline" size={14} color={c.negative} />
              <Text style={[styles.trayActionText, { color: c.negative }]}>Report</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * Global Direct & League Messaging Center (/messages).
 *
 * Styled after iOS iMessage & WhatsApp:
 *  - Clean contact/group navigation bar with avatar, online/member subtitle, and quick info action.
 *  - Centered floating date pills ("Today", "Yesterday", etc.).
 *  - Grouped consecutive bubbles with dynamic corner radii and tail corners.
 *  - Inline quoted reply previews inside the bubble.
 *  - Compact timestamps & double-check delivery ticks inside the bottom-right of each bubble.
 *  - Tap or long-press any bubble for iOS/WhatsApp floating tapback reactions, Reply, and Report.
 */
export default function MessagesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ uid?: string; name?: string; leagueId?: string }>();
  const { profile } = useApp();
  const { show: showToast } = useToast();
  const [tauntBusy, setTauntBusy] = useState(false);
  /** Taunt a friend in DMs: plays your first loadout move in the chat. One per friend per day. */
  const sendFriendTaunt = async (friendUid: string, friendName: string) => {
    if (tauntBusy) return;
    setTauntBusy(true);
    buzz.medium();
    try {
      await api.sendTaunt({ scope: "dm", receiverUid: friendUid, matchupId: "friend", moveId: profile?.moves?.[0] ?? "cheer" });
      buzz.success();
    } catch (e) {
      buzz.error();
      showToast({ kind: "warning", title: `Couldn't taunt ${friendName}`, body: api.friendlyError(e) });
    } finally {
      setTauntBusy(false);
    }
  };
  const { byId } = useCatalog();
  const myUid = profile?.uid ?? "me";
  const { friends: liveFriends, loading: friendsLoading } = useFriends(profile?.uid ?? null);
  const friends = useMemo(
    () => (liveFriends.length > 0 ? liveFriends : DEMO ? demoFriends : []),
    [liveFriends]
  );

  const { leagues, ready: leaguesReady, sendMessage: sendLeagueMessage, reactToItem, requestLoan } = useLeague();
  const {
    threadIdFor,
    dmMessagesByThread,
    sendDirectMessage,
    leagueReplyQuotes,
    recordLeagueMessageQuote,
    unreadForFriend,
    unreadDmCount,
    unreadLeagueCount,
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
  const [activeMenuMsgId, setActiveMenuMsgId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [leagueLoanModalOpen, setLeagueLoanModalOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [quickGame, setQuickGame] = useState<string | null>(null);
  const [follow, setFollow] = useState<FollowIntent | null>(null);
  const now = useNow(30_000);

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
    setActiveMenuMsgId(null);
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

  const leagueLoanById = useMemo(() => {
    const map = new Map<string, LeagueLoan>();
    for (const l of leagueDetail.loans) {
      map.set(l.id, l);
    }
    return map;
  }, [leagueDetail.loans]);

  const leagueMessages: LeagueMessage[] = useMemo(() => {
    if (mode !== "league") return [];
    const base = leagueDetail.messages.slice();
    const existingLoanIds = new Set(base.map((m) => m.loanId).filter(Boolean));
    for (const l of leagueDetail.loans) {
      if (l.kind === "peer" && !existingLoanIds.has(l.id)) {
        const rate = l.counterRate ?? l.proposedRate ?? l.ratePct;
        base.push({
          id: `loan_${l.id}`,
          uid: l.borrowerId,
          name: l.borrowerName,
          kind: "loan",
          loanId: l.id,
          amount: l.principal,
          rate,
          text: `${l.borrowerName} requested ${l.principal.toLocaleString()} tokens at ${rate}% flat${l.message ? ` — "${l.message}"` : ""}`,
          at: l.createdAt,
          reactions: l.reactions,
          reactors: l.reactors,
        });
      }
    }
    return base.sort((a, b) => a.at - b.at);
  }, [mode, leagueDetail.messages, leagueDetail.loans]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    buzz.light();

    const sentQuote = replyQuote;
    setText("");
    setReplyQuote(null);
    setActiveMenuMsgId(null);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    const restore = () => {
      setText((cur) => cur || body);
      setReplyQuote((cur) => cur ?? sentQuote);
    };
    if (mode === "dm" && activeFriend) {
      setSending(false);
      const err = await sendDirectMessage(activeFriend.uid, activeFriend.displayName, body, sentQuote);
      if (err) restore();
    } else if (mode === "league" && activeLeague) {
      const quote = sentQuote
        ? (Object.fromEntries(Object.entries(sentQuote).filter(([, v]) => v !== undefined)) as ReplyQuote)
        : null;
      markChatSeen(activeLeague.id, Date.now());
      setSending(false);
      const err = await sendLeagueMessage(activeLeague.id, body, quote);
      if (err) restore();
      else if (sentQuote) recordLeagueMessageQuote(`latest_${Date.now()}`, sentQuote);
    } else {
      setSending(false);
    }
  };

  const topPad = Platform.OS === "web" ? 20 : insets.top;

  // Bubble colors modeled after iOS iMessage & WhatsApp dark/light palettes
  const outgoingBubbleBg = "#007AFF";
  const incomingBubbleBg = c.isDark ? "#1C1E26" : "#E9E9EB";
  const chatWallpaperBg = c.isDark ? "#090A0F" : "#F2F2F7";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: chatWallpaperBg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* iOS / WhatsApp Top Navigation Bar */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 6,
            borderBottomColor: c.border,
            backgroundColor: c.isDark ? "rgba(18, 20, 28, 0.96)" : "rgba(249, 249, 251, 0.96)",
          },
        ]}
      >
        <View style={styles.headerTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            onPress={() => (router.canGoBack() ? router.back() : router.navigate("/(tabs)"))}
            style={styles.backBtn}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color="#007AFF" />
          </Pressable>

          {mode === "dm" && activeFriend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${activeFriend.displayName}'s profile`}
              onPress={() => setProfileUid(activeFriend.uid)}
              style={styles.contactCenter}
            >
              <View style={styles.avatarWithStatus}>
                <MemberAvatar profile={activeFriend} name={activeFriend.displayName} color={c.primary} catalog={byId} size={36} />
                <View style={[styles.onlineBadge, { borderColor: c.background }]} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.contactTitleRow}>
                  <Text style={[styles.headerTitle, { color: c.foreground }]} numberOfLines={1}>
                    {activeFriend.displayName}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={c.mutedForeground} />
                </View>
                <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
                  iMessage · Tap for profile & H2H
                </Text>
              </View>
            </Pressable>
          ) : null}
          {mode === "dm" && activeFriend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Taunt ${activeFriend.displayName} with a dance`}
              disabled={tauntBusy}
              onPress={() => void sendFriendTaunt(activeFriend.uid, activeFriend.displayName)}
              hitSlop={8}
              style={({ pressed }) => [styles.tauntBtn, { backgroundColor: c.primary, opacity: tauntBusy ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <MaterialCommunityIcons name="human-handsup" size={16} color={c.primaryForeground} />
              <Text style={[styles.tauntText, { color: c.primaryForeground }]}>Taunt</Text>
            </Pressable>
          ) : mode === "dm" && activeFriend ? null : mode === "league" && activeLeague ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${activeLeague.name}`}
              onPress={() => router.push({ pathname: "/league/[id]", params: { id: activeLeague.id } })}
              style={styles.contactCenter}
            >
              <View style={[styles.groupIconCircle, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.4) }]}>
                <MaterialCommunityIcons name="trophy" size={18} color={c.league} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.contactTitleRow}>
                  <Text style={[styles.headerTitle, { color: c.foreground }]} numberOfLines={1}>
                    {activeLeague.name}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={c.mutedForeground} />
                </View>
                <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
                  {Object.keys(activeLeague.members ?? {}).length} members · Tap for standings
                </Text>
              </View>
            </Pressable>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: c.foreground }]}>Messages</Text>
              <Text style={[styles.headerSub, { color: c.mutedForeground }]}>Direct & League Chats</Text>
            </View>
          )}

          {mode === "dm" && activeFriend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Send ${activeFriend.displayName} a gift or loan`}
              onPress={() => {
                buzz.tick();
                setSendOpen(true);
              }}
              style={[styles.headerActionBtn, { backgroundColor: c.secondary }]}
            >
              <MaterialCommunityIcons name="hand-coin-outline" size={18} color="#007AFF" />
            </Pressable>
          ) : mode === "league" && activeLeague ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Request a peer loan in ${activeLeague.name}`}
              onPress={() => {
                buzz.tick();
                setLeagueLoanModalOpen(true);
              }}
              style={[styles.headerActionBtn, { backgroundColor: c.leagueSoft }]}
            >
              <MaterialCommunityIcons name="hand-coin-outline" size={18} color={c.league} />
            </Pressable>
          ) : null}
        </View>

        <TabStrip<ChatMode>
          bleed={false}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setReplyQuote(null);
            setActiveMenuMsgId(null);
          }}
          options={[
            { value: "dm", label: "Direct Messages", badge: unreadDmCount || undefined },
            { value: "league", label: "League Chats", badge: unreadLeagueCount || undefined },
          ]}
        />

        {/* Horizontal Contact / Group Switcher */}
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
                      setActiveMenuMsgId(null);
                    }}
                    style={[
                      styles.roomChip,
                      {
                        backgroundColor: active ? (c.isDark ? "rgba(0,122,255,0.22)" : "#E5F1FF") : c.secondary,
                        borderColor: active ? "#007AFF" : c.border,
                      },
                    ]}
                  >
                    <MemberAvatar profile={f} name={f.displayName} color={c.primary} catalog={byId} size={24} />
                    <Text
                      style={[
                        styles.roomChipText,
                        { color: active ? (c.isDark ? "#FFFFFF" : "#007AFF") : c.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      {f.displayName}
                    </Text>
                    {unread > 0 && !active ? (
                      <View style={[styles.unreadDot, { backgroundColor: "#007AFF" }]}>
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
                    setActiveMenuMsgId(null);
                  }}
                  style={[
                    styles.roomChip,
                    {
                      backgroundColor: active ? c.leagueSoft : c.secondary,
                      borderColor: active ? c.league : c.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="trophy-outline" size={14} color={active ? c.league : c.mutedForeground} />
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

      {/* Message List (Newest at the Bottom, iOS/WhatsApp grouping) */}
      {mode === "dm" ? (
        !activeFriend && friendsLoading ? (
          <View style={styles.emptyContainer}>
            <LoadingState label="Loading your chats…" />
          </View>
        ) : !activeFriend ? (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon="message-text-outline"
              title="No Direct Chats Yet"
              body="Add a friend to start messaging 1-on-1, share picks, and challenge them head-to-head."
              action="Find Friends"
              onAction={() => router.navigate({ pathname: "/(tabs)/leagues", params: { seg: "friends" } })}
            />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={dmMessages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: m, index }: { item: DirectMessage; index: number }) => {
              const mine = m.senderUid === myUid;
              const prev = index > 0 ? dmMessages[index - 1] : null;
              const next = index < dmMessages.length - 1 ? dmMessages[index + 1] : null;
              const showDateHeader = !prev || dayKeyOf(prev.at) !== dayKeyOf(m.at);
              const sameAsPrev =
                !showDateHeader &&
                prev?.senderUid === m.senderUid &&
                m.at - prev.at < 5 * 60_000;
              const sameAsNext =
                !!next &&
                dayKeyOf(next.at) === dayKeyOf(m.at) &&
                next.senderUid === m.senderUid &&
                next.at - m.at < 5 * 60_000;

              const isLastInGroup = !sameAsNext;
              const initials = (m.senderName || "P")
                .split(" ")
                .map((s: string) => s[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const menuOpen = activeMenuMsgId === m.id;
              const myReaction = m.reactors?.[myUid] ?? null;

              return (
                <View style={{ marginTop: sameAsPrev ? 2 : 10 }}>
                  {showDateHeader ? (
                    <View style={styles.datePillWrap}>
                      <View
                        style={[
                          styles.datePill,
                          {
                            backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                          },
                        ]}
                      >
                        <Text style={[styles.datePillText, { color: c.mutedForeground }]}>
                          {formatDayPill(m.at)}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  <View style={[styles.msgGroup, mine ? styles.msgGroupRight : styles.msgGroupLeft]}>
                    <View style={[styles.msgRow, mine && styles.msgRowRight]}>
                      {!mine ? (
                        isLastInGroup ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`View ${m.senderName}'s profile`}
                            onPress={() => setProfileUid(m.senderUid)}
                            style={[styles.senderDisc, { backgroundColor: c.secondary, borderColor: c.border }]}
                          >
                            <Text style={[styles.senderDiscText, { color: c.foreground }]}>{initials}</Text>
                          </Pressable>
                        ) : (
                          <View style={styles.senderDiscSpacer} />
                        )
                      ) : null}

                      <View style={[styles.bubbleCol, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                        <Pressable
                          onPress={() => {
                            buzz.tick();
                            setActiveMenuMsgId((cur) => (cur === m.id ? null : m.id));
                          }}
                          onLongPress={() => {
                            buzz.medium();
                            setActiveMenuMsgId(m.id);
                          }}
                          style={[
                            styles.bubble,
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
                          {m.replyTo ? (
                            <InlineReplyPreview quote={m.replyTo} mine={mine} isDark={c.isDark} />
                          ) : null}

                          {m.kind === "taunt" ? <TauntCard taunt={m} /> : null}
                          {m.kind === "gift" || m.kind === "money" || m.kind === "loan" ? (
                            <FriendMoneyCard
                              m={m}
                              myUid={myUid}
                              onReplyLoan={(q) => setReplyQuote(q)}
                            />
                          ) : null}

                          <View style={styles.bubbleContentWrap}>
                            <Text style={[styles.bubbleText, { color: mine ? "#FFFFFF" : c.foreground }]}>
                              {chatText(m.text)}
                            </Text>
                            <View style={styles.inlineMeta}>
                              <Text
                                style={[
                                  styles.inlineTime,
                                  { color: mine ? "rgba(255,255,255,0.72)" : c.subtleForeground },
                                ]}
                              >
                                {formatClock(m.at)}
                              </Text>
                              {mine ? (
                                <MaterialCommunityIcons
                                  name="check-all"
                                  size={14}
                                  color="rgba(255,255,255,0.85)"
                                  style={{ marginLeft: 2 }}
                                />
                              ) : null}
                            </View>
                          </View>
                        </Pressable>

                        <ReactionRow
                          reactors={m.reactors}
                          uid={myUid}
                          align={mine ? "right" : "left"}
                          compact
                          onReact={(e) => reactToDm(m, myUid, e)}
                        />
                      </View>
                    </View>

                    {menuOpen ? (
                      <MessageActionTray
                        mine={mine}
                        myReaction={myReaction}
                        onReact={(emoji) => void reactToDm(m, myUid, emoji)}
                        onReply={() =>
                          setReplyQuote({
                            id: m.id,
                            kind: "message",
                            authorUid: m.senderUid,
                            authorName: m.senderName,
                            text: chatText(m.text),
                          })
                        }
                        onReport={
                          !mine
                            ? () =>
                                setReportTarget({
                                  kind: "dm",
                                  uid: m.senderUid,
                                  name: m.senderName,
                                  path: `directMessages/${m.threadId}/messages/${m.id}`,
                                  text: m.text,
                                })
                            : undefined
                        }
                        onClose={() => setActiveMenuMsgId(null)}
                      />
                    ) : null}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <View style={[styles.encryptedPill, { backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}>
                  <MaterialCommunityIcons name="message-lock-outline" size={14} color={c.mutedForeground} />
                  <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
                    Say hey to {activeFriend.displayName} or share a pick below.
                  </Text>
                </View>
              </View>
            }
          />
        )
      ) : !activeLeague && !leaguesReady ? (
        <View style={styles.emptyContainer}>
          <LoadingState label="Loading your leagues…" />
        </View>
      ) : !activeLeague ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="trophy-outline"
            title="No League Chats Yet"
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
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: m, index }: { item: LeagueMessage; index: number }) => {
            const mine = m.uid === myUid;
            const quote = m.replyTo ?? leagueReplyQuotes[m.id] ?? null;
            const prev = index > 0 ? leagueMessages[index - 1] : null;
            const next = index < leagueMessages.length - 1 ? leagueMessages[index + 1] : null;
            const showDateHeader = !prev || dayKeyOf(prev.at) !== dayKeyOf(m.at);

            if (m.kind === "system") {
              return (
                <View style={{ marginTop: 8 }}>
                  {showDateHeader ? (
                    <View style={styles.datePillWrap}>
                      <View style={[styles.datePill, { backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}>
                        <Text style={[styles.datePillText, { color: c.mutedForeground }]}>{formatDayPill(m.at)}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.systemPillWrap}>
                    <View style={[styles.systemPill, { backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}>
                      <Text style={[styles.systemPillText, { color: c.mutedForeground }]}>{chatText(m.text)}</Text>
                    </View>
                  </View>
                </View>
              );
            }

            const sameAsPrev =
              !showDateHeader &&
              prev?.kind !== "system" &&
              prev?.uid === m.uid &&
              m.at - prev.at < 5 * 60_000;
            const sameAsNext =
              !!next &&
              next.kind !== "system" &&
              dayKeyOf(next.at) === dayKeyOf(m.at) &&
              next.uid === m.uid &&
              next.at - m.at < 5 * 60_000;

            const isFirstInGroup = !sameAsPrev;
            const isLastInGroup = !sameAsNext;
            const initials = (m.name || "P")
              .split(" ")
              .map((s: string) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const menuOpen = activeMenuMsgId === m.id;
            const myReaction = m.reactors?.[myUid] ?? null;
            const nameTint = senderColorFor(m.uid);
            const attachedLoan = m.loanId ? leagueLoanById.get(m.loanId) : undefined;

            return (
              <View style={{ marginTop: sameAsPrev ? 2 : 10 }}>
                {showDateHeader ? (
                  <View style={styles.datePillWrap}>
                    <View style={[styles.datePill, { backgroundColor: c.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}>
                      <Text style={[styles.datePillText, { color: c.mutedForeground }]}>{formatDayPill(m.at)}</Text>
                    </View>
                  </View>
                ) : null}

                <View style={[styles.msgGroup, mine ? styles.msgGroupRight : styles.msgGroupLeft]}>
                  <View style={[styles.msgRow, mine && styles.msgRowRight]}>
                    {!mine ? (
                      isLastInGroup ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`View ${m.name}'s profile`}
                          onPress={() => setProfileUid(m.uid)}
                          style={[styles.senderDisc, { backgroundColor: c.secondary, borderColor: c.border }]}
                        >
                          <Text style={[styles.senderDiscText, { color: nameTint }]}>{initials}</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.senderDiscSpacer} />
                      )
                    ) : null}

                    <View style={[styles.bubbleCol, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                      <Pressable
                        onPress={() => {
                          buzz.tick();
                          setActiveMenuMsgId((cur) => (cur === m.id ? null : m.id));
                        }}
                        onLongPress={() => {
                          buzz.medium();
                          setActiveMenuMsgId(m.id);
                        }}
                        style={[
                          styles.bubble,
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
                            <Text style={[styles.groupSenderLabel, { color: nameTint }]}>{m.name}</Text>
                          </Pressable>
                        ) : null}

                        {quote ? <InlineReplyPreview quote={quote} mine={mine} isDark={c.isDark} /> : null}

                        {m.kind === "taunt" ? <TauntCard taunt={m} /> : null}
                        {m.kind === "bet" && activeLeague ? (
                          <BetChatCard
                            message={m}
                            uid={myUid ?? null}
                            leagueId={activeLeague.id}
                            now={now}
                            onTail={(gameId, intent) => {
                              setFollow(intent);
                              setQuickGame(gameId);
                            }}
                          />
                        ) : null}
                        {m.kind === "loan" && activeLeague && attachedLoan ? (
                          <LeagueLoanChatCard
                            league={activeLeague}
                            loan={attachedLoan}
                            myUid={myUid}
                            now={now}
                            onReply={(q) => setReplyQuote(q)}
                          />
                        ) : null}

                        <View style={styles.bubbleContentWrap}>
                          <Text style={[styles.bubbleText, { color: mine ? "#FFFFFF" : c.foreground }]}>
                            {chatText(m.text)}
                          </Text>
                          <View style={styles.inlineMeta}>
                            <Text
                              style={[
                                styles.inlineTime,
                                { color: mine ? "rgba(255,255,255,0.72)" : c.subtleForeground },
                              ]}
                            >
                              {formatClock(m.at)}
                            </Text>
                            {mine ? (
                              <MaterialCommunityIcons
                                name="check-all"
                                size={14}
                                color="rgba(255,255,255,0.85)"
                                style={{ marginLeft: 2 }}
                              />
                            ) : null}
                          </View>
                        </View>
                      </Pressable>

                      {activeLeague && m.kind !== "loan" ? (
                        <ReactionRow
                          reactors={m.reactors}
                          reactions={m.reactions}
                          uid={myUid}
                          align={mine ? "right" : "left"}
                          compact
                          onReact={(e) => reactToItem(activeLeague.id, "message", m.id, e as never)}
                        />
                      ) : null}
                    </View>
                  </View>

                  {menuOpen && activeLeague ? (
                    <MessageActionTray
                      mine={mine}
                      myReaction={myReaction}
                      onReact={(emoji) =>
                        void reactToItem(
                          activeLeague.id,
                          m.kind === "loan" && m.loanId ? "loan" : "message",
                          m.kind === "loan" && m.loanId ? m.loanId : m.id,
                          emoji as never
                        )
                      }
                      onReply={() =>
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
                        })
                      }
                      onReport={
                        !mine && m.kind === "text"
                          ? () =>
                              setReportTarget({
                                kind: "league_message",
                                uid: m.uid,
                                name: m.name,
                                path: `leagues/${activeLeague.id}/messages/${m.id}`,
                                text: m.text,
                              })
                          : undefined
                      }
                      onClose={() => setActiveMenuMsgId(null)}
                    />
                  ) : null}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <View style={[styles.encryptedPill, { backgroundColor: c.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}>
                <MaterialCommunityIcons name="trophy-outline" size={14} color={c.league} />
                <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
                  No messages in {activeLeague.name} yet. Drop the first message below!
                </Text>
              </View>
            </View>
          }
        />
      )}

      {/* Reply composer quote banner */}
      <ReplyComposerBar quote={replyQuote} onCancel={() => setReplyQuote(null)} />

      {/* iOS iMessage / WhatsApp Fixed Bottom Input Bar */}
      {((mode === "dm" && activeFriend) || (mode === "league" && activeLeague)) && (
        <View
          style={[
            styles.inputDock,
            {
              backgroundColor: c.isDark ? "rgba(18, 20, 28, 0.98)" : "rgba(249, 249, 251, 0.98)",
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
          {mode === "dm" && activeFriend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Send ${activeFriend.displayName} clothes, credits or a loan`}
              onPress={() => {
                buzz.tick();
                setSendOpen(true);
              }}
              style={({ pressed }) => [
                styles.plusBtn,
                { backgroundColor: c.secondary, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <MaterialCommunityIcons name="plus" size={22} color="#007AFF" />
            </Pressable>
          ) : mode === "league" && activeLeague ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Request a loan in ${activeLeague.name}`}
              onPress={() => {
                buzz.tick();
                setLeagueLoanModalOpen(true);
              }}
              style={({ pressed }) => [
                styles.plusBtn,
                { backgroundColor: c.leagueSoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <MaterialCommunityIcons name="hand-coin-outline" size={20} color={c.league} />
            </Pressable>
          ) : null}

          <View
            style={[
              styles.inputCapsule,
              {
                backgroundColor: c.isDark ? "#1C1E26" : "#FFFFFF",
                borderColor: c.border,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: c.foreground }]}
              value={text}
              onChangeText={setText}
              placeholder={
                replyQuote
                  ? `Reply to ${replyQuote.authorName}…`
                  : mode === "dm" && activeFriend
                    ? "iMessage…"
                    : `Message ${activeLeague?.name ?? "league"}…`
              }
              placeholderTextColor={c.mutedForeground}
              maxLength={500}
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
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: text.trim() ? "#007AFF" : c.isDark ? "rgba(255,255,255,0.08)" : "#E5E5EA",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="arrow-up"
                size={18}
                color={text.trim() ? "#FFFFFF" : c.mutedForeground}
              />
            </Pressable>
          </View>
        </View>
      )}

      <FriendSendSheet
        friend={sendOpen && activeFriend ? { uid: activeFriend.uid, name: activeFriend.displayName } : null}
        onClose={() => setSendOpen(false)}
      />

      {activeLeague ? (
        <LoanNegotiateModal
          visible={leagueLoanModalOpen}
          onClose={() => setLeagueLoanModalOpen(false)}
          title="Request League Loan in Chat"
          subtitle={`Post an interactive loan card in ${activeLeague.name} so members can fund, counter, or react.`}
          currencyLabel="league tokens"
          initialAmount={Math.min(1000, Math.floor(activeLeague.startingLeagueTokens * 0.2))}
          initialRate={activeLeague.bankInterestRate || 10}
          maxAmount={Math.floor(activeLeague.startingLeagueTokens * PEER_LOAN_MAX_PCT)}
          mode="create"
          onSubmit={async ({ amount, rate, note }) => {
            return await requestLoan(activeLeague.id, amount, rate, note);
          }}
        />
      ) : null}

      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* Friend Profile Sheet with Challenge & Invite to League actions */}
      <PlayerProfileSheet
        uid={profileUid}
        leagueId={mode === "league" ? selectedLeagueId ?? undefined : undefined}
        onClose={() => setProfileUid(null)}
      />
      <GameQuickView
        gameId={quickGame}
        onClose={() => {
          setQuickGame(null);
          setFollow(null);
        }}
        defaultWallet={follow?.leagueId}
        follow={follow}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: {
    width: 34,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -4,
  },
  tauntBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  tauntText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  contactCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarWithStatus: { position: "relative" },
  onlineBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#30D158",
    borderWidth: 2,
  },
  groupIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  contactTitleRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3, flexShrink: 1 },
  headerSub: { fontSize: 11, fontFamily: "Inter_500Medium" },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  roomStrip: { gap: 7, paddingTop: 2, paddingHorizontal: 2 },
  roomChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  roomChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", maxWidth: 120 },
  unreadDot: {
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDotText: { color: "#FFFFFF", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  dotOnly: { width: 7, height: 7, borderRadius: 3.5 },
  emptyContainer: { flex: 1, padding: 20, justifyContent: "center" },
  messagesList: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 16,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  datePillWrap: { alignItems: "center", marginVertical: 10 },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  datePillText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
  systemPillWrap: { alignItems: "center", marginVertical: 4 },
  systemPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    maxWidth: "85%",
  },
  systemPillText: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  msgGroup: { maxWidth: "82%" },
  msgGroupLeft: { alignSelf: "flex-start" },
  msgGroupRight: { alignSelf: "flex-end", alignItems: "flex-end" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  msgRowRight: { justifyContent: "flex-end" },
  senderDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  senderDiscSpacer: { width: 28, height: 28 },
  senderDiscText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  bubbleCol: { flexShrink: 1 },
  groupSenderLabel: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 7,
    minWidth: 68,
    gap: 4,
  },
  inlineQuote: {
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 2,
    gap: 1,
  },
  inlineQuoteAuthor: { fontSize: 11, fontFamily: "Inter_700Bold" },
  inlineQuoteText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  bubbleContentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    columnGap: 8,
    rowGap: 2,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  inlineMeta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginBottom: -1,
  },
  inlineTime: { fontSize: 10, fontFamily: "Inter_500Medium" },
  actionTrayWrap: {
    marginTop: 6,
    marginBottom: 4,
    gap: 6,
    zIndex: 10,
  },
  reactionStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  trayEmojiBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  trayEmoji: { fontSize: 20 },
  trayActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  trayActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  trayActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  trayDivider: { width: StyleSheet.hairlineWidth, height: 18 },
  emptyChat: { paddingVertical: 40, alignItems: "center" },
  encryptedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  emptyChatText: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  inputDock: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plusBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  inputCapsule: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 4,
    minHeight: 38,
    maxHeight: 110,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    paddingTop: Platform.OS === "ios" ? 5 : 4,
    paddingBottom: Platform.OS === "ios" ? 5 : 4,
    paddingRight: 8,
  },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});

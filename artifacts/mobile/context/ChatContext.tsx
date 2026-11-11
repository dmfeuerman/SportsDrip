import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReplyQuote } from "@/components/chat/ReplyThread";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useFriends } from "@/hooks/useFriends";
import { usePolling } from "@/hooks/usePolling";
import { DEMO, demoUid } from "@/lib/demo";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { chatText } from "@/lib/chatText";
import { markChatSeen, useAllChatSeen } from "@/lib/settings";
import { isObjectionable } from "@/lib/moderation";
import { BLOCKED_TEXT_ERROR } from "@/lib/chatText";
import { isBlocked, useBlockedUids, useBlocksSync } from "@/lib/blocks";

const BET_BANNER_GAP_MS = 60 * 60 * 1000;

export interface DirectMessage {
  id: string;
  threadId: string;
  senderUid: string;
  senderName: string;
  recipientUid: string;
  recipientName: string;
  kind: "text" | "taunt" | "gift" | "money" | "loan";
  text: string;
  at: number;
  moveId?: string;
  /** gift: the catalog item sent. */
  itemId?: string;
  itemName?: string;
  /** money / loan: credits involved. */
  amount?: number;
  /** loan: friendLoans/{loanId}. */
  loanId?: string;
  avatar?: import("@/types/avatar").AvatarConfig | null;
  equipped?: import("@/types/avatar").Equipped | null;
  replyTo?: ReplyQuote | null;
  /** uid -> emoji. One reaction per participant. */
  reactors?: Record<string, string>;
}

export interface BetComment {
  id: string;
  betId: string;
  uid: string;
  name: string;
  text: string;
  at: number;
  parentQuote: ReplyQuote;
}

interface ChatContextType {
  /** Canonical pair thread id for two users. */
  threadIdFor: (otherUid: string) => string;
  /** Messages in each DM thread, ordered oldest -> newest (newest at bottom). */
  dmMessagesByThread: Record<string, DirectMessage[]>;
  /** Send a direct message to a friend (optionally quoting a message or win/loss item). */
  sendDirectMessage: (
    recipientUid: string,
    recipientName: string,
    text: string,
    replyTo?: ReplyQuote | null
  ) => Promise<string | null>;
  /** Replies/comments on any player's win/loss bet item, keyed by betId. */
  betComments: Record<string, BetComment[]>;
  /** Add a comment/reply to a player's win/loss item. */
  addBetComment: (
    betId: string,
    text: string,
    parentQuote: ReplyQuote,
    leagueId?: string | null
  ) => Promise<string | null>;
  /** Live-subscribe to a bet's reply thread (returns unsubscribe). */
  watchBetComments: (betId: string) => () => void;
  /** Replies/quotes map for league chat messages (stored locally + Firestore when supported). */
  leagueReplyQuotes: Record<string, ReplyQuote>;
  recordLeagueMessageQuote: (messageId: string, quote: ReplyQuote) => void;
  /** Unread DM count across all friend threads. */
  unreadDmCount: number;
  /** Unread league chat messages across active leagues. */
  unreadLeagueCount: number;
  /** DMs + league chat: the chat icon's badge. */
  unreadChatCount: number;
  /** One token per unread league message ("leagueId:at"), for seen-based badges. */
  unreadLeagueTokens: string[];
  /** Unread count for a specific DM friend. */
  unreadForFriend: (friendUid: string) => number;
  /** Mark a DM thread or league chat as seen. */
  markThreadRead: (threadOrLeagueId: string) => void;
  /** Currently active chat room id (suppresses duplicate banner while viewing that room). */
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

const STORAGE_DM_KEY = "sportdrip.chat.dms.v1";
const STORAGE_COMMENTS_KEY = "sportdrip.chat.bet_comments.v1";
const STORAGE_QUOTES_KEY = "sportdrip.chat.league_quotes.v1";
const CHAT_POLL_MS = 15_000;

/** Firestore rejects undefined; drop optional quote fields that weren't set. */
function cleanQuote(q: ReplyQuote): ReplyQuote {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as ReplyQuote;
}

function mergeComments(a: BetComment[], b: BetComment[]): BetComment[] {
  const byId = new Map<string, BetComment>();
  for (const x of a) byId.set(x.id, x);
  for (const x of b) byId.set(x.id, x);
  return [...byId.values()].sort((x, y) => x.at - y.at);
}

export function canonicalPairId(a: string, b: string): string {
  return a < b ? `dm_${a}_${b}` : `dm_${b}_${a}`;
}

function buildInitialDemoDms(myUid: string): Record<string, DirectMessage[]> {
  const now = Date.now();
  const mayaThread = canonicalPairId(myUid, "maya");
  const theoThread = canonicalPairId(myUid, "theo");
  return {
    [mayaThread]: [
      {
        id: "dm_demo_1",
        threadId: mayaThread,
        senderUid: "maya",
        senderName: "Maya R",
        recipientUid: myUid,
        recipientName: "You",
        kind: "text",
        text: "Are you riding the Celtics tonight or fading?",
        at: now - 35 * 60_000,
      },
      {
        id: "dm_demo_2",
        threadId: mayaThread,
        senderUid: myUid,
        senderName: "Dylan F",
        recipientUid: "maya",
        recipientName: "Maya R",
        kind: "text",
        text: "Already locked BOS -3.5! Let's get it.",
        at: now - 30 * 60_000,
        replyTo: {
          id: "dm_demo_1",
          kind: "message",
          authorUid: "maya",
          authorName: "Maya R",
          text: "Are you riding the Celtics tonight or fading?",
        },
      },
      {
        id: "dm_demo_3",
        threadId: mayaThread,
        senderUid: "maya",
        senderName: "Maya R",
        recipientUid: myUid,
        recipientName: "You",
        kind: "text",
        text: "After this game settles let's run a 1v1 challenge on Sunday NFL!",
        at: now - 12 * 60_000,
      },
      {
        id: "loan_dm_demo_loan_1",
        threadId: mayaThread,
        senderUid: "maya",
        senderName: "Maya R",
        recipientUid: myUid,
        recipientName: "You",
        kind: "loan",
        loanId: "dm_demo_loan_1",
        amount: 500,
        text: "Asked to borrow 500 credits (10% · 550 back) — For Celtics ML tonight",
        at: now - 5 * 60_000,
      },
    ],
    [theoThread]: [
      {
        id: "dm_demo_4",
        threadId: theoThread,
        senderUid: "theo",
        senderName: "Theo K",
        recipientUid: myUid,
        recipientName: "You",
        kind: "text",
        text: "That Nuggets win yesterday was wild, nice hit!",
        at: now - 90 * 60_000,
        replyTo: {
          id: "b3",
          kind: "bet_result",
          authorUid: myUid,
          authorName: "Dylan F",
          text: "DEN v LAL · Won +330 credits (2.10x)",
          betStatus: "won",
          teamAbbr: "DEN",
          opponentAbbr: "LAL",
          odds: 2.1,
          stake: 300,
          payout: 630,
          currency: "credits",
        },
      },
    ],
  };
}

function buildInitialDemoComments(myUid: string): Record<string, BetComment[]> {
  const now = Date.now();
  return {
    b3: [
      {
        id: "cmt_demo_1",
        betId: "b3",
        uid: "maya",
        name: "Maya R",
        text: "Nuggets 4th quarter comeback was unreal 🔥",
        at: now - 2 * 3_600_000,
        parentQuote: {
          id: "b3",
          kind: "bet_result",
          authorUid: myUid,
          authorName: "Dylan F",
          text: "Denver Nuggets vs LAL · WON +330 (2.10x)",
          betStatus: "won",
        },
      },
      {
        id: "cmt_demo_2",
        betId: "b3",
        uid: "theo",
        name: "Theo K",
        text: "I shouldn't have taken the Lakers ML 😭",
        at: now - 90 * 60_000,
        parentQuote: {
          id: "b3",
          kind: "bet_result",
          authorUid: myUid,
          authorName: "Dylan F",
          text: "Denver Nuggets vs LAL · WON +330 (2.10x)",
          betStatus: "won",
        },
      },
    ],
    lb3: [
      {
        id: "cmt_demo_3",
        betId: "lb3",
        uid: "maya",
        name: "Maya R",
        text: "Tough beat Theo, The House is open if you need a loan 👀",
        at: now - 5 * 3_600_000,
        parentQuote: {
          id: "lb3",
          kind: "bet_result",
          authorUid: "theo",
          authorName: "Theo K",
          text: "Los Angeles Lakers vs DEN · LOST -2,500 (1.75x)",
          betStatus: "lost",
        },
      },
    ],
  };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useApp();
  const { leagues, sendMessage: sendLeagueMessage } = useLeague();
  const { reportSyncFailure } = useApp();
  const { show } = useToast();
  const chatSeen = useAllChatSeen();

  const uid = profile?.uid ?? (DEMO ? demoUid : null);
  const myName = profile?.displayName ?? "You";
  useBlocksSync(profile?.uid ?? null);
  const blockedUids = useBlockedUids();

  const [rawDmMessagesByThread, setRawDmMessagesByThread] = useState<Record<string, DirectMessage[]>>(() =>
    uid && DEMO ? buildInitialDemoDms(uid) : {}
  );
  const [rawBetComments, setBetComments] = useState<Record<string, BetComment[]>>(() =>
    uid && DEMO ? buildInitialDemoComments(uid) : {}
  );
  // Blocked players' messages and replies are hidden everywhere.
  const dmMessagesByThread = useMemo(() => {
    if (!blockedUids.size) return rawDmMessagesByThread;
    const out: Record<string, DirectMessage[]> = {};
    for (const [tId, list] of Object.entries(rawDmMessagesByThread)) out[tId] = list.filter((m) => !blockedUids.has(m.senderUid));
    return out;
  }, [rawDmMessagesByThread, blockedUids]);
  const betComments = useMemo(() => {
    if (!blockedUids.size) return rawBetComments;
    const out: Record<string, BetComment[]> = {};
    for (const [betId, list] of Object.entries(rawBetComments)) out[betId] = list.filter((m) => !blockedUids.has(m.uid));
    return out;
  }, [rawBetComments, blockedUids]);
  const [leagueReplyQuotes, setLeagueReplyQuotes] = useState<Record<string, ReplyQuote>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // Read by the snapshot listeners without resubscribing every time a chat opens.
  const activeChatRef = useRef<string | null>(null);
  activeChatRef.current = activeChatId;
  /** Latest incoming league chat messages (others' text only), per league. */
  const [leagueIncoming, setLeagueIncoming] = useState<Record<string, number[]>>({});
  const { friends } = useFriends(DEMO ? null : uid);
  const friendIdsKey = friends
    .map((f) => f.uid)
    .filter((id) => id && id !== uid)
    .sort()
    .join(",");

  // Track seen message IDs so we only trigger real-chat notifications on newly arrived texts
  const bootTimeRef = useRef(Date.now());
  const notifiedMsgIds = useRef<Set<string>>(new Set());
  const lastBetBannerAt = useRef<Record<string, number>>({});

  // Hydrate persisted DMs, bet comments, and reply quotes from AsyncStorage
  useEffect(() => {
    if (!uid) return;
    AsyncStorage.multiGet([STORAGE_DM_KEY, STORAGE_COMMENTS_KEY, STORAGE_QUOTES_KEY])
      .then((entries) => {
        const dmRaw = entries[0]?.[1];
        const cmtRaw = entries[1]?.[1];
        const qtRaw = entries[2]?.[1];
        if (dmRaw) {
          try {
            const parsed = JSON.parse(dmRaw) as Record<string, DirectMessage[]>;
            // Earlier builds seeded demo threads for every account; drop them outside demo mode.
            if (!DEMO) {
              for (const [tId, list] of Object.entries(parsed)) {
                const real = list.filter((m) => !m.id.startsWith("dm_demo_"));
                if (real.length) parsed[tId] = real;
                else delete parsed[tId];
              }
            }
            setRawDmMessagesByThread((prev) => ({ ...prev, ...parsed }));
          } catch {}
        } else {
          if (DEMO) setRawDmMessagesByThread((prev) => (Object.keys(prev).length ? prev : buildInitialDemoDms(uid)));
        }
        if (cmtRaw) {
          try {
            const parsed = JSON.parse(cmtRaw) as Record<string, BetComment[]>;
            setBetComments((prev) => ({ ...prev, ...parsed }));
          } catch {}
        }
        if (qtRaw) {
          try {
            setLeagueReplyQuotes(JSON.parse(qtRaw) as Record<string, ReplyQuote>);
          } catch {}
        }
      })
      .catch(() => {});
  }, [uid]);

  const threadIdFor = useCallback(
    (otherUid: string) => canonicalPairId(uid ?? "local", otherUid),
    [uid]
  );

  /**
   * Real-time Firestore listener for League Chat Messages (Real Chats Only)
   * + DM threads when Firebase is configured.
   *
   * Filtering rule: ONLY trigger notifications when `kind === "text"` (actual chat messages
   * from another user). System events (`kind === "bet"`, `kind === "system"`, bet results,
   * loan requests, league updates) are strictly excluded from chat notifications.
   */
  const leagueIdsKey = leagues.filter((l) => l.status === "active").map((l) => l.id).join(",");
  const leaguesRef = useRef(leagues);
  leaguesRef.current = leagues;
  useEffect(() => {
    if (!firebaseConfigured || !uid || DEMO || !leagueIdsKey) return;
    const db = getDb();
    if (!db) return;
    const ids = leagueIdsKey.split(",").filter(Boolean);
    const unsubs = ids.map((leagueId) =>
      onSnapshot(
        query(collection(db, "leagues", leagueId, "messages"), orderBy("at", "desc"), limit(25)),
        (snap) => {
          const incoming: number[] = [];
          for (const d of snap.docs) {
            const data = d.data() as {
              uid?: string;
              name?: string;
              kind?: string;
              text?: string;
              at?: number;
            };
            // Text and other members' bet cards banner; system rows never do.
            if (data.kind !== "text" && data.kind !== "bet") continue;
            if (!data.uid || data.uid === uid || isBlocked(data.uid)) continue;
            const isBet = data.kind === "bet";
            const at = typeof data.at === "number" ? data.at : 0;
            if (!isBet) incoming.push(at);
            if (activeChatRef.current === leagueId) markChatSeen(leagueId, at);
            if (at < bootTimeRef.current) continue;
            const notifyKey = `lchat_${leagueId}_${d.id}`;
            if (notifiedMsgIds.current.has(notifyKey)) continue;
            notifiedMsgIds.current.add(notifyKey);
            if (activeChatRef.current === leagueId) continue;
            // At most one bet banner per league per hour, so a busy slate doesn't spam.
            if (isBet) {
              const last = lastBetBannerAt.current[leagueId] ?? 0;
              if (at - last < BET_BANNER_GAP_MS) continue;
              lastBetBannerAt.current[leagueId] = at;
            }

            const leagueName = leaguesRef.current.find((l) => l.id === leagueId)?.name ?? "League Chat";
            show({
              id: notifyKey,
              kind: "social",
              icon: isBet ? "ticket-confirmation-outline" : "message-text-outline",
              title: `${data.name ?? "League-mate"} in ${leagueName}`,
              body: chatText(data.text),
              href: { pathname: "/messages" as never, params: { leagueId } },
              cta: isBet ? "View" : "Reply",
            });
          }
          setLeagueIncoming((prev) => ({ ...prev, [leagueId]: incoming }));
        },
        () => {}
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [uid, leagueIdsKey, show]);

  // Subscribe to Firestore directMessages collection for the signed-in user when available
  useEffect(() => {
    if (!firebaseConfigured || !uid || DEMO) return;
    const db = getDb();
    if (!db) return;
    const friendIds = friendIdsKey.split(",").filter(Boolean);
    const unsubs = friendIds.map((fUid) => {
      const tId = canonicalPairId(uid, fUid);
      return onSnapshot(
        query(collection(db, "directMessages", tId, "messages"), orderBy("at", "asc"), limit(100)),
        (snap) => {
          if (snap.empty) return;
          const list = snap.docs.map((d) => ({ ...(d.data() as DirectMessage), id: d.id }));
          setRawDmMessagesByThread((prev) => ({ ...prev, [tId]: list }));
          for (const m of list) {
            // STRICT FILTER: Only real DM text messages from the other user
            if (m.kind !== "text" || m.senderUid === uid || isBlocked(m.senderUid)) continue;
            if (activeChatRef.current === tId) markChatSeen(tId, m.at);
            if (m.at < bootTimeRef.current) continue;
            const notifyKey = `dm_${m.id}`;
            if (notifiedMsgIds.current.has(notifyKey)) continue;
            notifiedMsgIds.current.add(notifyKey);
            if (activeChatRef.current === tId) continue;
            show({
              id: notifyKey,
              kind: "social",
              icon: "message-reply-text-outline",
              title: m.senderName,
              body: chatText(m.text),
              href: { pathname: "/messages" as never, params: { uid: m.senderUid, name: m.senderName } },
              cta: "Reply",
            });
          }
        },
        () => {}
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [uid, friendIdsKey, show]);

  // Foreground polling check for any newly stored DM messages (real chats only)
  const pollChats = useCallback(() => {
    if (!uid) return;
    AsyncStorage.getItem(STORAGE_DM_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, DirectMessage[]>;
        for (const [tId, list] of Object.entries(parsed)) {
          for (const m of list) {
            if (m.kind !== "text" || m.senderUid === uid) continue;
            if (m.at < bootTimeRef.current) continue;
            const notifyKey = `dm_${m.id}`;
            if (notifiedMsgIds.current.has(notifyKey)) continue;
            notifiedMsgIds.current.add(notifyKey);
            if (activeChatRef.current === tId) continue;
            show({
              id: notifyKey,
              kind: "social",
              icon: "message-reply-text-outline",
              title: m.senderName,
              body: chatText(m.text),
              href: { pathname: "/messages" as never, params: { uid: m.senderUid, name: m.senderName } },
              cta: "Reply",
            });
          }
        }
      })
      .catch(() => {});
  }, [uid, show]);

  usePolling(pollChats, CHAT_POLL_MS, !!uid);

  const sendDirectMessage = useCallback(
    async (
      recipientUid: string,
      recipientName: string,
      rawText: string,
      replyTo?: ReplyQuote | null
    ): Promise<string | null> => {
      const text = rawText.trim();
      if (!text) return "Write a message first.";
      if (text.length > 500) return "Messages are capped at 500 characters.";
      if (isObjectionable(text)) return BLOCKED_TEXT_ERROR;
      if (isBlocked(recipientUid)) return "You've blocked this player. Unblock them in Settings to message them.";
      const senderUid = uid ?? "local";
      const tId = canonicalPairId(senderUid, recipientUid);
      const msgId = `dm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const msg: DirectMessage = {
        id: msgId,
        threadId: tId,
        senderUid,
        senderName: myName,
        recipientUid,
        recipientName,
        kind: "text",
        text,
        at: Date.now(),
        replyTo: replyTo ?? null,
      };

      setRawDmMessagesByThread((prev) => {
        const existing = prev[tId] ?? [];
        const next = { ...prev, [tId]: [...existing, msg] };
        AsyncStorage.setItem(STORAGE_DM_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      markChatSeen(tId, msg.at);

      if (firebaseConfigured && !DEMO) {
        const db = getDb();
        if (db) {
          setDoc(doc(db, "directMessages", tId, "messages", msgId), {
            ...msg,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
      return null;
    },
    [uid, myName]
  );

  const recordLeagueMessageQuote = useCallback((messageId: string, quote: ReplyQuote) => {
    setLeagueReplyQuotes((prev) => {
      const next = { ...prev, [messageId]: quote };
      AsyncStorage.setItem(STORAGE_QUOTES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const addBetComment = useCallback(
    async (
      betId: string,
      rawText: string,
      parentQuote: ReplyQuote,
      leagueId?: string | null
    ): Promise<string | null> => {
      const text = rawText.trim();
      if (!text) return "Write a comment first.";
      if (text.length > 500) return "Comments are capped at 500 characters.";
      if (isObjectionable(text)) return BLOCKED_TEXT_ERROR;
      const quote = cleanQuote(parentQuote);
      const cmtId = `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const entry: BetComment = {
        id: cmtId,
        betId,
        uid: uid ?? "local",
        name: myName,
        text,
        at: Date.now(),
        parentQuote: quote,
      };

      const persistLocal = (fn: (list: BetComment[]) => BetComment[]) =>
        setBetComments((prev) => {
          const next = { ...prev, [betId]: fn(prev[betId] ?? []) };
          AsyncStorage.setItem(STORAGE_COMMENTS_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });

      persistLocal((list) => [...list, entry]);

      if (firebaseConfigured && !DEMO) {
        const db = getDb();
        if (db) {
          // Shown already (persistLocal); the write runs behind it and is taken back if it fails.
          setDoc(doc(db, "betComments", betId, "comments", cmtId), {
            ...entry,
            createdAt: serverTimestamp(),
          }).catch(() => {
            persistLocal((list) => list.filter((x) => x.id !== cmtId));
            reportSyncFailure("Couldn't send your reply.", "Check your connection and try again.");
          });
        }
      }

      // Inside a league, also drop it in the league chat, quoting the result.
      if (leagueId) {
        const err = await sendLeagueMessage(leagueId, text, quote);
        if (err) return err;
      }
      return null;
    },
    [uid, myName, sendLeagueMessage, reportSyncFailure]
  );

  const watchBetComments = useCallback(
    (betId: string) => {
      if (!firebaseConfigured || DEMO || !uid) return () => {};
      const db = getDb();
      if (!db) return () => {};
      return onSnapshot(
        query(collection(db, "betComments", betId, "comments"), orderBy("at", "asc"), limit(200)),
        (snap) => {
          const server = snap.docs.map((d) => {
            const x = d.data() as BetComment;
            return { ...x, id: d.id, betId };
          });
          setBetComments((prev) => ({ ...prev, [betId]: mergeComments(prev[betId] ?? [], server) }));
        },
        () => {}
      );
    },
    [uid]
  );

  const unreadForFriend = useCallback(
    (friendUid: string) => {
      if (!uid) return 0;
      const tId = canonicalPairId(uid, friendUid);
      const seen = chatSeen[tId] ?? 0;
      const list = dmMessagesByThread[tId] ?? [];
      return list.filter((m) => m.senderUid !== uid && m.at > seen).length;
    },
    [uid, chatSeen, dmMessagesByThread]
  );

  const unreadDmCount = useMemo(() => {
    if (!uid) return 0;
    let total = 0;
    for (const [tId, list] of Object.entries(dmMessagesByThread)) {
      const seen = chatSeen[tId] ?? 0;
      total += list.filter((m) => m.senderUid !== uid && m.at > seen).length;
    }
    return total;
  }, [uid, chatSeen, dmMessagesByThread]);

  const unreadLeagueCount = useMemo(() => {
    let total = 0;
    for (const [leagueId, ats] of Object.entries(leagueIncoming)) {
      if (!leagueIdsKey.split(",").includes(leagueId)) continue;
      const seen = chatSeen[leagueId] ?? 0;
      total += ats.filter((at) => at > seen).length;
    }
    return total;
  }, [leagueIncoming, leagueIdsKey, chatSeen]);
  const unreadChatCount = unreadDmCount + unreadLeagueCount;
  const unreadLeagueTokens = useMemo(() => {
    const out: string[] = [];
    const ids = leagueIdsKey.split(",");
    for (const [leagueId, ats] of Object.entries(leagueIncoming)) {
      if (!ids.includes(leagueId)) continue;
      const seen = chatSeen[leagueId] ?? 0;
      for (const at of ats) if (at > seen) out.push(`${leagueId}:${at}`);
    }
    return out;
  }, [leagueIncoming, leagueIdsKey, chatSeen]);

  const latestRef = useRef({ dm: dmMessagesByThread, league: leagueIncoming });
  latestRef.current = { dm: dmMessagesByThread, league: leagueIncoming };
  const markThreadRead = useCallback((threadOrLeagueId: string) => {
    // Up to the newest message, even when the sender's clock runs ahead of ours.
    const { dm, league } = latestRef.current;
    const newest = Math.max(0, ...(dm[threadOrLeagueId] ?? []).map((m) => m.at), ...(league[threadOrLeagueId] ?? []));
    markChatSeen(threadOrLeagueId, Math.max(Date.now(), newest));
  }, []);

  const value = useMemo<ChatContextType>(
    () => ({
      threadIdFor,
      dmMessagesByThread,
      sendDirectMessage,
      betComments,
      addBetComment,
      watchBetComments,
      leagueReplyQuotes,
      recordLeagueMessageQuote,
      unreadDmCount,
      unreadLeagueCount,
      unreadChatCount,
      unreadLeagueTokens,
      unreadForFriend,
      markThreadRead,
      activeChatId,
      setActiveChatId,
    }),
    [
      threadIdFor,
      dmMessagesByThread,
      sendDirectMessage,
      betComments,
      addBetComment,
      watchBetComments,
      leagueReplyQuotes,
      recordLeagueMessageQuote,
      unreadDmCount,
      unreadLeagueCount,
      unreadChatCount,
      unreadLeagueTokens,
      unreadForFriend,
      markThreadRead,
      activeChatId,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}

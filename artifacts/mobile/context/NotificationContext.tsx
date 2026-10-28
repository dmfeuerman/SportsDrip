import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type QuerySnapshot,
} from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { DEMO, demoNotifications } from "@/lib/demo";
import {
  EMPTY_QUEUE,
  coldStart,
  current,
  dismiss as dismissOne,
  dismissAll as dismissEvery,
  enqueue,
  prune,
  type QueueState,
} from "@/lib/notificationQueue";

/**
 * Bet results, league payouts, loan events and invites.
 *
 * The server writes users/{uid}/notifications/{id} inside the same
 * transaction that moved the money, under an id derived from the event. So a
 * popup here is always backed by a real settlement — never by the client
 * guessing from a score — and a settlement that is processed twice still
 * produces one document, which the queue then shows once.
 */

export interface AppNotification {
  id: string;
  type:
    | "bet_won"
    | "bet_lost"
    | "bet_push"
    | "bet_refunded"
    | "league_payout"
    | "league_ended"
    | "league_invite"
    | "loan_funded"
    | "loan_repaid"
    | "loan_countered"
    | "loan_request"
    | "friend_request"
    | "friend_accepted";
  title: string;
  body: string;
  delta: number;
  balanceAfter: number | null;
  wallet: "credits" | "league";
  leagueId: string | null;
  leagueName: string | null;
  bet: {
    betId: string;
    gameId: string;
    sport: string | null;
    side: "home" | "away";
    teamName: string;
    teamAbbr: string;
    teamColor: string;
    opponentAbbr: string;
    odds: number;
    stake: number;
    payout: number;
    finalHomeScore: number | null;
    finalAwayScore: number | null;
  } | null;
  popup: boolean;
  read: boolean;
  createdAtMs: number;
  data: Record<string, string> | null;
}

/**
 * Social, loan and refund events go to the slide-down banner (InviteToastHost
 * → ToastHost), not the full result popup, which is built around a win, a
 * loss or a payout.
 */
export const SOCIAL_TYPES: ReadonlySet<AppNotification["type"]> = new Set([
  "league_invite",
  "friend_request",
  "friend_accepted",
  "loan_request",
  "loan_countered",
  "loan_funded",
  "loan_repaid",
  "bet_refunded",
]);
const isSocial = (n: AppNotification) => SOCIAL_TYPES.has(n.type);

function isPermanent(err: { code?: string }) {
  return err.code === "permission-denied" || err.code === "unauthenticated";
}

/** Foreground poll interval. Listener is primary; this catches what it drops. */
export const NOTIFICATION_POLL_MS = 30_000;

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  /** The popup on screen right now, if any. */
  popup: AppNotification | null;
  /** Popups still waiting behind the current one. */
  waiting: number;
  /** Results that settled while the app was closed, shown together as one recap (3+ of them). */
  recap: AppNotification[];
  dismissRecap: () => void;
  dismissPopup: () => void;
  dismissAllPopups: () => void;
  /** Newest unseen invite / friend event for the banner, if any. */
  toast: AppNotification | null;
  dismissToast: () => void;
  /** One-shot server read; also runs every NOTIFICATION_POLL_MS in the foreground. */
  refresh: () => Promise<void>;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
}

const Ctx = createContext<NotificationContextType | null>(null);
const NONE: AppNotification[] = [];

export function NotificationProvider({ uid, children }: { uid: string | null; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(DEMO ? demoNotifications : NONE);
  const [boot] = useState(() => (DEMO ? coldStart(EMPTY_QUEUE, demoNotifications.filter((n) => !isSocial(n)), Date.now()) : null));
  const [queue, setQueue] = useState<QueueState>(boot?.state ?? EMPTY_QUEUE);
  const [recapIds, setRecapIds] = useState<string[]>(boot?.recap ?? []);
  // The first snapshot after opening the app catches up on everything missed (coldStart);
  // later ones only queue what's new.
  const opened = useRef(!!boot);
  const [toastQueue, setToastQueue] = useState<QueueState>(EMPTY_QUEUE);
  // Bumped to re-attach the listener after it errors. Firestore never retries a
  // listener that has failed, so before this one permission blip at sign-in
  // (token not yet attached) meant no notifications for the rest of the session.
  const [listenGen, setListenGen] = useState(0);
  const signature = useRef("");

  const enabled = firebaseConfigured && !!uid && !DEMO;

  const apply = useCallback((snap: QuerySnapshot) => {
    const list = snap.docs.map((d) => ({ ...(d.data() as AppNotification), id: d.id }));
    // Polls return the same data most of the time; don't re-render for nothing.
    const sig = list.map((n) => `${n.id}:${n.read ? 1 : 0}:${n.createdAtMs}`).join("|");
    if (sig === signature.current) return;
    signature.current = sig;
    const now = Date.now();
    const results = list.filter((n) => !isSocial(n));
    const social = list.filter(isSocial).map((n) => ({ ...n, popup: true }));
    setNotifications(list);
    if (!opened.current) {
      opened.current = true;
      setQueue((q) => {
        const r = coldStart(prune(q, results), results, now);
        if (r.recap.length) setRecapIds(r.recap);
        return r.state;
      });
    } else {
      setQueue((q) => enqueue(prune(q, results), results, now));
    }
    setToastQueue((q) => enqueue(prune(q, social), social, now));
  }, []);

  const notificationsQuery = useCallback(() => {
    const db = getDb();
    if (!db || !uid) return null;
    return query(collection(db, "users", uid, "notifications"), orderBy("createdAtMs", "desc"), limit(60));
  }, [uid]);

  useEffect(() => {
    if (!enabled) return;
    const q = notificationsQuery();
    if (!q) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const unsub = onSnapshot(q, apply, (err) => {
      if (__DEV__) console.warn(`[notifications] listener: ${err.code} — ${err.message}`);
      // Rules/auth denials are permanent for this session; retrying just
      // hammers the backend. Anything else (network, stalled channel) retries.
      if (isPermanent(err)) return;
      retry = setTimeout(() => setListenGen((g) => g + 1), 5_000);
    });
    return () => {
      if (retry) clearTimeout(retry);
      unsub();
    };
  }, [enabled, notificationsQuery, apply, listenGen]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const q = notificationsQuery();
    if (!q) return;
    // Never rejects: callers (poll timer, pull-to-refresh) fire and forget.
    try {
      apply(await getDocs(q));
    } catch (err) {
      if (__DEV__) console.warn(`[notifications] poll: ${(err as { code?: string }).code ?? err}`);
    }
  }, [enabled, notificationsQuery, apply]);

  usePolling(refresh, NOTIFICATION_POLL_MS, enabled);

  const markRead = useCallback(
    (ids: string[]) => {
      if (DEMO) {
        setNotifications((p) => p.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
        return;
      }
      const db = getDb();
      if (!db || !uid || ids.length === 0) return;
      if (ids.length === 1) {
        updateDoc(doc(db, "users", uid, "notifications", ids[0]!), { read: true }).catch(() => {});
        return;
      }
      const batch = writeBatch(db);
      ids.slice(0, 450).forEach((id) => batch.update(doc(db, "users", uid, "notifications", id), { read: true }));
      batch.commit().catch(() => {});
    },
    [uid]
  );

  const currentId = current(queue);
  const popup = useMemo(
    () => (currentId ? notifications.find((n) => n.id === currentId) ?? null : null),
    [currentId, notifications]
  );

  const dismissPopup = useCallback(() => {
    if (!currentId) return;
    markRead([currentId]);
    setQueue((q) => dismissOne(q, currentId));
  }, [currentId, markRead]);

  const dismissAllPopups = useCallback(() => {
    markRead(queue.queue);
    setQueue((q) => dismissEvery(q));
  }, [queue.queue, markRead]);

  const toastId = current(toastQueue);
  const toast = useMemo(
    () => (toastId ? notifications.find((n) => n.id === toastId) ?? null : null),
    [toastId, notifications]
  );
  const dismissToast = useCallback(() => {
    if (!toastId) return;
    setToastQueue((q) => dismissOne(q, toastId));
  }, [toastId]);

  const recap = useMemo(() => {
    if (!recapIds.length) return NONE;
    const byId = new Map(notifications.map((n) => [n.id, n]));
    return recapIds.map((id) => byId.get(id)).filter((n): n is AppNotification => !!n && !n.read);
  }, [recapIds, notifications]);
  const dismissRecap = useCallback(() => {
    markRead(recapIds);
    setRecapIds([]);
  }, [recapIds, markRead]);

  const markAllRead = useCallback(() => {
    markRead(notifications.filter((n) => !n.read).map((n) => n.id));
  }, [notifications, markRead]);

  const value = useMemo<NotificationContextType>(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      popup,
      waiting: Math.max(0, queue.queue.length - 1),
      recap,
      dismissRecap,
      dismissPopup,
      dismissAllPopups,
      toast,
      dismissToast,
      refresh,
      markRead,
      markAllRead,
    }),
    [notifications, popup, queue.queue.length, recap, dismissRecap, dismissPopup, dismissAllPopups, toast, dismissToast, refresh, markRead, markAllRead]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

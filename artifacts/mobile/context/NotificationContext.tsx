import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { DEMO, demoNotifications } from "@/lib/demo";
import {
  EMPTY_QUEUE,
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
    | "loan_request";
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

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  /** The popup on screen right now, if any. */
  popup: AppNotification | null;
  /** Popups still waiting behind the current one. */
  waiting: number;
  dismissPopup: () => void;
  dismissAllPopups: () => void;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
}

const Ctx = createContext<NotificationContextType | null>(null);
const NONE: AppNotification[] = [];

export function NotificationProvider({ uid, children }: { uid: string | null; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(DEMO ? demoNotifications : NONE);
  const [queue, setQueue] = useState<QueueState>(() => (DEMO ? enqueue(EMPTY_QUEUE, demoNotifications, Date.now()) : EMPTY_QUEUE));

  useEffect(() => {
    if (!firebaseConfigured || !uid) return;
    const db = getDb();
    if (!db) return;
    return onSnapshot(
      query(collection(db, "users", uid, "notifications"), orderBy("createdAtMs", "desc"), limit(60)),
      (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as AppNotification), id: d.id }));
        setNotifications(list);
        setQueue((q) => enqueue(prune(q, list), list, Date.now()));
      },
      () => {}
    );
  }, [uid]);

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

  const markAllRead = useCallback(() => {
    markRead(notifications.filter((n) => !n.read).map((n) => n.id));
  }, [notifications, markRead]);

  const value = useMemo<NotificationContextType>(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      popup,
      waiting: Math.max(0, queue.queue.length - 1),
      dismissPopup,
      dismissAllPopups,
      markRead,
      markAllRead,
    }),
    [notifications, popup, queue.queue.length, dismissPopup, dismissAllPopups, markRead, markAllRead]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

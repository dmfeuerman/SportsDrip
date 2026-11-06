import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { subscribeCached, type CachedHandle } from "@/lib/cachedQuery";
import { usePolling } from "@/hooks/usePolling";
import {
  configurePushPresentation,
  registerForPush,
  routeFromResponse,
  setAppBadge,
  type PushStatus,
} from "@/lib/push";
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
    | "friend_accepted"
    | "challenge_received"
    | "challenge_accepted"
    | "challenge_declined"
    | "challenge_cancelled"
    | "challenge_expired"
    | "challenge_won"
    | "challenge_lost"
    | "challenge_push"
    | "challenge_refunded"
    | "bet_tailed"
    | "bet_faded"
    | "stimulus_request"
    | "stimulus_approved"
    | "level_up"
    | "team_reminder"
    | "reaction"
    | "sweat_alert"
    | "achievement"
    | "referral_bonus"
    | "gift_received"
    | "credits_received"
    | "birthday_gift"
    | "win_back";
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
  "challenge_received",
  "challenge_accepted",
  "challenge_declined",
  "challenge_cancelled",
  "challenge_expired",
  "challenge_push",
  "challenge_refunded",
  "bet_tailed",
  "bet_faded",
  "stimulus_request",
  "stimulus_approved",
  "referral_bonus",
  "gift_received",
  "credits_received",
  "birthday_gift",
]);

/** A settled head-to-head carries a `bet` from the player's side, so it renders like a bet result. */
export const isWin = (n: AppNotification) => n.type === "bet_won" || n.type === "challenge_won";
export const isLoss = (n: AppNotification) => n.type === "bet_lost" || n.type === "challenge_lost";
export const isChallenge = (n: AppNotification) => n.type.startsWith("challenge_");
const isSocial = (n: AppNotification) => SOCIAL_TYPES.has(n.type);

function isPermanent(err: { code?: string }) {
  return err.code === "permission-denied" || err.code === "unauthenticated";
}

/** Foreground poll interval. Listener is primary; this catches what it drops. */
export const NOTIFICATION_POLL_MS = 2 * 60_000;

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
  /** iOS push permission for this device. */
  pushStatus: PushStatus;
  /** Asks for permission if it hasn't been asked, then registers the token. */
  enablePush: () => Promise<PushStatus>;
}

const Ctx = createContext<NotificationContextType | null>(null);
const NONE: AppNotification[] = [];

configurePushPresentation();

export function NotificationProvider({
  uid,
  promptForPush = false,
  children,
}: {
  uid: string | null;
  /** Allowed to show the iOS permission prompt (false during onboarding). */
  promptForPush?: boolean;
  children: React.ReactNode;
}) {
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

  const apply = useCallback((list: AppNotification[]) => {
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

  /**
   * The list lives on the phone (lib/cachedQuery.ts): opening the app shows
   * the cached 60 and reads only notifications created since. Read flags are
   * set by this phone and patched into the cache as they're written.
   */
  const cache = useRef<CachedHandle<AppNotification> | null>(null);
  useEffect(() => {
    if (!enabled || !uid) return;
    const db = getDb();
    if (!db) return;
    const col = collection(db, "users", uid, "notifications");
    let retry: ReturnType<typeof setTimeout> | null = null;
    const handle = subscribeCached<AppNotification>(
      {
        key: `sd.cache.notifications.${uid}`,
        version: 1,
        cursorType: "number",
        full: () => query(col, orderBy("createdAtMs", "desc"), limit(60)),
        delta: (after) => query(col, where("createdAtMs", ">", after), orderBy("createdAtMs", "desc")),
        cursorOf: (n) => (typeof n.createdAtMs === "number" ? n.createdAtMs : null),
        keep: (list) => list.sort((x, y) => (y.createdAtMs ?? 0) - (x.createdAtMs ?? 0)).slice(0, 60),
        fullEveryMs: 7 * 24 * 3_600_000,
      },
      (list) => apply(list),
      (err) => {
        const e = err as Error & { code?: string };
        if (__DEV__) console.warn(`[notifications] listener: ${e.code} — ${e.message}`);
        // Rules/auth denials are permanent for this session; retrying just
        // hammers the backend. Anything else (network, stalled channel) retries.
        if (isPermanent(e)) return;
        retry = setTimeout(() => setListenGen((g) => g + 1), 5_000);
      }
    );
    cache.current = handle;
    return () => {
      if (retry) clearTimeout(retry);
      handle.stop();
      if (cache.current === handle) cache.current = null;
    };
  }, [enabled, uid, apply, listenGen]);

  const newest = useRef<string | null>(null);
  newest.current = notifications[0]?.id ?? null;

  /** Pull-to-refresh: re-attach the listener (reads only what's new since the cache). */
  const refresh = useCallback(async () => {
    if (enabled) setListenGen((g) => g + 1);
  }, [enabled]);

  /**
   * Safety net under the listener, for a channel that stalled silently: read
   * the newest one, and re-attach only if the listener missed something.
   */
  const probe = useCallback(async () => {
    if (!enabled) return;
    const db = getDb();
    if (!db || !uid) return;
    try {
      const top = await getDocs(query(collection(db, "users", uid, "notifications"), orderBy("createdAtMs", "desc"), limit(1)));
      const id = top.docs[0]?.id ?? null;
      if (id !== newest.current) await refresh();
    } catch (err) {
      if (__DEV__) console.warn(`[notifications] probe: ${(err as { code?: string }).code ?? err}`);
    }
  }, [enabled, uid, refresh]);

  usePolling(probe, NOTIFICATION_POLL_MS, enabled);

  const markRead = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      // Clear the badge now; the write follows.
      const set = new Set(ids);
      setNotifications((p) => (p.some((n) => set.has(n.id) && !n.read) ? p.map((n) => (set.has(n.id) ? { ...n, read: true } : n)) : p));
      for (const id of ids) cache.current?.patch(id, { read: true } as Partial<AppNotification>);
      if (DEMO) return;
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

  // ── push ────────────────────────────────────────────────────────────────
  const [pushStatus, setPushStatus] = useState<PushStatus>("undetermined");
  const enablePush = useCallback(async () => {
    if (!uid) return "unsupported" as const;
    const s = await registerForPush({ prompt: true, uid });
    setPushStatus(s);
    return s;
  }, [uid]);

  // Register on sign-in, prompt once onboarding is behind the user, and refresh
  // silently whenever the app comes back (they may have flipped it on in Settings).
  useEffect(() => {
    if (!enabled || !uid || Platform.OS !== "ios") return;
    let alive = true;
    const run = (prompt: boolean) =>
      registerForPush({ prompt, uid }).then((s) => {
        if (alive) setPushStatus(s);
      });
    void run(promptForPush);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run(false);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled, uid, promptForPush]);

  // Tapping a push opens the screen it's about and marks it read. Covers both a
  // running app and a cold start from the notification.
  const handledResponse = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || Platform.OS !== "ios") return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = routeFromResponse(response);
      const key = response?.notification.request.identifier ?? null;
      if (!target || !key || handledResponse.current === key) return;
      handledResponse.current = key;
      if (target.notificationId) markRead([target.notificationId]);
      // Let the navigator finish mounting on a cold start.
      setTimeout(() => {
        try {
          router.push(target.url as Href);
        } catch (err) {
          if (__DEV__) console.warn("[push] couldn't open", target.url, err);
        }
      }, 250);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled, markRead]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  useEffect(() => {
    if (enabled) void setAppBadge(unreadCount);
  }, [enabled, unreadCount]);

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
      unreadCount,
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
      pushStatus,
      enablePush,
    }),
    [notifications, unreadCount, popup, queue.queue.length, recap, dismissRecap, dismissPopup, dismissAllPopups, toast, dismissToast, refresh, markRead, markAllRead, pushStatus, enablePush]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

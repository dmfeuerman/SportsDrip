import type { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Href } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getMutedToastKinds } from "@/lib/settings";
import type { Currency } from "@/components/ui";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * The visual family of a banner: sets its accent colour, icon default and haptic.
 *  - win     money landed (bet cashed, loan funded)
 *  - live    something is happening in a game you're on
 *  - league  standings and league activity
 *  - social  friends and invites
 *  - loan    loan requests and repayments
 *  - warning heads-up (bet in trouble, error)
 *  - info    everything else
 */
export type ToastKind = "win" | "live" | "league" | "social" | "loan" | "warning" | "info";

/** An inline button on the banner (Accept / Decline, Undo). At most two. */
export interface ToastAction {
  label: string;
  onPress: () => void;
  /** Tinted red instead of the banner's accent. */
  destructive?: boolean;
}

export interface ToastInput {
  /** Same id twice is shown once (the second call is dropped while the first is queued or showing). */
  id?: string;
  kind?: ToastKind;
  title: string;
  body?: string;
  icon?: IconName;
  /** Overrides the kind's accent colour (e.g. a team colour). */
  color?: string;
  /** A signed amount shown big on the right: "+500". */
  amount?: { value: number; currency: Currency };
  /** Label for the tap action, shown on the right ("View", "Respond"). */
  cta?: string;
  /** Where a tap goes. */
  href?: Href;
  onPress?: () => void;
  /** Inline buttons rendered on the banner itself. */
  actions?: ToastAction[];
  /** Auto-dismiss after this long; the progress bar shows it running out. Default 5.5 s. */
  durationMs?: number;
}

export interface Toast extends Required<Pick<ToastInput, "id" | "kind" | "title" | "durationMs">>, Omit<ToastInput, "id" | "kind" | "title" | "durationMs"> {
  /** How many banners this one stands in for (grouped same-kind waiters). */
  groupCount?: number;
}

export interface BetLockedInput {
  /** Tutorial practice bet: stamped TEST LOCKED IN. */
  test?: boolean;
  teamName: string;
  /** Overrides the "<team> to win" line (e.g. parlays). */
  pickLabel?: string;
  teamAbbr: string;
  teamColor: string;
  odds: number;
  stake: number;
  payout: number;
  currency: Currency;
  walletLabel?: string;
  /** League wallet bets: offer "Post to league" after the stamp. */
  leagueId?: string;
  gameId?: string;
  /** Hide-until-kickoff picks are never offered for posting. */
  hidden?: boolean;
}

interface ToastContextType {
  /** Queue a banner. Returns the id, or null when dropped (duplicate, or the kind is muted). */
  show: (t: ToastInput) => string | null;
  dismiss: (id?: string) => void;
  /** The "Bet locked in" stamp + burst, over everything. */
  betLocked: (b: BetLockedInput) => void;
  /** Host state (ToastHost reads these). */
  current: Toast | null;
  queued: number;
  locked: (BetLockedInput & { key: number }) | null;
  clearLocked: () => void;
}

const Ctx = createContext<ToastContextType | null>(null);

const MAX_QUEUE = 6;
let seq = 0;

/** Never two notifications within this gap; one that lands inside it waits in the queue (warnings skip the wait). */
export const TOAST_MIN_GAP_MS = 5 * 60_000;

/** Plain-language noun per kind, for grouped banners ("3 friend updates"). */
const KIND_NOUN: Record<ToastKind, string> = {
  win: "payout",
  live: "live game",
  league: "league",
  social: "friend",
  loan: "bank",
  warning: "alert",
  info: "new",
};

/**
 * Floating banners for live events — one on screen at a time, the rest
 * queued oldest-first. Anything in the app can call `useToast().show(...)`;
 * ToastHost (mounted once, above the navigator) draws them.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  // True while the head of the queue is waiting out the minimum gap.
  const [gated, setGated] = useState(false);
  const [locked, setLocked] = useState<(BetLockedInput & { key: number }) | null>(null);
  const recent = useRef(new Map<string, number>());
  const lastShownAt = useRef(0);

  const show = useCallback((t: ToastInput) => {
    const kind = t.kind ?? "info";
    // Muted kinds never surface as banners (warnings always do — they report failures).
    if (kind !== "warning" && getMutedToastKinds().includes(kind)) return null;
    const id = t.id ?? `t${Date.now()}_${seq++}`;
    // The same event can be reported twice (a listener replay, a poll); show it once a minute at most.
    const last = recent.current.get(id);
    if (last && Date.now() - last < 60_000) return null;
    recent.current.set(id, Date.now());
    if (recent.current.size > 200) recent.current = new Map([...recent.current].slice(-100));
    const toast: Toast = { ...t, id, kind, durationMs: t.durationMs ?? 5500 };
    setQueue((q) => {
      if (q.some((x) => x.id === id)) return q;
      const next = [...q, toast];
      // Two or more of the same kind waiting behind the current banner collapse
      // into one "N <kind> updates" banner that opens the Activity feed.
      const waiting = next.slice(1);
      const same = waiting.filter((x) => x.kind === kind);
      if (same.length >= 2) {
        const count = same.reduce((n, x) => n + (x.groupCount ?? 1), 0);
        const group: Toast = {
          id: `group_${kind}_${seq++}`,
          kind,
          title: `${count} ${KIND_NOUN[kind]} updates`,
          body: "Tap to catch up in Activity.",
          cta: "See all",
          href: "/activity" as Href,
          durationMs: 5500,
          groupCount: count,
        };
        return [next[0]!, ...waiting.filter((x) => x.kind !== kind), group].slice(-MAX_QUEUE);
      }
      return next.slice(-MAX_QUEUE);
    });
    return id;
  }, []);

  // A banner landing inside the gap waits in the queue instead of being
  // dropped; warnings (sync failures, bet trouble) show straight away.
  const headId = queue[0]?.id;
  const headKind = queue[0]?.kind;
  useEffect(() => {
    if (!headId) return;
    const wait = headKind === "warning" ? 0 : lastShownAt.current + TOAST_MIN_GAP_MS - Date.now();
    if (wait <= 0) {
      lastShownAt.current = Date.now();
      setGated(false);
      return;
    }
    setGated(true);
    const timer = setTimeout(() => {
      lastShownAt.current = Date.now();
      setGated(false);
    }, wait);
    return () => clearTimeout(timer);
  }, [headId, headKind]);

  const dismiss = useCallback((id?: string) => {
    setQueue((q) => (id ? q.filter((x) => x.id !== id) : q.slice(1)));
  }, []);

  const betLocked = useCallback((b: BetLockedInput) => setLocked({ ...b, key: Date.now() }), []);
  const clearLocked = useCallback(() => setLocked(null), []);

  const value = useMemo<ToastContextType>(
    () => ({
      show,
      dismiss,
      betLocked,
      current: gated ? null : queue[0] ?? null,
      queued: Math.max(0, queue.length - (gated ? 0 : 1)),
      locked,
      clearLocked,
    }),
    [show, dismiss, betLocked, queue, gated, locked, clearLocked]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

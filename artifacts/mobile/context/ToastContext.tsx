import type { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Href } from "expo-router";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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
  /** Auto-dismiss after this long; the progress bar shows it running out. Default 5.5 s. */
  durationMs?: number;
}

export interface Toast extends Required<Pick<ToastInput, "id" | "kind" | "title" | "durationMs">>, Omit<ToastInput, "id" | "kind" | "title" | "durationMs"> {}

export interface BetLockedInput {
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  odds: number;
  stake: number;
  payout: number;
  currency: Currency;
  walletLabel?: string;
}

interface ToastContextType {
  /** Queue a banner. Returns its id. */
  show: (t: ToastInput) => string;
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

/**
 * Floating banners for live events — one on screen at a time, the rest
 * queued oldest-first. Anything in the app can call `useToast().show(...)`;
 * ToastHost (mounted once, above the navigator) draws them.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [locked, setLocked] = useState<(BetLockedInput & { key: number }) | null>(null);
  const recent = useRef(new Map<string, number>());

  const show = useCallback((t: ToastInput) => {
    const id = t.id ?? `t${Date.now()}_${seq++}`;
    // The same event can be reported twice (a listener replay, a poll); show it once a minute at most.
    const last = recent.current.get(id);
    if (last && Date.now() - last < 60_000) return id;
    recent.current.set(id, Date.now());
    if (recent.current.size > 200) recent.current = new Map([...recent.current].slice(-100));
    const toast: Toast = { ...t, id, kind: t.kind ?? "info", durationMs: t.durationMs ?? 5500 };
    setQueue((q) => (q.some((x) => x.id === id) ? q : [...q, toast].slice(-MAX_QUEUE)));
    return id;
  }, []);

  const dismiss = useCallback((id?: string) => {
    setQueue((q) => (id ? q.filter((x) => x.id !== id) : q.slice(1)));
  }, []);

  const betLocked = useCallback((b: BetLockedInput) => setLocked({ ...b, key: Date.now() }), []);
  const clearLocked = useCallback(() => setLocked(null), []);

  const value = useMemo<ToastContextType>(
    () => ({ show, dismiss, betLocked, current: queue[0] ?? null, queued: Math.max(0, queue.length - 1), locked, clearLocked }),
    [show, dismiss, betLocked, queue, locked, clearLocked]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

import { useEffect, useSyncExternalStore } from "react";

/**
 * One full-screen moment at a time. Results, level-ups, ladder promotions and
 * the walkthrough each ask for a turn; the first in line shows, the rest wait
 * and follow one by one. Toasts hold while any of them is up (a Modal would
 * cover them and they'd time out unseen).
 *
 * After a turn ends there's a short gap before the next starts: iOS can't
 * present a Modal while the previous one is still animating away.
 */
const GAP_MS = 450;

interface Ask {
  id: string;
  priority: number;
  at: number;
}

let waiting: Ask[] = [];
let active: string | null = null;
let cooling = false;
let coolingTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function advance() {
  if (active || cooling || !waiting.length) return;
  // Highest priority first, then whoever asked first.
  waiting.sort((a, b) => b.priority - a.priority || a.at - b.at);
  active = waiting.shift()!.id;
  emit();
}

function ask(id: string, priority: number) {
  if (active === id || waiting.some((w) => w.id === id)) return;
  waiting.push({ id, priority, at: Date.now() });
  advance();
  emit();
}

/**
 * Immediately claims the active overlay slot for a user-initiated modal
 * (such as opening a Prize Box / SpinWheel or Streak Wager popup) so background
 * watchers (XpGainPopup, LevelUpHost, etc.) queue behind it instead of
 * mounting a second iOS Modal while it is open or dismissing.
 */
function holdImmediate(id: string, priority: number) {
  waiting = waiting.filter((w) => w.id !== id);
  if (active === id) return;
  if (coolingTimer) {
    clearTimeout(coolingTimer);
    coolingTimer = null;
    cooling = false;
  }
  if (active && active !== id) {
    // Re-queue the interrupted background overlay so it resumes after this modal closes.
    if (!waiting.some((w) => w.id === active)) {
      waiting.push({ id: active, priority: 0, at: Date.now() });
    }
  }
  active = id;
  emit();
}

function release(id: string) {
  const before = waiting.length;
  waiting = waiting.filter((w) => w.id !== id);
  if (active === id) {
    active = null;
    cooling = true;
    emit();
    if (coolingTimer) clearTimeout(coolingTimer);
    coolingTimer = setTimeout(() => {
      coolingTimer = null;
      cooling = false;
      advance();
      emit();
    }, GAP_MS);
  } else if (waiting.length !== before) emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * True while it's `id`'s turn. Ask with `wants`; stop wanting (or unmount)
 * to hand the turn on. Higher `priority` goes first among those waiting; it
 * never interrupts the one on screen.
 */
export function useOverlayTurn(id: string, wants: boolean, priority = 0): boolean {
  useEffect(() => {
    if (!wants) return;
    ask(id, priority);
    return () => release(id);
  }, [id, wants, priority]);
  return useSyncExternalStore(subscribe, () => active === id, () => false);
}

/**
 * Holds the overlay lock for a directly opened modal (e.g. SpinWheel) and
 * enforces the GAP_MS cooldown when it closes so queued modals (XpGain, LevelUp)
 * never overlap with it on iOS.
 */
export function useHoldOverlay(id: string, open: boolean, priority = 40): void {
  useEffect(() => {
    if (!open) return;
    holdImmediate(id, priority);
    return () => release(id);
  }, [id, open, priority]);
}

/** True while any full-screen moment is up or about to be (toasts wait for it). */
export function useOverlayBusy(): boolean {
  return useSyncExternalStore(subscribe, () => active !== null || cooling, () => false);
}

/** Synchronous check for imperative callers (e.g. ad breakpoints) so fullscreen ads don't collide with modals. */
export function isOverlayBusy(): boolean {
  return active !== null || cooling || waiting.length > 0;
}

/** Priorities: what the player just earned first. */
export const OVERLAY = { prizeWheel: 40, streakWager: 35, results: 30, creditsEarned: 26, xpGain: 24, levelUp: 20, ladder: 10, walkthrough: 0 } as const;

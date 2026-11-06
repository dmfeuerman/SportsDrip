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

function release(id: string) {
  const before = waiting.length;
  waiting = waiting.filter((w) => w.id !== id);
  if (active === id) {
    active = null;
    cooling = true;
    emit();
    setTimeout(() => {
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

/** True while any full-screen moment is up or about to be (toasts wait for it). */
export function useOverlayBusy(): boolean {
  return useSyncExternalStore(subscribe, () => active !== null || cooling, () => false);
}

/** Priorities: what the player just earned first. */
export const OVERLAY = { results: 30, levelUp: 20, ladder: 10, walkthrough: 0 } as const;

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Interactive tutorials: a spotlight on one thing at a time, with a popup
 * that explains it. "Press" steps make the player tap the glowing control
 * themselves; the tour moves on when they do (or when what it was waiting
 * for — a screen, a purchase — has happened).
 */

export interface TourCtx {
  /** expo-router pathname: "/", "/games", "/shop", "/checkout"… */
  path: string;
  owned: Set<string>;
  cart: Set<string>;
}

export interface TourStep {
  /** A <TourTarget id> on screen, or "tab:index" | "tab:games" | "tab:leagues" | "tab:friends" | "tab:avatar". None: a centred popup. */
  target?: string;
  title: string;
  body: string;
  /** The player has to press the target to go on. It glows and says "Press this button". */
  press?: boolean;
  /** Screen the step lives on. Opened when the step starts (info steps). */
  route?: string;
  /** Moves on by itself once true (a press step also moves on when its target is pressed). */
  doneWhen?: (ctx: TourCtx) => boolean;
  /** Already satisfied when reached: skipped. */
  skipWhen?: (ctx: TourCtx) => boolean;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  icon: string;
  steps: TourStep[];
}

interface State {
  tour: Tour | null;
  step: number;
  menu: boolean;
}

let state: State = { tour: null, step: 0, menu: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  emit();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useTourState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function startTour(tour: Tour) {
  set({ tour, step: 0, menu: false });
}

export function nextTourStep() {
  if (!state.tour) return;
  if (state.step + 1 >= state.tour.steps.length) return endTour();
  set({ step: state.step + 1 });
}

export function prevTourStep() {
  if (!state.tour || state.step === 0) return;
  set({ step: state.step - 1 });
}

export function endTour() {
  const id = state.tour?.id;
  set({ tour: null, step: 0 });
  if (id) void markTourDone(id);
}

export function openTourMenu() {
  set({ menu: true });
}

export function closeTourMenu() {
  set({ menu: false });
}

/** A TourTarget was pressed. */
export function tourPressed(id: string) {
  const s = state.tour?.steps[state.step];
  if (s?.press && s.target === id) nextTourStep();
}

/* ── targets ─────────────────────────────────────────────────────────────── */

export interface TargetEntry {
  ref: React.RefObject<{ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null>;
  /** Scrolls the target's list by dy (positive: down the page). */
  scrollBy?: (dy: number) => void;
}

const targets = new Map<string, TargetEntry>();
export const registerTarget = (id: string, entry: TargetEntry) => {
  targets.set(id, entry);
  return () => {
    if (targets.get(id) === entry) targets.delete(id);
  };
};
export const getTarget = (id: string) => targets.get(id);

/* ── completion (per device) ─────────────────────────────────────────────── */

const DONE_KEY = "sportdrip.tours.done.v1";
let done: Set<string> | null = null;

async function loadDone(): Promise<Set<string>> {
  if (done) return done;
  try {
    const raw = await AsyncStorage.getItem(DONE_KEY);
    done = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    done = new Set();
  }
  return done;
}

async function markTourDone(id: string) {
  const d = await loadDone();
  d.add(id);
  try {
    await AsyncStorage.setItem(DONE_KEY, JSON.stringify([...d]));
  } catch {
    /* best effort */
  }
}

export async function tourDone(id: string): Promise<boolean> {
  return (await loadDone()).has(id);
}

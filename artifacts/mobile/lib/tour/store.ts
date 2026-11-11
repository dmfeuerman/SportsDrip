import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Keyboard } from "react-native";
import { useSyncExternalStore } from "react";
import { reportChallengeAction } from "@/lib/api";

/**
 * Interactive tutorials: a spotlight on one thing at a time, with a popup
 * that explains it. "Press" steps make the player tap the glowing control
 * themselves; the tour moves on when they do (or when what it was waiting
 * for — a screen, a purchase — has happened).
 */

export interface TourCtx {
  /** expo-router pathname: "/", "/games", "/shop", "/checkout"… */
  path: string;
  /** Bets placed with credits (open or settled). */
  betCount: number;
  owned: Set<string>;
  cart: Set<string>;
  /** Today's free daily bet has been placed. */
  freeBetToday: boolean;
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
  /** Moves on when the app reports this event (tourEvent), e.g. "slip:open", "bet:placed". */
  advanceOn?: string;
  /** A full-screen moment instead of a popup: the shivering character, the gift box. */
  scene?: "cold" | "prize" | "placed";
  /** Replaces "Press this button" on the glow label. */
  pressLabel?: string;
  /** Leave the screen undimmed (show a whole sheet) and put the popup at the top. */
  noDim?: boolean;
  /** Skip the step when its target isn't on screen (e.g. Pay with when not in a league). */
  optional?: boolean;
  /** Glow these targets instead of the whole spotlight (the tap-to-pick buttons). */
  glow?: string[];
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  icon: string;
  steps: TourStep[];
  /**
   * Sandbox: nothing is sent to the server. Bet slips and league creation
   * check `tourPractice()` and pretend instead.
   */
  practice?: boolean;
  /** For the first-bet tour: the stake the slip must be set to. */
  stake?: number;
  /** Not offered in the ? menu (first-run only). */
  hidden?: boolean;
}

interface State {
  tour: Tour | null;
  step: number;
  menu: boolean;
  /** Screen the tour was started from; ending it goes back there, scrolled to the top. */
  origin: string | null;
  /** Bumped when a tour ends (finished or ended early). */
  ended: { id: string; finished: boolean; n: number } | null;
  /** The step is satisfied but waits for the keyboard to close before moving on. */
  pending: boolean;
}

let state: State = { tour: null, step: 0, menu: false, origin: null, ended: null, pending: false };
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

export function startTour(tour: Tour, origin: string | null = null) {
  set({ tour, step: 0, menu: false, origin, pending: false });
}

export function nextTourStep() {
  if (!state.tour) return;
  if (state.step + 1 >= state.tour.steps.length) return endTour(true);
  set({ step: state.step + 1, pending: false });
}

export function prevTourStep() {
  if (!state.tour || state.step === 0) return;
  set({ step: state.step - 1, pending: false });
}

export function endTour(finished = false) {
  const id = state.tour?.id;
  const origin = state.origin;
  set({ tour: null, step: 0, origin: null, pending: false, ended: id ? { id, finished, n: (state.ended?.n ?? 0) + 1 } : state.ended });
  if (id) void markTourDone(id);
  if (id && finished) reportChallengeAction("tutorial");
  // Back to where the ? was pressed, at the top.
  if (origin) {
    try {
      router.navigate(origin as never);
    } catch {}
  }
  setTimeout(scrollAllToTop, 350);
}

/** The running tour is a sandbox: don't send anything to the server. */
export const tourPractice = () => !!state.tour?.practice;
/** Stake the first-bet tour asks for, if it's running. */
export const tourStake = () => (state.tour && !state.tour.practice ? state.tour.stake ?? null : null);

/** Something happened in the app that a step may be waiting for. */
export function tourEvent(name: string) {
  const s = state.tour?.steps[state.step];
  if (s?.advanceOn !== name) return;
  if (!Keyboard.isVisible?.()) return nextTourStep();
  // Typing satisfied the step: wait for the keyboard to close before moving on.
  if (state.pending) return;
  const at = { tour: state.tour, step: state.step };
  set({ pending: true });
  const sub = Keyboard.addListener("keyboardDidHide", () => {
    sub.remove();
    if (state.tour === at.tour && state.step === at.step && state.pending) nextTourStep();
  });
}

/* ── overlays inside modals ──────────────────────────────────────────────── */

let layers: number[] = [];
let layerSeq = 0;
/** A Modal that hosts its own copy of the overlay (a Modal covers everything drawn outside it). */
export function pushTourLayer(): number {
  const id = ++layerSeq;
  layers = [...layers, id];
  emit();
  return id;
}
export function popTourLayer(id: number) {
  layers = layers.filter((l) => l !== id);
  emit();
}
const topLayer = () => layers[layers.length - 1] ?? 0;
export function useTopTourLayer(): number {
  return useSyncExternalStore(subscribe, topLayer, topLayer);
}

/* ── scroll back to the top when a tour ends ─────────────────────────────── */

const toTop = new Set<() => void>();
export function registerScrollTop(fn: () => void) {
  toTop.add(fn);
  return () => {
    toTop.delete(fn);
  };
}
function scrollAllToTop() {
  toTop.forEach((f) => {
    try {
      f();
    } catch {}
  });
}

export function openTourMenu() {
  set({ menu: true });
}

export function closeTourMenu() {
  set({ menu: false });
}

/**
 * A TourTarget was pressed. Steps that wait for an outcome (advanceOn /
 * doneWhen — a stake typed, a bet placed) don't move on from the tap alone:
 * otherwise tapping the stake box skipped past typing 10, and tapping Place
 * bet skipped ahead even when the bet was refused, so nothing was staked.
 */
export function tourPressed(id: string) {
  const s = state.tour?.steps[state.step];
  if (s?.press && s.target === id && !s.advanceOn && !s.doneWhen) nextTourStep();
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

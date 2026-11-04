import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { OddsFormat } from "@/lib/odds";

/**
 * Small per-device preferences: odds format, the last stake used per wallet,
 * when each league's chat or DM thread was last read, onboarding walkthrough
 * state, and pending sign-up profile fields. Kept in AsyncStorage behind a
 * tiny store so every screen re-renders when one changes.
 */

export interface PendingSignupMeta {
  age?: number;
  birthDate?: string;
  phoneNumber?: string;
}

interface Settings {
  oddsFormat: OddsFormat;
  /** walletId ("credits" or a league id) -> last stake placed from it. */
  lastStake: Record<string, number>;
  /** leagueId or dmThreadId -> epoch ms the chat/feed was last opened. */
  chatSeen: Record<string, number>;
  /** Whether the user has completed the initial app feature walkthrough. */
  walkthroughSeen: boolean;
  /** Pending extended sign-up fields captured on the Sign-Up screen before onboarding. */
  pendingSignupMeta: PendingSignupMeta | null;
  /** Epoch ms the push pre-prompt was last shown (0 = never). */
  pushPrimerAt: number;
}

const KEY = "sportdrip.settings.v1";
const DEFAULTS: Settings = {
  oddsFormat: "decimal",
  lastStake: {},
  chatSeen: {},
  walkthroughSeen: false,
  pendingSignupMeta: null,
  pushPrimerAt: 0,
};

let state: Settings = DEFAULTS;
let walkthroughModalOpen = false;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function hydrate() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      state = {
        oddsFormat: parsed.oddsFormat === "american" ? "american" : "decimal",
        lastStake: parsed.lastStake && typeof parsed.lastStake === "object" ? parsed.lastStake : {},
        chatSeen: parsed.chatSeen && typeof parsed.chatSeen === "object" ? parsed.chatSeen : {},
        walkthroughSeen: Boolean(parsed.walkthroughSeen),
        pendingSignupMeta: parsed.pendingSignupMeta ?? null,
        pushPrimerAt: typeof parsed.pushPrimerAt === "number" ? parsed.pushPrimerAt : 0,
      };
      emit();
    })
    .catch(() => {});
}

function persist(next: Settings) {
  state = next;
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useOddsFormat(): OddsFormat {
  return useSyncExternalStore(
    subscribe,
    () => state.oddsFormat,
    () => DEFAULTS.oddsFormat
  );
}

export function setOddsFormat(oddsFormat: OddsFormat): void {
  hydrate();
  if (state.oddsFormat === oddsFormat) return;
  persist({ ...state, oddsFormat });
}

export function toggleOddsFormat(): OddsFormat {
  const next: OddsFormat = state.oddsFormat === "decimal" ? "american" : "decimal";
  setOddsFormat(next);
  return next;
}

const PRIMER_COOLDOWN_MS = 7 * 24 * 3600_000;
/** The push pre-prompt shows at most once a week (and never once iOS has an answer). */
export function pushPrimerDue(now = Date.now()): boolean {
  hydrate();
  return now - state.pushPrimerAt > PRIMER_COOLDOWN_MS;
}
export function markPushPrimerShown(now = Date.now()): void {
  hydrate();
  persist({ ...state, pushPrimerAt: now });
}

export function lastStakeFor(walletId: string): number | null {
  hydrate();
  const v = state.lastStake[walletId];
  return typeof v === "number" && Number.isFinite(v) && v >= 10 ? Math.floor(v) : null;
}

export function rememberStake(walletId: string, stake: number): void {
  hydrate();
  if (!(stake >= 10) || !Number.isFinite(stake)) return;
  const clean = Math.floor(stake);
  if (state.lastStake[walletId] === clean) return;
  persist({
    ...state,
    lastStake: { ...state.lastStake, [walletId]: clean },
  });
}

export function useChatSeen(chatId: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (chatId ? state.chatSeen[chatId] ?? 0 : 0),
    () => 0
  );
}

export function useAllChatSeen(): Record<string, number> {
  return useSyncExternalStore(
    subscribe,
    () => state.chatSeen,
    () => DEFAULTS.chatSeen
  );
}

export function markChatSeen(chatId: string, at = Date.now()): void {
  hydrate();
  if (!chatId) return;
  const prev = state.chatSeen[chatId] ?? 0;
  if (at <= prev) return;
  persist({
    ...state,
    chatSeen: { ...state.chatSeen, [chatId]: at },
  });
}

export function useWalkthroughState(): { seen: boolean; open: boolean; hydrated: boolean } {
  const seen = useSyncExternalStore(
    subscribe,
    () => state.walkthroughSeen,
    () => false
  );
  const open = useSyncExternalStore(
    subscribe,
    () => walkthroughModalOpen,
    () => false
  );
  return { seen, open, hydrated: loaded };
}

export function openWalkthrough(): void {
  hydrate();
  walkthroughModalOpen = true;
  emit();
}

export function closeWalkthrough(): void {
  hydrate();
  walkthroughModalOpen = false;
  if (!state.walkthroughSeen) {
    persist({ ...state, walkthroughSeen: true });
  } else {
    emit();
  }
}

export function markWalkthroughSeen(): void {
  hydrate();
  walkthroughModalOpen = false;
  if (!state.walkthroughSeen) {
    persist({ ...state, walkthroughSeen: true });
  } else {
    emit();
  }
}

export function setPendingSignupMeta(meta: PendingSignupMeta | null): void {
  hydrate();
  persist({ ...state, pendingSignupMeta: meta });
}

export function usePendingSignupMeta(): PendingSignupMeta | null {
  return useSyncExternalStore(
    subscribe,
    () => state.pendingSignupMeta,
    () => null
  );
}

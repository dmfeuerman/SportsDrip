import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { OddsFormat } from "@/lib/odds";
import { canPrompt, markPromptShown } from "@/lib/promptGate";

/**
 * Small per-device preferences: odds format, the last stake used per wallet,
 * when each league's chat or DM thread was last read, onboarding walkthrough
 * state, and pending sign-up profile fields. Kept in AsyncStorage behind a
 * tiny store so every screen re-renders when one changes.
 */

export interface PendingSignupMeta {
  age?: number;
  /** 1–12 */
  birthMonth?: number;
  phoneNumber?: string;
  /** Ticked "I agree to the Terms" on the sign-up form. */
  acceptedTerms?: boolean;
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
  /** Badge list key ("bets.settled", ...) -> ids already seen, so their red badge clears. */
  itemsSeen: Record<string, string[]>;
}

const KEY = "sportdrip.settings.v1";
const DEFAULTS: Settings = {
  oddsFormat: "decimal",
  lastStake: {},
  chatSeen: {},
  walkthroughSeen: false,
  pendingSignupMeta: null,
  pushPrimerAt: 0,
  itemsSeen: {},
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
      // Anything marked before the stored copy arrived is merged in, not lost.
      const storedSeen: Record<string, number> = parsed.chatSeen && typeof parsed.chatSeen === "object" ? parsed.chatSeen : {};
      const chatSeen = { ...storedSeen };
      for (const [k, v] of Object.entries(state.chatSeen)) chatSeen[k] = Math.max(v, chatSeen[k] ?? 0);
      const itemsSeen: Record<string, string[]> = parsed.itemsSeen && typeof parsed.itemsSeen === "object" ? { ...parsed.itemsSeen } : {};
      for (const [k, ids] of Object.entries(state.itemsSeen)) itemsSeen[k] = Array.from(new Set([...(itemsSeen[k] ?? []), ...ids])).slice(-MAX_SEEN);
      state = {
        oddsFormat: parsed.oddsFormat === "american" ? "american" : "decimal",
        lastStake: parsed.lastStake && typeof parsed.lastStake === "object" ? parsed.lastStake : {},
        chatSeen,
        itemsSeen,
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
  // One system prompt per session, none after a decline (lib/promptGate).
  return now - state.pushPrimerAt > PRIMER_COOLDOWN_MS && canPrompt("push");
}
export function markPushPrimerShown(now = Date.now()): void {
  hydrate();
  markPromptShown("push");
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

const MAX_SEEN = 600;
const NO_IDS: string[] = [];

/** Records these ids as seen under `key` (a badge's list). */
export function markItemsSeen(key: string, ids: string[]): void {
  hydrate();
  const prev = state.itemsSeen[key] ?? NO_IDS;
  const have = new Set(prev);
  const fresh = ids.filter((id) => !have.has(id));
  if (!fresh.length) return;
  persist({ ...state, itemsSeen: { ...state.itemsSeen, [key]: [...prev, ...fresh].slice(-MAX_SEEN) } });
}

/**
 * Red-badge count for a list: items not yet seen. While `viewing` is true the
 * current items are marked seen, so the badge clears once you've looked.
 */
export function useUnseenCount(key: string, ids: string[], viewing: boolean): number {
  const seen = useSyncExternalStore(
    subscribe,
    () => state.itemsSeen[key] ?? NO_IDS,
    () => NO_IDS
  );
  const idsKey = ids.join("|");
  useEffect(() => {
    if (viewing && ids.length) markItemsSeen(key, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, key, idsKey]);
  return useMemo(() => {
    const s = new Set(seen);
    return ids.filter((id) => !s.has(id)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, idsKey]);
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

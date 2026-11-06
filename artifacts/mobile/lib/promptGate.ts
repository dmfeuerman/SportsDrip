import AsyncStorage from "@react-native-async-storage/async-storage";
import { trackEvent } from "@/lib/analytics";

/**
 * Prompt hygiene: at most one system-level prompt (push, ATT or review) per app
 * session, ATT no earlier than session 2, and never again after a decline.
 * A session is one cold launch. State is per device; reads before hydration
 * finish answer "no" (the conservative choice).
 */

export type PromptKind = "push" | "att" | "review";

interface GateState {
  sessionCount: number;
  declined: Partial<Record<PromptKind, number>>;
}

const KEY = "sportdrip.promptGate.v1";
let state: GateState = { sessionCount: 0, declined: {} };
let shownThisSession: PromptKind | null = null;
let readyPromise: Promise<void> | null = null;

/** Hydrates and counts this launch as a session. Idempotent per launch. */
export function promptGateReady(): Promise<void> {
  readyPromise ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<GateState>;
        state = {
          sessionCount: typeof p.sessionCount === "number" ? p.sessionCount : 0,
          declined: p.declined && typeof p.declined === "object" ? p.declined : {},
        };
      }
    } catch {}
    state = { ...state, sessionCount: state.sessionCount + 1 };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  })();
  return readyPromise;
}

let hydrated = false;
void promptGateReady().then(() => {
  hydrated = true;
});

export function sessionCount(): number {
  return state.sessionCount;
}

export function canPrompt(kind: PromptKind): boolean {
  if (!hydrated || shownThisSession) return false;
  if (state.declined[kind]) return false;
  if (kind === "att" && state.sessionCount < 2) return false;
  return true;
}

export function markPromptShown(kind: PromptKind): void {
  shownThisSession = kind;
  trackEvent("prompt_shown", { prompt: kind });
}

export function markPromptResult(kind: PromptKind, accepted: boolean): void {
  trackEvent(accepted ? "prompt_accepted" : "prompt_declined", { prompt: kind });
  if (accepted) return;
  state = { ...state, declined: { ...state.declined, [kind]: Date.now() } };
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

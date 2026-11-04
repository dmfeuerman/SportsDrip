import AsyncStorage from "@react-native-async-storage/async-storage";
import { trackEvent } from "@/lib/analytics";

/**
 * League invite links: sportdrip://join/{CODE}.
 *
 * A link opened by someone who isn't signed in (or hasn't finished signup)
 * can't join yet, so the code is parked in AsyncStorage and picked up at the
 * end of onboarding (new account) or as soon as the shell is ready (existing
 * account that just signed in). A parked code expires after a week so a stale
 * link doesn't hijack a later session.
 */

export const APP_SCHEME = "sportdrip";
const KEY = "sportdrip.pendingInvite.v1";
const TTL_MS = 7 * 24 * 3_600_000;

/** No 0/O/1/I in codes (functions/src/lib/leagueConfig.ts); accept 4–8 of the rest. */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length >= 4 && clean.length <= 8 ? clean : null;
}

export function inviteLink(code: string): string {
  return `${APP_SCHEME}://join/${encodeURIComponent(code)}`;
}

/** Share-sheet copy for a league invite. The link opens the app; the code is the fallback. */
export function inviteMessage(league: { name: string; code: string; buyIn: number }): string {
  const cost = league.buyIn > 0 ? ` Buy-in is ${league.buyIn.toLocaleString()} credits.` : " It's free to join.";
  return `Join my "${league.name}" league on SportDrip.${cost}\n\n${inviteLink(league.code)}\n\nOr enter code ${league.code} in Leagues → Join.`;
}

interface Pending {
  code: string;
  at: number;
}

let taking: Promise<string | null> | null = null;

export async function savePendingInvite(rawCode: unknown, context: { signedIn: boolean }): Promise<string | null> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  try {
    const existing = await peekPendingInvite();
    if (existing === code) return code;
    await AsyncStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() } satisfies Pending));
    trackEvent("invite_code_captured", { code, signed_in: context.signedIn, deferred: true });
  } catch {
    // Storage unavailable: the user can still type the code.
  }
  return code;
}

export async function peekPendingInvite(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pending>;
    const code = normalizeInviteCode(p.code);
    if (!code || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

/**
 * Reads and clears the parked code. Concurrent callers share one read, so the
 * onboarding screen and the shell can never both act on the same invite.
 */
export function takePendingInvite(): Promise<string | null> {
  if (!taking) {
    taking = (async () => {
      const code = await peekPendingInvite();
      if (code) await AsyncStorage.removeItem(KEY).catch(() => {});
      return code;
    })().finally(() => {
      taking = null;
    });
  }
  return taking;
}

export async function clearPendingInvite(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

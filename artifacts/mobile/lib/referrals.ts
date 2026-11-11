import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_SCHEME } from "@/lib/invites";
import { REFERRAL } from "@/constants/progression";

/**
 * Friend invite codes: sportdrip://ref/{CODE}.
 *
 * Opened before signup, the code is parked here and pre-filled on the
 * onboarding form; createProfile pays both players (functions/src/callable/profile.ts).
 */

const KEY = "sportdrip.pendingReferral.v1";
const TTL_MS = 14 * 24 * 3_600_000;

export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length >= 4 && clean.length <= 10 ? clean : null;
}

export function referralLink(code: string): string {
  return `${APP_SCHEME}://ref/${encodeURIComponent(code)}`;
}

export function referralMessage(code: string, name?: string | null): string {
  return (
    `${name ? `${name} invited you to` : "Join me on"} On The House — friendly sports picks with friends, no real money.\n\n` +
    `Sign up with my invite code ${code} and you start with ${REFERRAL.newUserCredits.toLocaleString()} bonus credits.\n\n${referralLink(code)}`
  );
}

export async function savePendingReferral(raw: unknown): Promise<string | null> {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // The code can still be typed in.
  }
  return code;
}

export async function peekPendingReferral(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = normalizeReferralCode(p.code);
    if (!code || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

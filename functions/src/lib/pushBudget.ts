import type { NotificationType } from "./notifyModel";

/**
 * Push budget and quiet hours. Pure (no Firestore) so it can be unit tested.
 *
 * Transactional pushes (results, money, challenges, loans, friend requests)
 * always go out. Engagement pushes respect a per-user daily cap, quiet hours in
 * the user's timezone, and never reach someone on a break or at their daily
 * pick limit. Bet prompts ("come back and bet") are also held after a recent loss.
 * The in-app notification is always written; only the phone push is skipped.
 */

export type PushClass = "transactional" | "engagement";

const ENGAGEMENT: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "sweat_alert",
  "clutch_alert",
  "lock_reminder",
  "team_reminder",
  "reaction",
  "achievement",
  "level_up",
  "bet_tailed",
  "bet_faded",
  "league_report",
  "win_back",
]);

/** Types whose copy invites a new pick. Never sent after a recent loss. */
export const BET_PROMPT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(["lock_reminder", "team_reminder"]);
export const LOSS_TYPES: NotificationType[] = ["bet_lost", "challenge_lost"];
export const RECENT_LOSS_MS = 12 * 3600_000;

export const DEFAULT_DAILY_CAP = 4;
export const DEFAULT_QUIET_START = 23;
export const DEFAULT_QUIET_END = 8;
export const DEFAULT_TZ = "America/New_York";

export function classifyPush(type: NotificationType): PushClass {
  return ENGAGEMENT.has(type) ? "engagement" : "transactional";
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(now: number, tz: string): { day: string; hour: number } {
  const zone = isValidTz(tz) ? tz : DEFAULT_TZ;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** The user's local calendar day — the budget counter's doc id. */
export function localDay(now: number, tz: string | undefined): string {
  return parts(now, tz ?? DEFAULT_TZ).day;
}

export function inQuietHours(now: number, tz: string | undefined, start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  const { hour } = parts(now, tz ?? DEFAULT_TZ);
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export interface PushGateInput {
  type: NotificationType;
  now: number;
  tz?: string;
  /** Quiet hours are on unless the user turned them off. */
  quietHours?: boolean;
  cap?: number;
  sentToday: number;
  breakUntil?: number | null;
  /** At their self-set daily pick limit. */
  atDailyLimit: boolean;
  /** A loss notification in the last RECENT_LOSS_MS. */
  recentLoss: boolean;
}

export type PushDecision =
  | { send: true; counts: boolean }
  | { send: false; reason: "on_break" | "daily_limit" | "recent_loss" | "quiet_hours" | "budget" };

export function decidePush(i: PushGateInput): PushDecision {
  if (classifyPush(i.type) === "transactional") return { send: true, counts: false };
  if (i.breakUntil && i.breakUntil > i.now) return { send: false, reason: "on_break" };
  if (i.atDailyLimit) return { send: false, reason: "daily_limit" };
  if (BET_PROMPT_TYPES.has(i.type) && i.recentLoss) return { send: false, reason: "recent_loss" };
  if (i.quietHours !== false && inQuietHours(i.now, i.tz)) return { send: false, reason: "quiet_hours" };
  if (i.sentToday >= (i.cap ?? DEFAULT_DAILY_CAP)) return { send: false, reason: "budget" };
  return { send: true, counts: true };
}

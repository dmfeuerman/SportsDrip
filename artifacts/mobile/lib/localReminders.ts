import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * On-device reminders, written in the player's avatar's voice. These are
 * scheduled locally, so they need no APNs key and no server: kickoff of a
 * game you have a pick on, a streak that is about to lapse, and tomorrow's
 * free bet. Nothing is scheduled inside quiet hours (23:00 to 08:00 local),
 * at most MAX_KICKOFFS kickoff reminders are queued, and none of the copy
 * asks for a bet after a loss.
 */
const PREFIX = "local_";
const MAX_KICKOFFS = 4;
const QUIET_FROM = 23;
const QUIET_TO = 8;

export interface ReminderInput {
  now: number;
  name: string;
  /** Open picks with a known kickoff. */
  openBets: Array<{ gameId: string; teamAbbr: string; startsAt?: number | null }>;
  streak: number;
  /** A pick, free bet or daily pick already made today. */
  pickedToday: boolean;
  freeBetToday: boolean;
}

export interface Reminder {
  id: string;
  at: number;
  title: string;
  body: string;
  /** `url` is what the notification tap handler routes on (lib/push routeFromResponse). */
  data: { url: string };
}

const inQuietHours = (ms: number) => {
  const h = new Date(ms).getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
};

/** Local wall-clock time on the day of `from` (+days), as epoch ms. */
function localAt(from: number, days: number, hour: number): number {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** Pure: which reminders should exist right now. Exported for tests. */
export function planReminders(i: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  const seen = new Set<string>();
  const kick = i.openBets
    .filter((b) => b.startsAt && b.startsAt - i.now > 10 * 60_000 && b.startsAt - i.now < 36 * 3600_000)
    .sort((a, b) => a.startsAt! - b.startsAt!);
  for (const b of kick) {
    if (seen.has(b.gameId) || seen.size >= MAX_KICKOFFS) continue;
    const at = b.startsAt! - 5 * 60_000;
    if (inQuietHours(at)) continue;
    seen.add(b.gameId);
    out.push({
      id: `${PREFIX}kick_${b.gameId}`,
      at,
      title: `${b.teamAbbr} kicks off in 5`,
      body: `It's your avatar. We've got ${b.teamAbbr} riding. Come watch it with me.`,
      data: { url: `/game/${b.gameId}` },
    });
  }

  // Streak: one nudge at 7pm if today's pick isn't in yet.
  const streakAt = localAt(i.now, 0, 19);
  if (i.streak > 0 && !i.pickedToday && streakAt > i.now) {
    out.push({
      id: `${PREFIX}streak`,
      at: streakAt,
      title: `Day ${i.streak + 1} is still open`,
      body: `${i.name}, our ${i.streak}-day streak ends at midnight. One pick keeps it going.`,
      data: { url: "/" },
    });
  }

  // Free bet: today at 11am if it's unused and still ahead of us, else tomorrow.
  const todayAt = localAt(i.now, 0, 11);
  const freeAt = !i.freeBetToday && todayAt > i.now ? todayAt : localAt(i.now, 1, 11);
  out.push({
    id: `${PREFIX}freebet`,
    at: freeAt,
    title: "Your free bet is ready",
    body: "100 credits on the house, same as every day. I'm at the board when you are.",
    data: { url: "/" },
  });
  return out;
}

let lastKey = "";

/** Replaces every local reminder with the current plan. No-op when nothing changed or alerts aren't allowed. */
export async function syncReminders(plan: Reminder[]): Promise<void> {
  if (Platform.OS !== "ios") return;
  const key = plan.map((r) => `${r.id}@${r.at}`).join("|");
  if (key === lastKey) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    const provisional = perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!perm.granted && !provisional) return;
    lastKey = key;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      existing.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    for (const r of plan) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: { title: r.title, body: r.body, data: r.data, sound: false },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at) },
      });
    }
  } catch {
    // Best effort: a failed schedule never surfaces to the player.
    lastKey = "";
  }
}

/** Sign-out: nothing queued for the next person on this phone. */
export async function clearReminders(): Promise<void> {
  lastKey = "";
  if (Platform.OS !== "ios") return;
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      existing.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {}
}

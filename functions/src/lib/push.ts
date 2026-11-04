import { logger } from "firebase-functions";
import { notificationRoute, type NotificationModel } from "./notifyModel";

/**
 * Expo push delivery (APNs behind it). Pure builders plus one HTTP call; no
 * Firestore here, and nothing in this file is ever awaited inside a money
 * transaction — the trigger in triggers/push.ts runs after the commit.
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const CHUNK = 100;
export const MAX_TOKENS_PER_USER = 10;

const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
export const isExpoPushToken = (t: unknown): t is string => typeof t === "string" && t.length <= 256 && TOKEN_RE.test(t);

export interface StoredPushToken {
  token: string;
  platform: "ios";
  updatedAt: number;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  badge?: number;
  data: Record<string, string>;
}

/** One message per device for a notification document. */
export function buildPushMessages(
  n: Pick<NotificationModel, "id" | "type" | "title" | "body" | "leagueId" | "wallet" | "data">,
  tokens: string[],
  badge: number | null
): ExpoPushMessage[] {
  const data: Record<string, string> = {
    notificationId: n.id,
    type: n.type,
    url: notificationRoute(n),
  };
  if (n.leagueId) data.leagueId = n.leagueId;
  return tokens.filter(isExpoPushToken).map((to) => ({
    to,
    title: n.title.slice(0, 120),
    body: n.body.slice(0, 400),
    sound: "default",
    priority: "high",
    ...(badge !== null && badge >= 0 ? { badge } : {}),
    data,
  }));
}

/** Keeps the newest MAX_TOKENS_PER_USER, one entry per token. */
export function mergeToken(existing: StoredPushToken[], token: string, now: number): StoredPushToken[] {
  const rest = existing.filter((t) => t && t.token !== token);
  return [{ token, platform: "ios" as const, updatedAt: now }, ...rest]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TOKENS_PER_USER);
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends and returns the tokens Expo says are dead (app uninstalled, token
 * rotated), so the caller can prune them. Network failures are logged and
 * swallowed: a missed push is never worth failing the trigger over.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<{ sent: number; deadTokens: string[] }> {
  const deadTokens: string[] = [];
  let sent = 0;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  // Required only if "Enhanced push security" is on for the Expo project.
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn("expo push rejected", { status: res.status, body: (await res.text()).slice(0, 500) });
        continue;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      (json.data ?? []).forEach((ticket, j) => {
        if (ticket.status === "ok") sent++;
        else if (ticket.details?.error === "DeviceNotRegistered") deadTokens.push(chunk[j]!.to);
        else logger.warn("expo push ticket error", { error: ticket.details?.error, message: ticket.message });
      });
    } catch (err) {
      logger.warn("expo push failed", { error: String(err) });
    }
  }
  return { sent, deadTokens };
}

/**
 * Game insights built on the phone.
 *
 * The event summary is a public, keyless feed, so the device fetches it and
 * runs the same parser the server uses (espnSummary.ts is a copy of
 * functions/src/lib/gameInsights.ts, kept identical by a functions test).
 * That replaces a Cloud Function call, two Firestore reads and a write for
 * every stats view, and every 30 s while a live game is open.
 *
 * The getGameInsights callable stays deployed as the fallback: if the feed
 * can't be reached from the device (offline proxy, web CORS, a shape the
 * parser rejects) the hook asks the server exactly as before.
 */
import { normalizeSummary } from "./espnSummary";
import { ESPN_BASE, providerPathsFor } from "./provider";
import type { Sport } from "@/types/game";
import type { GameInsights } from "@/types/insights";

const GAME_ID = /^(NFL|NBA|MLB|NHL|NCAAF|NCAAB|Soccer):([0-9A-Za-z_-]{1,24})$/;
const TIMEOUT_MS = 8_000;

/** Which league path answered for a game, so soccer only searches once. */
const knownPath = new Map<string, string>();

/** Lets a screen that already holds the game doc skip the search. */
export function hintProviderPath(gameId: string, path: string | null | undefined) {
  if (path && !knownPath.has(gameId)) knownPath.set(gameId, path);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchSummary(path: string, eventId: string): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/summary?event=${encodeURIComponent(eventId)}`, { signal: ctl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    return Array.isArray(json?.header?.competitions) && json.header.competitions.length ? json : null;
  } finally {
    clearTimeout(timer);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Throws when the feed has nothing usable; the caller falls back to the server. */
export async function fetchInsightsOnDevice(gameId: string): Promise<GameInsights> {
  const m = GAME_ID.exec(gameId);
  if (!m) throw new Error("Unknown game.");
  const sport = m[1] as Sport;
  const eventId = m[2]!;
  const hint = knownPath.get(gameId);
  const paths = [...new Set([hint, ...providerPathsFor(sport)].filter((p): p is string => !!p))];
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const json = await fetchSummary(path, eventId);
      if (!json) continue;
      knownPath.set(gameId, path);
      return normalizeSummary(json, { gameId, sport, now: Date.now() }) as unknown as GameInsights;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("Stats for this game aren't available right now.");
}

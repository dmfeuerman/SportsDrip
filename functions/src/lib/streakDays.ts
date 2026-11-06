import { db } from "./economy";
import { nyDay } from "./streak";

/**
 * Recent days with no featured game (dailyPick/{day}.empty). Read outside the
 * caller's transaction (these docs are effectively immutable) and cached per
 * instance, so a streak never breaks across a no-game day.
 */
const LOOKBACK_DAYS = 8;
const TTL_MS = 10 * 60_000;
let cache: { at: number; day: string; set: Set<string> } | null = null;

export async function recentEmptyDays(now = Date.now()): Promise<Set<string>> {
  const today = nyDay(now);
  if (cache && cache.day === today && now - cache.at < TTL_MS) return cache.set;
  const refs = Array.from({ length: LOOKBACK_DAYS }, (_, i) => db.collection("dailyPick").doc(nyDay(now - (i + 1) * 86_400_000)));
  const set = new Set<string>();
  try {
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists && s.get("empty") === true) set.add(s.id);
  } catch {
    return set;
  }
  cache = { at: now, day: today, set };
  return set;
}

/** Test hook. */
export function resetEmptyDaysCache(): void {
  cache = null;
}

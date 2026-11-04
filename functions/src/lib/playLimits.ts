import { HttpsError } from "firebase-functions/v2/https";
import { nyDay } from "./streak";

/**
 * Optional, player-set limits (users/{uid}.limits). Limit-setters stay active
 * longer, so these are offered, never imposed:
 *   dailyPicks  max picks per America/New_York day (null = no limit)
 *   breakUntil  epoch ms; no picks until then ("take a break")
 * Placement counts live in users/{uid}.picksToday = { day, count }.
 */
export function checkPlayLimits(user: FirebaseFirestore.DocumentSnapshot, now: number): Record<string, unknown> {
  const breakUntil = user.get("limits.breakUntil") as number | undefined;
  if (breakUntil && breakUntil > now) {
    throw new HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");
  }
  const day = nyDay(now);
  const prev = user.get("picksToday") as { day?: string; count?: number } | undefined;
  const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
  const cap = user.get("limits.dailyPicks") as number | null | undefined;
  if (typeof cap === "number" && cap > 0 && count >= cap) {
    throw new HttpsError("failed-precondition", `You've hit your daily limit of ${cap} picks. It resets at midnight ET.`);
  }
  return { picksToday: { day, count: count + 1 } };
}

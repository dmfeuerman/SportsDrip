import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { fetchSummary, normalizeSummary, ttlFor, type GameInsights } from "../lib/gameInsights";
import { providerPathsFor, type GameStatus, type Sport } from "../lib/sportsProvider";

/**
 * Deep stats for one game: what the live bet view and the pre-bet sheets read.
 *
 * Same model as the board. The device never talks to the provider; this
 * callable does, behind gameInsights/{gameId} (server-only — the rules have no
 * match for it, so clients can't read or write it). However many people have
 * a live game open, the provider sees at most one summary request per TTL,
 * because a short lease means one caller refreshes while the rest are served
 * the copy they would have got a moment earlier anyway.
 */

const GameId = z.string().regex(/^(NFL|NBA|MLB|NHL|NCAAF|NCAAB|Soccer):[0-9A-Za-z_-]{1,24}$/);
const LEASE_MS = 12_000;

export const getGameInsights = onCall({ region: "us-central1", timeoutSeconds: 30 }, async (req) => {
  requireAuth(req.auth);
  const parsed = z.object({ gameId: GameId }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Unknown game.");
  const { gameId } = parsed.data;
  const sep = gameId.indexOf(":");
  const sport = gameId.slice(0, sep) as Sport;
  const eventId = gameId.slice(sep + 1);

  const cacheRef = db.collection("gameInsights").doc(gameId);
  const [cacheSnap, gameSnap] = await Promise.all([cacheRef.get(), db.collection("games").doc(gameId).get()]);
  const cached = cacheSnap.exists ? (cacheSnap.get("data") as GameInsights | undefined) : undefined;
  const status: GameStatus = (gameSnap.get("status") as GameStatus | undefined) ?? cached?.status ?? "upcoming";
  const startsAt = (gameSnap.get("startsAt") as number | undefined) ?? null;
  const now = Date.now();

  if (cached && now - cached.fetchedAt < ttlFor(status, startsAt, now)) return { insights: cached };

  // One refresher at a time. Losers get the stale copy if there is one; with
  // no copy at all, everyone fetches — that only happens once per game.
  const leader = await db.runTransaction(async (tx) => {
    const s = await tx.get(cacheRef);
    if (((s.get("leaseUntil") as number | undefined) ?? 0) > now) return false;
    tx.set(cacheRef, { leaseUntil: now + LEASE_MS }, { merge: true });
    return true;
  });
  if (!leader && cached) return { insights: cached };

  const known = (cacheSnap.get("providerPath") as string | undefined) ?? (gameSnap.get("providerPath") as string | undefined);
  const paths = [...new Set([known, ...providerPathsFor(sport)].filter((p): p is string => typeof p === "string"))];

  let json: unknown = null;
  let path: string | null = null;
  for (const p of paths) {
    try {
      json = await fetchSummary(p, eventId);
    } catch (err) {
      logger.warn("summary fetch failed", { gameId, path: p, err: String(err) });
    }
    if (json) {
      path = p;
      break;
    }
  }

  if (!json || !path) {
    if (leader) await cacheRef.set({ leaseUntil: 0 }, { merge: true });
    if (cached) return { insights: cached };
    throw new HttpsError("unavailable", "Stats for this game aren't available right now.");
  }

  const insights = normalizeSummary(json, { gameId, sport, now });
  await cacheRef.set({ data: insights, providerPath: path, leaseUntil: 0, updatedAt: now });
  return { insights };
});

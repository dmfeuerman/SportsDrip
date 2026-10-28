"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGameInsights = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const gameInsights_1 = require("../lib/gameInsights");
const sportsProvider_1 = require("../lib/sportsProvider");
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
const GameId = zod_1.z.string().regex(/^(NFL|NBA|MLB|NHL|NCAAF|NCAAB|Soccer):[0-9A-Za-z_-]{1,24}$/);
const LEASE_MS = 12_000;
exports.getGameInsights = (0, https_1.onCall)({ region: "us-central1", timeoutSeconds: 30 }, async (req) => {
    (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z.object({ gameId: GameId }).safeParse(req.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", "Unknown game.");
    const { gameId } = parsed.data;
    const sep = gameId.indexOf(":");
    const sport = gameId.slice(0, sep);
    const eventId = gameId.slice(sep + 1);
    const cacheRef = economy_1.db.collection("gameInsights").doc(gameId);
    const [cacheSnap, gameSnap] = await Promise.all([cacheRef.get(), economy_1.db.collection("games").doc(gameId).get()]);
    const cached = cacheSnap.exists ? cacheSnap.get("data") : undefined;
    const status = gameSnap.get("status") ?? cached?.status ?? "upcoming";
    const startsAt = gameSnap.get("startsAt") ?? null;
    const now = Date.now();
    if (cached && now - cached.fetchedAt < (0, gameInsights_1.ttlFor)(status, startsAt, now))
        return { insights: cached };
    // One refresher at a time. Losers get the stale copy if there is one; with
    // no copy at all, everyone fetches — that only happens once per game.
    const leader = await economy_1.db.runTransaction(async (tx) => {
        const s = await tx.get(cacheRef);
        if ((s.get("leaseUntil") ?? 0) > now)
            return false;
        tx.set(cacheRef, { leaseUntil: now + LEASE_MS }, { merge: true });
        return true;
    });
    if (!leader && cached)
        return { insights: cached };
    const known = cacheSnap.get("providerPath") ?? gameSnap.get("providerPath");
    const paths = [...new Set([known, ...(0, sportsProvider_1.providerPathsFor)(sport)].filter((p) => typeof p === "string"))];
    let json = null;
    let path = null;
    for (const p of paths) {
        try {
            json = await (0, gameInsights_1.fetchSummary)(p, eventId);
        }
        catch (err) {
            firebase_functions_1.logger.warn("summary fetch failed", { gameId, path: p, err: String(err) });
        }
        if (json) {
            path = p;
            break;
        }
    }
    if (!json || !path) {
        if (leader)
            await cacheRef.set({ leaseUntil: 0 }, { merge: true });
        if (cached)
            return { insights: cached };
        throw new https_1.HttpsError("unavailable", "Stats for this game aren't available right now.");
    }
    const insights = (0, gameInsights_1.normalizeSummary)(json, { gameId, sport, now });
    await cacheRef.set({ data: insights, providerPath: path, leaseUntil: 0, updatedAt: now });
    return { insights };
});
//# sourceMappingURL=insights.js.map
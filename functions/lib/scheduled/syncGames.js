"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneGames = exports.syncGames = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const sportsProvider_1 = require("../lib/sportsProvider");
/**
 * Pulls the scoreboard for every configured sport and writes it to games/{id}.
 *
 * Replaces the per-device 30-second poll (A1). Previously: 5 sports × 2 req/min
 * × every user. Now: 5 requests every 2 minutes, total, forever. Clients read
 * games/* from Firestore, which is cached and realtime.
 *
 * Retention: finished games are kept for 48h so late settles and bet history
 * still resolve, then swept.
 */
exports.syncGames = (0, scheduler_1.onSchedule)({ schedule: "*/2 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 }, async () => {
    const { games, failures } = await (0, sportsProvider_1.fetchGames)();
    if (failures.length)
        firebase_functions_1.logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
        firebase_functions_1.logger.error("sportsProvider returned nothing — leaving previous cache in place");
        return;
    }
    // Chunked so we stay under the 500-write batch limit.
    for (let i = 0; i < games.length; i += 400) {
        const batch = economy_1.db.batch();
        for (const g of games.slice(i, i + 400)) {
            batch.set(economy_1.db.collection("games").doc(g.id), { ...g, expired: false }, { merge: true });
        }
        await batch.commit();
    }
    const expired = await expireMissing(new Set(games.map((g) => g.id)));
    await economy_1.db.collection("meta").doc("sportsSync").set({
        lastRunAt: economy_1.FieldValue.serverTimestamp(),
        gameCount: games.length,
        expired,
        failures,
    }, { merge: true });
    firebase_functions_1.logger.info("syncGames complete", { count: games.length });
});
/**
 * Games still marked upcoming or live well after they started, that the
 * provider no longer reports (postponed, cancelled, or missed while the sync
 * wasn't running). They are flagged, not finalised: a final status would
 * settle bets with no score. Pending bets on them are refunded by
 * refundStaleBets after 72h. The app hides flagged games.
 */
async function expireMissing(seen) {
    const cutoff = Date.now() - 6 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "in", ["upcoming", "live"])
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    const batch = economy_1.db.batch();
    let n = 0;
    for (const d of stale.docs) {
        if (seen.has(d.id) || d.get("expired") === true)
            continue;
        batch.set(d.ref, { expired: true, expiredAt: Date.now() }, { merge: true });
        n++;
    }
    if (n)
        await batch.commit();
    if (n)
        firebase_functions_1.logger.info("expired stale games", { count: n });
    return n;
}
/** Sweeps games that finished more than 48h ago. */
exports.pruneGames = (0, scheduler_1.onSchedule)({ schedule: "0 5 * * *", region: "us-central1", timeoutSeconds: 300 }, async () => {
    const cutoff = Date.now() - 48 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "==", "final")
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    if (stale.empty)
        return;
    // A final game with unsettled bets is evidence settlement is broken.
    // Deleting it makes refundStaleBets turn a win into a refund at 06:30 and
    // hides the underlying failure.
    const batch = economy_1.db.batch();
    let deleted = 0;
    for (const d of stale.docs) {
        const pending = await economy_1.db
            .collection("bets")
            .where("gameId", "==", d.id)
            .where("status", "==", "pending")
            .limit(1)
            .get();
        if (!pending.empty) {
            firebase_functions_1.logger.warn("skipping prune, bets still pending", { gameId: d.id });
            continue;
        }
        batch.delete(d.ref);
        batch.delete(economy_1.db.collection("gameInsights").doc(d.id));
        deleted++;
    }
    if (deleted === 0)
        return;
    await batch.commit();
    firebase_functions_1.logger.info("pruneGames", { deleted });
});
//# sourceMappingURL=syncGames.js.map
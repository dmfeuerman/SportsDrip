import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../lib/economy";
import { fetchGames } from "../lib/sportsProvider";

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
export const syncGames = onSchedule(
  { schedule: "*/2 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 },
  async () => {
    const { games, failures } = await fetchGames();

    if (failures.length) logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
      logger.error("sportsProvider returned nothing — leaving previous cache in place");
      return;
    }

    // Chunked so we stay under the 500-write batch limit.
    for (let i = 0; i < games.length; i += 400) {
      const batch = db.batch();
      for (const g of games.slice(i, i + 400)) {
        batch.set(db.collection("games").doc(g.id), g, { merge: true });
      }
      await batch.commit();
    }

    await db.collection("meta").doc("sportsSync").set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        gameCount: games.length,
        failures,
      },
      { merge: true }
    );

    logger.info("syncGames complete", { count: games.length });
  }
);

/** Sweeps games that finished more than 48h ago. */
export const pruneGames = onSchedule(
  { schedule: "0 5 * * *", region: "us-central1", timeoutSeconds: 300 },
  async () => {
    const cutoff = Date.now() - 48 * 3_600_000;
    const stale = await db
      .collection("games")
      .where("status", "==", "final")
      .where("startsAt", "<", cutoff)
      .limit(400)
      .get();

    if (stale.empty) return;

    // A final game with unsettled bets is evidence settlement is broken.
    // Deleting it makes refundStaleBets turn a win into a refund at 06:30 and
    // hides the underlying failure.
    const batch = db.batch();
    let deleted = 0;

    for (const d of stale.docs) {
      const pending = await db
        .collection("bets")
        .where("gameId", "==", d.id)
        .where("status", "==", "pending")
        .limit(1)
        .get();

      if (!pending.empty) {
        logger.warn("skipping prune, bets still pending", { gameId: d.id });
        continue;
      }

      batch.delete(d.ref);
      deleted++;
    }

    if (deleted === 0) return;
    await batch.commit();

    logger.info("pruneGames", { deleted });
  }
);

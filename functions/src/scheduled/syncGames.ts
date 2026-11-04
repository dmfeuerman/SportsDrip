import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../lib/economy";
import { isClutch, type GameLike } from "../lib/gameState";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { fetchGames, type NormalizedGame } from "../lib/sportsProvider";
import { sendSweatAlerts } from "./sweat";

/**
 * Sends a one-time clutch alert to everyone with league stakes on a live game
 * that enters its final 5 minutes (or 9th inning) within one score.
 * Exported for unit tests.
 */
export async function sendClutchAlerts(
  games?: Array<GameLike & { id: string; homeTeam?: { abbreviation: string }; awayTeam?: { abbreviation: string } }>,
  now = Date.now()
): Promise<number> {
  const candidates =
    games ??
    (await db.collection("games").where("status", "==", "live").limit(200).get()).docs.map((d) => ({
      id: d.id,
      ...(d.data() as GameLike & { homeTeam?: { abbreviation: string }; awayTeam?: { abbreviation: string } }),
    }));

  const clutchGames = candidates.filter((g) => isClutch(g));
  if (clutchGames.length === 0) return 0;

  let alertsSent = 0;
  for (const g of clutchGames) {
    const sidesGroup = await db
      .collectionGroup("gameSides")
      .where("gameId", "==", g.id)
      .limit(200)
      .get();

    for (const sideDoc of sidesGroup.docs) {
      if (sideDoc.get("clutchAlerted") === true) continue;
      const entries = (sideDoc.get("entries") as Array<{ uid: string; name?: string; displayName?: string }> | undefined) ?? [];
      if (entries.length === 0) continue;

      const leagueId = sideDoc.get("leagueId") as string;
      const did = await db.runTransaction(async (tx) => {
        const [freshSide, league] = await Promise.all([
          tx.get(sideDoc.ref),
          tx.get(db.collection("leagues").doc(leagueId)),
        ]);
        if (!freshSide.exists || freshSide.get("clutchAlerted") === true) return 0;
        if (!league.exists || league.get("status") !== "active") return 0;

        tx.update(sideDoc.ref, { clutchAlerted: true, clutchAlertedAt: now });

        const homeAbbr = g.homeTeam?.abbreviation ?? "HOME";
        const awayAbbr = g.awayTeam?.abbreviation ?? "AWAY";
        const hs = g.homeScore ?? 0;
        const as = g.awayScore ?? 0;
        const scoreLine =
          hs === as
            ? `${awayAbbr} ${as}, ${homeAbbr} ${hs} tied`
            : hs > as
              ? `${homeAbbr} up ${hs - as}`
              : `${awayAbbr} up ${as - hs}`;
        const clockPart = g.clock ? `, ${g.clock} left` : "";

        const byUid = new Map<string, string>();
        for (const e of entries) {
          byUid.set(e.uid, e.displayName ?? e.name ?? "Player");
        }
        const uids = [...byUid.keys()];
        const leagueName = (league.get("name") as string) ?? "League";

        for (const uid of uids) {
          const others = uids.filter((u) => u !== uid).map((u) => byUid.get(u)!);
          const who =
            others.length === 0
              ? "You are sweating."
              : others.length === 1
                ? `You and ${others[0]} are sweating.`
                : `You, ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are sweating.`;

          writeNotification(
            tx,
            uid,
            simpleNotification({
              id: `clutch_${leagueId}_${g.id}`,
              type: "clutch_alert",
              title: `${scoreLine}${clockPart}`,
              body: `${who}`,
              wallet: "league",
              leagueId,
              leagueName,
              now,
              popup: true,
              data: { gameId: g.id, leagueId },
            })
          );
        }
        return uids.length;
      });
      alertsSent += did;
    }
  }
  return alertsSent;
}

/**
 * Pulls the scoreboard for every configured sport and writes it to games/{id}.
 * Tightened to a 1-minute schedule so games within 30 minutes of kickoff carry
 * fresh prices.
 */
export const syncGames = onSchedule(
  { schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 },
  async () => {
    const { games, failures } = await fetchGames();

    if (failures.length) logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
      logger.error("sportsProvider returned nothing — leaving previous cache in place");
      return;
    }

    for (let i = 0; i < games.length; i += 400) {
      const batch = db.batch();
      for (const g of games.slice(i, i + 400)) {
        batch.set(db.collection("games").doc(g.id), { ...g, expired: false }, { merge: true });
      }
      await batch.commit();
    }

    const expired = await expireMissing(new Set(games.map((g: NormalizedGame) => g.id)));
    const clutch = await sendClutchAlerts(games, Date.now());
    const sweat = await sendSweatAlerts(games as never, Date.now()).catch((err) => {
      logger.warn("sweat alerts failed", { error: String(err) });
      return 0;
    });

    await db.collection("meta").doc("sportsSync").set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        gameCount: games.length,
        expired,
        clutch,
        sweat,
        failures,
      },
      { merge: true }
    );

    logger.info("syncGames complete", { count: games.length, clutch });
  }
);

async function expireMissing(seen: Set<string>): Promise<number> {
  const cutoff = Date.now() - 6 * 3_600_000;
  const stale = await db
    .collection("games")
    .where("status", "in", ["upcoming", "live"])
    .where("startsAt", "<", cutoff)
    .limit(400)
    .get();
  const batch = db.batch();
  let n = 0;
  for (const d of stale.docs) {
    if (seen.has(d.id) || d.get("expired") === true) continue;
    batch.set(d.ref, { expired: true, expiredAt: Date.now() }, { merge: true });
    n++;
  }
  if (n) await batch.commit();
  if (n) logger.info("expired stale games", { count: n });
  return n;
}

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
      batch.delete(db.collection("gameInsights").doc(d.id));
      deleted++;
    }

    if (deleted === 0) return;
    await batch.commit();

    logger.info("pruneGames", { deleted });
  }
);

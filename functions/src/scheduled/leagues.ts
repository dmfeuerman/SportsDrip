import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { finalizeLeague, payoutLeague } from "../lib/leagueLifecycle";
import { expirePunishments } from "../lib/awards";
import { closeMatchups } from "./weekly";

/**
 * Ends leagues whose season is over and pays out anything still owed. Before
 * this a league only ended if someone pressed the button, and pressing it
 * paid nobody.
 */
export async function sweepLeagues(now: number): Promise<{ ended: number; paid: number }> {
  const [expired, unpaid] = await Promise.all([
    db.collection("leagues").where("status", "==", "active").where("endsAt", "<=", now).limit(100).get(),
    db.collection("leagues").where("status", "==", "ended").where("payoutStatus", "==", "pending").limit(100).get(),
  ]);

  let ended = 0;
  let paid = 0;
  for (const d of expired.docs) {
    try {
      // The last week of head-to-head (the playoff) closes at the season end.
      if (d.get("openMatchupWeek")) {
        await closeMatchups(d.id, Math.min(now, d.get("endsAt") as number));
      }
      await finalizeLeague(d.id, now);
      ended++;
      paid += await payoutLeague(d.id);
    } catch (err) {
      logger.error("finalizeLeague failed", { leagueId: d.id, err });
    }
  }
  for (const d of unpaid.docs) paid += await payoutLeague(d.id);
  await expirePunishments(now);
  return { ended, paid };
}

export const leagueSweep = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const r = await sweepLeagues(Date.now());
    if (r.ended || r.paid) logger.info("leagueSweep", r);
  }
);

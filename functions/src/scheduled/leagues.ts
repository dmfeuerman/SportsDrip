// import { onSchedule } from "firebase-functions/v2/scheduler";
import { onSchedule } from "../lib/onlineSchedule";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { cancelUnstartedLeague, finalizeLeague, payoutLeague } from "../lib/leagueLifecycle";
import { MIN_LEAGUE_PLAYERS } from "../lib/leagueConfig";
import { expirePunishments } from "../lib/awards";
import { closeMatchups } from "./weekly";

/**
 * Ends leagues whose season is over and pays out anything still owed. Before
 * this a league only ended if someone pressed the button, and pressing it
 * paid nobody.
 */
export async function sweepLeagues(now: number): Promise<{ ended: number; paid: number; cancelled: number }> {
  const [expired, unpaid, due] = await Promise.all([
    db.collection("leagues").where("status", "==", "active").where("endsAt", "<=", now).limit(100).get(),
    db.collection("leagues").where("status", "==", "ended").where("payoutStatus", "==", "pending").limit(100).get(),
    // Start date reached: any still short of players is cancelled.
    db.collection("leagues").where("status", "==", "active").where("startsAt", "<=", now).where("startsAt", ">", now - 7 * 86_400_000).limit(300).get(),
  ]);

  let ended = 0;
  let paid = 0;
  let cancelled = 0;
  for (const d of due.docs) {
    if (d.get("scheduledStart") !== true) continue;
    if (((d.get("memberIds") as string[] | undefined)?.length ?? 0) >= MIN_LEAGUE_PLAYERS) continue;
    try {
      if (await cancelUnstartedLeague(d.id, now, MIN_LEAGUE_PLAYERS)) cancelled++;
    } catch (err) {
      logger.error("cancelUnstartedLeague failed", { leagueId: d.id, err });
    }
  }
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
  return { ended, paid, cancelled };
}

export const leagueSweep = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const r = await sweepLeagues(Date.now());
    if (r.ended || r.paid || r.cancelled) logger.info("leagueSweep", r);
  }
);

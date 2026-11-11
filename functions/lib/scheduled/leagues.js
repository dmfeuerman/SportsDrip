"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leagueSweep = void 0;
exports.sweepLeagues = sweepLeagues;
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const leagueLifecycle_1 = require("../lib/leagueLifecycle");
const leagueConfig_1 = require("../lib/leagueConfig");
const awards_1 = require("../lib/awards");
const weekly_1 = require("./weekly");
/**
 * Ends leagues whose season is over and pays out anything still owed. Before
 * this a league only ended if someone pressed the button, and pressing it
 * paid nobody.
 */
async function sweepLeagues(now) {
    const [expired, unpaid, due] = await Promise.all([
        economy_1.db.collection("leagues").where("status", "==", "active").where("endsAt", "<=", now).limit(100).get(),
        economy_1.db.collection("leagues").where("status", "==", "ended").where("payoutStatus", "==", "pending").limit(100).get(),
        // Start date reached: any still short of players is cancelled.
        economy_1.db.collection("leagues").where("status", "==", "active").where("startsAt", "<=", now).where("startsAt", ">", now - 7 * 86_400_000).limit(300).get(),
    ]);
    let ended = 0;
    let paid = 0;
    let cancelled = 0;
    for (const d of due.docs) {
        if (d.get("scheduledStart") !== true)
            continue;
        if ((d.get("memberIds")?.length ?? 0) >= leagueConfig_1.MIN_LEAGUE_PLAYERS)
            continue;
        try {
            if (await (0, leagueLifecycle_1.cancelUnstartedLeague)(d.id, now, leagueConfig_1.MIN_LEAGUE_PLAYERS))
                cancelled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("cancelUnstartedLeague failed", { leagueId: d.id, err });
        }
    }
    for (const d of expired.docs) {
        try {
            // The last week of head-to-head (the playoff) closes at the season end.
            if (d.get("openMatchupWeek")) {
                await (0, weekly_1.closeMatchups)(d.id, Math.min(now, d.get("endsAt")));
            }
            await (0, leagueLifecycle_1.finalizeLeague)(d.id, now);
            ended++;
            paid += await (0, leagueLifecycle_1.payoutLeague)(d.id);
        }
        catch (err) {
            firebase_functions_1.logger.error("finalizeLeague failed", { leagueId: d.id, err });
        }
    }
    for (const d of unpaid.docs)
        paid += await (0, leagueLifecycle_1.payoutLeague)(d.id);
    await (0, awards_1.expirePunishments)(now);
    return { ended, paid, cancelled };
}
exports.leagueSweep = (0, onlineSchedule_1.onSchedule)({ schedule: "every 60 minutes", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const r = await sweepLeagues(Date.now());
    if (r.ended || r.paid || r.cancelled)
        firebase_functions_1.logger.info("leagueSweep", r);
});
//# sourceMappingURL=leagues.js.map
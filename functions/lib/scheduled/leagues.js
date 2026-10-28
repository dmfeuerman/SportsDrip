"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leagueSweep = void 0;
exports.sweepLeagues = sweepLeagues;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const leagueLifecycle_1 = require("../lib/leagueLifecycle");
/**
 * Ends leagues whose season is over and pays out anything still owed. Before
 * this a league only ended if someone pressed the button, and pressing it
 * paid nobody.
 */
async function sweepLeagues(now) {
    const [expired, unpaid] = await Promise.all([
        economy_1.db.collection("leagues").where("status", "==", "active").where("endsAt", "<=", now).limit(100).get(),
        economy_1.db.collection("leagues").where("status", "==", "ended").where("payoutStatus", "==", "pending").limit(100).get(),
    ]);
    let ended = 0;
    let paid = 0;
    for (const d of expired.docs) {
        try {
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
    return { ended, paid };
}
exports.leagueSweep = (0, scheduler_1.onSchedule)({ schedule: "every 60 minutes", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const r = await sweepLeagues(Date.now());
    if (r.ended || r.paid)
        firebase_functions_1.logger.info("leagueSweep", r);
});
//# sourceMappingURL=leagues.js.map
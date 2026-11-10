"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yearWrapped = void 0;
exports.runYearWrapped = runYearWrapped;
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const wrapped_1 = require("../lib/wrapped");
/**
 * Yearly Drip Wrapped, Dec 1 09:00 ET. Pages through users who played this
 * year (streak.lastDay in the year) and writes users/{uid}/wrapped/year-YYYY.
 * Promotional copy around it is live-ops.
 */
async function runYearWrapped(year, now = Date.now()) {
    let n = 0;
    let last = null;
    for (;;) {
        let q = economy_1.db.collection("users").where("streak.lastDay", ">=", `${year}-01-01`).orderBy("streak.lastDay").limit(300);
        if (last)
            q = q.startAfter(last);
        const page = await q.get();
        if (page.empty)
            break;
        for (const u of page.docs) {
            if (await (0, wrapped_1.generateYearWrapped)(u.id, year, now).catch(() => false))
                n++;
        }
        last = page.docs[page.docs.length - 1];
        if (page.size < 300)
            break;
    }
    return n;
}
exports.yearWrapped = (0, onlineSchedule_1.onSchedule)({ schedule: "0 9 1 12 *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
    const year = new Date().getUTCFullYear();
    const n = await runYearWrapped(year);
    firebase_functions_1.logger.info("yearWrapped", { year, n });
});
//# sourceMappingURL=wrapped.js.map
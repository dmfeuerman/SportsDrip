"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anyoneOnline = anyoneOnline;
exports.onSchedule = onSchedule;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
/** presence/{uid}.at newer than this counts as online (heartbeat is every 5 min). */
const ONLINE_WINDOW_MS = 10 * 60_000;
async function anyoneOnline() {
    const snap = await economy_1.db.collection("presence").where("at", ">", Date.now() - ONLINE_WINDOW_MS).limit(1).get();
    return !snap.empty;
}
/** Dev-mode drop-in for onSchedule: skips the run unless a user is online. */
function onSchedule(opts, handler) {
    return (0, scheduler_1.onSchedule)(opts, async (event) => {
        if (!(await anyoneOnline())) {
            firebase_functions_1.logger.debug("skipped: no users online");
            return;
        }
        await handler(event);
    });
}
//# sourceMappingURL=onlineSchedule.js.map
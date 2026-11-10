"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.winBack = void 0;
exports.sendWinBacks = sendWinBacks;
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const streak_1 = require("../lib/streak");
const winBack_1 = require("../lib/winBack");
const PAGE = 300;
/**
 * Daily: users whose last pick was exactly 3/7/14 ET days ago get one
 * engagement-class push (win_back — pushBudget applies: cap, quiet hours,
 * breaks, daily limit) and a pending returning-player Prize Box.
 */
async function sendWinBacks(now = Date.now()) {
    const today = (0, streak_1.nyDay)(now);
    let sent = 0;
    for (const stage of winBack_1.WIN_BACK_STAGES) {
        const lastDay = (0, streak_1.nyDay)(now - stage * 86_400_000);
        let cursor = null;
        for (;;) {
            let q = economy_1.db.collection("users").where("streak.lastDay", "==", lastDay).orderBy("__name__").limit(PAGE);
            if (cursor)
                q = q.startAfter(cursor);
            const page = await q.get();
            for (const u of page.docs) {
                const did = await economy_1.db.runTransaction(async (tx) => {
                    const fresh = await tx.get(u.ref);
                    const ld = fresh.get("streak.lastDay");
                    const due = (0, winBack_1.dueWinBackStage)(ld, today, fresh.get("winBack"));
                    if (!due || !ld)
                        return 0;
                    const state = { lastDay: ld, stage: due, pending: true, at: now, claimedAt: null };
                    tx.update(u.ref, { winBack: state });
                    const copy = (0, winBack_1.winBackCopy)(due, fresh.get("displayName"));
                    (0, notify_1.writeNotification)(tx, u.id, (0, notifyModel_1.simpleNotification)({ id: `winback_${ld}_${due}`, type: "win_back", ...copy, now, data: { stage: String(due) } }));
                    return 1;
                });
                sent += did;
            }
            if (page.size < PAGE)
                break;
            cursor = page.docs[page.docs.length - 1] ?? null;
        }
    }
    return sent;
}
exports.winBack = (0, onlineSchedule_1.onSchedule)({ schedule: "every day 12:00", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const n = await sendWinBacks(Date.now());
    if (n > 0)
        firebase_functions_1.logger.info("winBack sent", { count: n });
});
//# sourceMappingURL=winBack.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.birthdayGifts = exports.birthdayRef = exports.BIRTHDAY_GIFT = void 0;
exports.nyMonthYear = nyMonthYear;
exports.sendBirthdayGifts = sendBirthdayGifts;
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
/** Credits every player gets on the 1st of their birth month. */
exports.BIRTHDAY_GIFT = 500;
const PAGE = 200;
/**
 * birthdays/{uid} → { uid, month: 1–12, lastGiftYear }. Server-only (rules deny
 * all client access), so birth months never sit on the publicly readable
 * users/{uid} doc. Written by createProfile.
 */
const birthdayRef = (uid) => economy_1.db.collection("birthdays").doc(uid);
exports.birthdayRef = birthdayRef;
/** Month (1–12) and year in America/New_York. */
function nyMonthYear(now) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(new Date(now));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return { month: get("month"), year: get("year") };
}
/**
 * Pays this month's birthday gifts. Idempotent: the ledger key is per year and
 * each doc's lastGiftYear moves it out of the query, so a rerun (or a retry
 * after a timeout) pays no one twice.
 */
async function sendBirthdayGifts(now = Date.now()) {
    const { month, year } = nyMonthYear(now);
    let paid = 0;
    for (;;) {
        const page = await economy_1.db.collection("birthdays").where("month", "==", month).where("lastGiftYear", "<", year).limit(PAGE).get();
        if (page.empty)
            break;
        for (const b of page.docs) {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const fresh = await tx.get(b.ref);
                if (!fresh.exists || (fresh.get("lastGiftYear") ?? 0) >= year)
                    return 0;
                const user = await tx.get(economy_1.db.collection("users").doc(b.id));
                if (!user.exists) {
                    tx.delete(b.ref);
                    return 0;
                }
                const balance = await (0, economy_1.applyCredits)(tx, b.id, {
                    delta: exports.BIRTHDAY_GIFT,
                    type: "birthday_gift",
                    idempotencyKey: `birthday_${year}`,
                    note: "Happy birthday from On The House",
                });
                tx.update(b.ref, { lastGiftYear: year });
                if (balance === null)
                    return 0;
                const name = user.get("displayName") ?? "";
                (0, notify_1.writeNotification)(tx, b.id, (0, notifyModel_1.simpleNotification)({
                    id: `birthday_${year}`,
                    type: "birthday_gift",
                    title: `Happy birthday month${name ? `, ${name}` : ""}! 🎂`,
                    body: `Here's ${exports.BIRTHDAY_GIFT.toLocaleString("en-US")} credits on us.`,
                    now,
                    delta: exports.BIRTHDAY_GIFT,
                    balanceAfter: balance,
                    popup: true,
                }));
                return 1;
            });
            paid += did;
        }
        if (page.size < PAGE)
            break;
    }
    return paid;
}
/** 09:00 ET on the 1st of every month. */
exports.birthdayGifts = (0, onlineSchedule_1.onSchedule)({ schedule: "0 9 1 * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const n = await sendBirthdayGifts(Date.now());
    firebase_functions_1.logger.info("birthday gifts paid", { count: n });
});
//# sourceMappingURL=birthdays.js.map
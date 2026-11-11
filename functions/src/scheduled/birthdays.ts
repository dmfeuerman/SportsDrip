// import { onSchedule } from "firebase-functions/v2/scheduler";
import { onSchedule } from "../lib/onlineSchedule";
import { logger } from "firebase-functions";
import { applyCredits, db } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

/** Credits every player gets on the 1st of their birth month. */
export const BIRTHDAY_GIFT = 5000;
const PAGE = 200;

/**
 * birthdays/{uid} → { uid, month: 1–12, lastGiftYear }. Server-only (rules deny
 * all client access), so birth months never sit on the publicly readable
 * users/{uid} doc. Written by createProfile.
 */
export const birthdayRef = (uid: string) => db.collection("birthdays").doc(uid);

/** Month (1–12) and year in America/New_York. */
export function nyMonthYear(now: number): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { month: get("month"), year: get("year") };
}

/**
 * Pays this month's birthday gifts. Idempotent: the ledger key is per year and
 * each doc's lastGiftYear moves it out of the query, so a rerun (or a retry
 * after a timeout) pays no one twice.
 */
export async function sendBirthdayGifts(now = Date.now()): Promise<number> {
  const { month, year } = nyMonthYear(now);
  let paid = 0;
  for (;;) {
    const page = await db.collection("birthdays").where("month", "==", month).where("lastGiftYear", "<", year).limit(PAGE).get();
    if (page.empty) break;
    for (const b of page.docs) {
      const did = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(b.ref);
        if (!fresh.exists || ((fresh.get("lastGiftYear") as number | null) ?? 0) >= year) return 0;
        const user = await tx.get(db.collection("users").doc(b.id));
        if (!user.exists) {
          tx.delete(b.ref);
          return 0;
        }
        const balance = await applyCredits(tx, b.id, {
          delta: BIRTHDAY_GIFT,
          type: "birthday_gift",
          idempotencyKey: `birthday_${year}`,
          note: "Happy birthday from On The House",
        });
        tx.update(b.ref, { lastGiftYear: year });
        if (balance === null) return 0;
        const name = (user.get("displayName") as string | undefined) ?? "";
        writeNotification(
          tx,
          b.id,
          simpleNotification({
            id: `birthday_${year}`,
            type: "birthday_gift",
            title: `Happy birthday month${name ? `, ${name}` : ""}! 🎂`,
            body: `Here's ${BIRTHDAY_GIFT.toLocaleString("en-US")} credits on us.`,
            now,
            delta: BIRTHDAY_GIFT,
            balanceAfter: balance,
            popup: true,
          })
        );
        return 1;
      });
      paid += did;
    }
    if (page.size < PAGE) break;
  }
  return paid;
}

/** 09:00 ET on the 1st of every month. */
export const birthdayGifts = onSchedule(
  { schedule: "0 9 1 * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const n = await sendBirthdayGifts(Date.now());
    logger.info("birthday gifts paid", { count: n });
  }
);

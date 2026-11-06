import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { generateYearWrapped } from "../lib/wrapped";

/**
 * Yearly Drip Wrapped, Dec 1 09:00 ET. Pages through users who played this
 * year (streak.lastDay in the year) and writes users/{uid}/wrapped/year-YYYY.
 * Promotional copy around it is live-ops.
 */
export async function runYearWrapped(year: number, now = Date.now()): Promise<number> {
  let n = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection("users").where("streak.lastDay", ">=", `${year}-01-01`).orderBy("streak.lastDay").limit(300);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (const u of page.docs) {
      if (await generateYearWrapped(u.id, year, now).catch(() => false)) n++;
    }
    last = page.docs[page.docs.length - 1]!;
    if (page.size < 300) break;
  }
  return n;
}

export const yearWrapped = onSchedule(
  { schedule: "0 9 1 12 *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const year = new Date().getUTCFullYear();
    const n = await runYearWrapped(year);
    logger.info("yearWrapped", { year, n });
  }
);

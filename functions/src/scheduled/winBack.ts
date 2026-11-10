// import { onSchedule } from "firebase-functions/v2/scheduler";
import { onSchedule } from "../lib/onlineSchedule";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { nyDay } from "../lib/streak";
import { dueWinBackStage, WIN_BACK_STAGES, winBackCopy, type WinBackState } from "../lib/winBack";

const PAGE = 300;

/**
 * Daily: users whose last pick was exactly 3/7/14 ET days ago get one
 * engagement-class push (win_back — pushBudget applies: cap, quiet hours,
 * breaks, daily limit) and a pending returning-player Prize Box.
 */
export async function sendWinBacks(now = Date.now()): Promise<number> {
  const today = nyDay(now);
  let sent = 0;
  for (const stage of WIN_BACK_STAGES) {
    const lastDay = nyDay(now - stage * 86_400_000);
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection("users").where("streak.lastDay", "==", lastDay).orderBy("__name__").limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      for (const u of page.docs) {
        const did = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(u.ref);
          const ld = fresh.get("streak.lastDay") as string | undefined;
          const due = dueWinBackStage(ld, today, fresh.get("winBack") as Partial<WinBackState> | undefined);
          if (!due || !ld) return 0;
          const state: WinBackState = { lastDay: ld, stage: due, pending: true, at: now, claimedAt: null };
          tx.update(u.ref, { winBack: state });
          const copy = winBackCopy(due, fresh.get("displayName") as string | undefined);
          writeNotification(
            tx,
            u.id,
            simpleNotification({ id: `winback_${ld}_${due}`, type: "win_back", ...copy, now, data: { stage: String(due) } })
          );
          return 1;
        });
        sent += did;
      }
      if (page.size < PAGE) break;
      cursor = page.docs[page.docs.length - 1] ?? null;
    }
  }
  return sent;
}

export const winBack = onSchedule(
  { schedule: "every day 12:00", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const n = await sendWinBacks(Date.now());
    if (n > 0) logger.info("winBack sent", { count: n });
  }
);

import { onSchedule as realOnSchedule, type ScheduleOptions, type ScheduledEvent } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "./economy";

/** presence/{uid}.at newer than this counts as online (heartbeat is every 5 min). */
const ONLINE_WINDOW_MS = 10 * 60_000;

export async function anyoneOnline(): Promise<boolean> {
  const snap = await db.collection("presence").where("at", ">", Date.now() - ONLINE_WINDOW_MS).limit(1).get();
  return !snap.empty;
}

/** Dev-mode drop-in for onSchedule: skips the run unless a user is online. */
export function onSchedule(opts: ScheduleOptions, handler: (event: ScheduledEvent) => void | Promise<void>) {
  return realOnSchedule(opts, async (event) => {
    if (!(await anyoneOnline())) {
      logger.debug("skipped: no users online");
      return;
    }
    await handler(event);
  });
}

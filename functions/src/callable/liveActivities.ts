import { onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { activityPayload, APNS_SECRETS, sendLiveActivity, type ActivityContentState } from "../lib/apns";

/**
 * users/{uid}/liveActivities/{gameId}: the ActivityKit push token for a game the
 * player has money on, registered by the app after it starts the activity on
 * lock-in. Updates go out from the live refresh (scheduled/syncGames.ts).
 */
export const registerLiveActivity = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      gameId: z.string().min(1).max(64),
      token: z.string().regex(/^[0-9a-f]{32,200}$/i),
      side: z.enum(["home", "away"]),
    })
    .parse(req.data);
  await db
    .collection("users")
    .doc(uid)
    .collection("liveActivities")
    .doc(input.gameId)
    .set({ uid, gameId: input.gameId, token: input.token, side: input.side, startedAt: Date.now(), endedAt: null });
  return { ok: true };
});

/** Pushes the latest score to every activity on these games; ends them at final. */
export async function pushLiveActivities(
  games: Array<{ id: string; status: string; homeScore: number | null; awayScore: number | null; clock?: string | null; statusDetail?: string | null }>
): Promise<number> {
  let sent = 0;
  for (const g of games) {
    const regs = await db.collectionGroup("liveActivities").where("gameId", "==", g.id).where("endedAt", "==", null).limit(500).get();
    if (regs.empty) continue;
    const state: ActivityContentState = {
      homeScore: g.homeScore ?? 0,
      awayScore: g.awayScore ?? 0,
      clock: (g.clock ?? g.statusDetail ?? "").slice(0, 40),
      status: g.status === "final" ? "final" : "live",
    };
    const event = g.status === "final" ? "end" : "update";
    try {
      const res = await sendLiveActivity(regs.docs.map((d) => d.get("token") as string), activityPayload(state, event));
      sent += res.sent;
      const batch = db.batch();
      for (const d of regs.docs) {
        if (event === "end" || res.dead.includes(d.get("token") as string)) batch.update(d.ref, { endedAt: Date.now() });
      }
      await batch.commit();
    } catch (err) {
      logger.warn("live activity push failed", { gameId: g.id, error: String(err) });
    }
  }
  return sent;
}

/**
 * Score/status changes on a game fan out to its Live Activities. Separate from
 * the sync jobs so the APNs secrets are bound only here; skip deploying this
 * function until the secrets exist.
 */
export const pushLiveActivityOnGame = onDocumentUpdated(
  { document: "games/{gameId}", region: "us-central1", timeoutSeconds: 60, secrets: APNS_SECRETS },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const changed = before.homeScore !== after.homeScore || before.awayScore !== after.awayScore || before.status !== after.status || before.clock !== after.clock;
    if (!changed || (after.status !== "live" && after.status !== "final")) return;
    await pushLiveActivities([{ id: event.params.gameId, status: after.status, homeScore: after.homeScore ?? null, awayScore: after.awayScore ?? null, clock: after.clock ?? null }]);
  }
);

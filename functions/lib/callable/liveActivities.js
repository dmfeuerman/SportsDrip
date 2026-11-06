"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushLiveActivityOnGame = exports.registerLiveActivity = void 0;
exports.pushLiveActivities = pushLiveActivities;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const apns_1 = require("../lib/apns");
/**
 * users/{uid}/liveActivities/{gameId}: the ActivityKit push token for a game the
 * player has money on, registered by the app after it starts the activity on
 * lock-in. Updates go out from the live refresh (scheduled/syncGames.ts).
 */
exports.registerLiveActivity = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        gameId: zod_1.z.string().min(1).max(64),
        token: zod_1.z.string().regex(/^[0-9a-f]{32,200}$/i),
        side: zod_1.z.enum(["home", "away"]),
    })
        .parse(req.data);
    await economy_1.db
        .collection("users")
        .doc(uid)
        .collection("liveActivities")
        .doc(input.gameId)
        .set({ uid, gameId: input.gameId, token: input.token, side: input.side, startedAt: Date.now(), endedAt: null });
    return { ok: true };
});
/** Pushes the latest score to every activity on these games; ends them at final. */
async function pushLiveActivities(games) {
    let sent = 0;
    for (const g of games) {
        const regs = await economy_1.db.collectionGroup("liveActivities").where("gameId", "==", g.id).where("endedAt", "==", null).limit(500).get();
        if (regs.empty)
            continue;
        const state = {
            homeScore: g.homeScore ?? 0,
            awayScore: g.awayScore ?? 0,
            clock: (g.clock ?? g.statusDetail ?? "").slice(0, 40),
            status: g.status === "final" ? "final" : "live",
        };
        const event = g.status === "final" ? "end" : "update";
        try {
            const res = await (0, apns_1.sendLiveActivity)(regs.docs.map((d) => d.get("token")), (0, apns_1.activityPayload)(state, event));
            sent += res.sent;
            const batch = economy_1.db.batch();
            for (const d of regs.docs) {
                if (event === "end" || res.dead.includes(d.get("token")))
                    batch.update(d.ref, { endedAt: Date.now() });
            }
            await batch.commit();
        }
        catch (err) {
            firebase_functions_1.logger.warn("live activity push failed", { gameId: g.id, error: String(err) });
        }
    }
    return sent;
}
/**
 * Score/status changes on a game fan out to its Live Activities. Separate from
 * the sync jobs so the APNs secrets are bound only here; skip deploying this
 * function until the secrets exist.
 */
exports.pushLiveActivityOnGame = (0, firestore_1.onDocumentUpdated)({ document: "games/{gameId}", region: "us-central1", timeoutSeconds: 60, secrets: apns_1.APNS_SECRETS }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const changed = before.homeScore !== after.homeScore || before.awayScore !== after.awayScore || before.status !== after.status || before.clock !== after.clock;
    if (!changed || (after.status !== "live" && after.status !== "final"))
        return;
    await pushLiveActivities([{ id: event.params.gameId, status: after.status, homeScore: after.homeScore ?? null, awayScore: after.awayScore ?? null, clock: after.clock ?? null }]);
});
//# sourceMappingURL=liveActivities.js.map
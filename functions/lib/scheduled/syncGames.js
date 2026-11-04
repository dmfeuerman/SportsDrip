"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneGames = exports.syncGames = void 0;
exports.sendClutchAlerts = sendClutchAlerts;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const gameState_1 = require("../lib/gameState");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const sportsProvider_1 = require("../lib/sportsProvider");
/**
 * Sends a one-time clutch alert to everyone with league stakes on a live game
 * that enters its final 5 minutes (or 9th inning) within one score.
 * Exported for unit tests.
 */
async function sendClutchAlerts(games, now = Date.now()) {
    const candidates = games ??
        (await economy_1.db.collection("games").where("status", "==", "live").limit(200).get()).docs.map((d) => ({
            id: d.id,
            ...d.data(),
        }));
    const clutchGames = candidates.filter((g) => (0, gameState_1.isClutch)(g));
    if (clutchGames.length === 0)
        return 0;
    let alertsSent = 0;
    for (const g of clutchGames) {
        const sidesGroup = await economy_1.db
            .collectionGroup("gameSides")
            .where("gameId", "==", g.id)
            .limit(200)
            .get();
        for (const sideDoc of sidesGroup.docs) {
            if (sideDoc.get("clutchAlerted") === true)
                continue;
            const entries = sideDoc.get("entries") ?? [];
            if (entries.length === 0)
                continue;
            const leagueId = sideDoc.get("leagueId");
            const did = await economy_1.db.runTransaction(async (tx) => {
                const [freshSide, league] = await Promise.all([
                    tx.get(sideDoc.ref),
                    tx.get(economy_1.db.collection("leagues").doc(leagueId)),
                ]);
                if (!freshSide.exists || freshSide.get("clutchAlerted") === true)
                    return 0;
                if (!league.exists || league.get("status") !== "active")
                    return 0;
                tx.update(sideDoc.ref, { clutchAlerted: true, clutchAlertedAt: now });
                const homeAbbr = g.homeTeam?.abbreviation ?? "HOME";
                const awayAbbr = g.awayTeam?.abbreviation ?? "AWAY";
                const hs = g.homeScore ?? 0;
                const as = g.awayScore ?? 0;
                const scoreLine = hs === as
                    ? `${awayAbbr} ${as}, ${homeAbbr} ${hs} tied`
                    : hs > as
                        ? `${homeAbbr} up ${hs - as}`
                        : `${awayAbbr} up ${as - hs}`;
                const clockPart = g.clock ? `, ${g.clock} left` : "";
                const byUid = new Map();
                for (const e of entries) {
                    byUid.set(e.uid, e.displayName ?? e.name ?? "Player");
                }
                const uids = [...byUid.keys()];
                const leagueName = league.get("name") ?? "League";
                for (const uid of uids) {
                    const others = uids.filter((u) => u !== uid).map((u) => byUid.get(u));
                    const who = others.length === 0
                        ? "You are sweating."
                        : others.length === 1
                            ? `You and ${others[0]} are sweating.`
                            : `You, ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are sweating.`;
                    (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                        id: `clutch_${leagueId}_${g.id}`,
                        type: "clutch_alert",
                        title: `${scoreLine}${clockPart}`,
                        body: `${who}`,
                        wallet: "league",
                        leagueId,
                        leagueName,
                        now,
                        popup: true,
                        data: { gameId: g.id, leagueId },
                    }));
                }
                return uids.length;
            });
            alertsSent += did;
        }
    }
    return alertsSent;
}
/**
 * Pulls the scoreboard for every configured sport and writes it to games/{id}.
 * Tightened to a 1-minute schedule so games within 30 minutes of kickoff carry
 * fresh prices.
 */
exports.syncGames = (0, scheduler_1.onSchedule)({ schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 }, async () => {
    const { games, failures } = await (0, sportsProvider_1.fetchGames)();
    if (failures.length)
        firebase_functions_1.logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
        firebase_functions_1.logger.error("sportsProvider returned nothing — leaving previous cache in place");
        return;
    }
    for (let i = 0; i < games.length; i += 400) {
        const batch = economy_1.db.batch();
        for (const g of games.slice(i, i + 400)) {
            batch.set(economy_1.db.collection("games").doc(g.id), { ...g, expired: false }, { merge: true });
        }
        await batch.commit();
    }
    const expired = await expireMissing(new Set(games.map((g) => g.id)));
    const clutch = await sendClutchAlerts(games, Date.now());
    await economy_1.db.collection("meta").doc("sportsSync").set({
        lastRunAt: economy_1.FieldValue.serverTimestamp(),
        gameCount: games.length,
        expired,
        clutch,
        failures,
    }, { merge: true });
    firebase_functions_1.logger.info("syncGames complete", { count: games.length, clutch });
});
async function expireMissing(seen) {
    const cutoff = Date.now() - 6 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "in", ["upcoming", "live"])
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    const batch = economy_1.db.batch();
    let n = 0;
    for (const d of stale.docs) {
        if (seen.has(d.id) || d.get("expired") === true)
            continue;
        batch.set(d.ref, { expired: true, expiredAt: Date.now() }, { merge: true });
        n++;
    }
    if (n)
        await batch.commit();
    if (n)
        firebase_functions_1.logger.info("expired stale games", { count: n });
    return n;
}
/** Sweeps games that finished more than 48h ago. */
exports.pruneGames = (0, scheduler_1.onSchedule)({ schedule: "0 5 * * *", region: "us-central1", timeoutSeconds: 300 }, async () => {
    const cutoff = Date.now() - 48 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "==", "final")
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    if (stale.empty)
        return;
    const batch = economy_1.db.batch();
    let deleted = 0;
    for (const d of stale.docs) {
        const pending = await economy_1.db
            .collection("bets")
            .where("gameId", "==", d.id)
            .where("status", "==", "pending")
            .limit(1)
            .get();
        if (!pending.empty) {
            firebase_functions_1.logger.warn("skipping prune, bets still pending", { gameId: d.id });
            continue;
        }
        batch.delete(d.ref);
        batch.delete(economy_1.db.collection("gameInsights").doc(d.id));
        deleted++;
    }
    if (deleted === 0)
        return;
    await batch.commit();
    firebase_functions_1.logger.info("pruneGames", { deleted });
});
//# sourceMappingURL=syncGames.js.map
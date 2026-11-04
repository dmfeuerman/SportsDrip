"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockReminders = void 0;
exports.sendLockReminders = sendLockReminders;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const streak_1 = require("../lib/streak");
/**
 * 5-minute scheduled job that finds upcoming games starting in 15–20 minutes
 * (with a 10–25m window to absorb scheduler jitter) that league members have
 * bets on, and notifies members of that league who haven't bet yet:
 *   "Jake and Priya are on DET. Locks in 15."
 * Capped at one reminder per league per calendar day (America/New_York).
 */
async function sendLockReminders(now = Date.now()) {
    const minStart = now + 10 * 60_000;
    const maxStart = now + 25 * 60_000;
    const today = (0, streak_1.nyDay)(now);
    const upcoming = await economy_1.db
        .collection("games")
        .where("status", "==", "upcoming")
        .where("startsAt", ">=", minStart)
        .where("startsAt", "<=", maxStart)
        .limit(200)
        .get();
    if (upcoming.empty)
        return 0;
    let sent = 0;
    for (const gameDoc of upcoming.docs) {
        const gameId = gameDoc.id;
        const startsAt = gameDoc.get("startsAt") ?? now + 15 * 60_000;
        const minsLeft = Math.max(1, Math.round((startsAt - now) / 60_000));
        const sidesGroup = await economy_1.db
            .collectionGroup("gameSides")
            .where("gameId", "==", gameId)
            .limit(200)
            .get();
        for (const sideDoc of sidesGroup.docs) {
            const entries = sideDoc.get("entries") ?? [];
            if (entries.length === 0)
                continue;
            const leagueId = sideDoc.get("leagueId");
            const did = await economy_1.db.runTransaction(async (tx) => {
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const league = await tx.get(leagueRef);
                if (!league.exists || league.get("status") !== "active")
                    return 0;
                if (league.get("lastLockReminderDay") === today)
                    return 0;
                const memberIds = league.get("memberIds") ?? [];
                const bettors = new Set(entries.map((e) => e.uid));
                const unbetMembers = memberIds.filter((uid) => !bettors.has(uid));
                if (unbetMembers.length === 0)
                    return 0;
                tx.update(leagueRef, { lastLockReminderDay: today, lastLockReminderGameId: gameId });
                const names = [...new Set(entries.map((e) => e.displayName ?? e.name ?? "Player"))];
                const firstPick = entries[0]?.label ?? entries[0]?.teamAbbr ?? "this game";
                const who = names.length === 1
                    ? `${names[0]} is on ${firstPick}.`
                    : names.length === 2
                        ? `${names[0]} and ${names[1]} are on ${firstPick}.`
                        : `${names[0]}, ${names[1]} and ${names.length - 2} more are on ${firstPick}.`;
                const leagueName = league.get("name") ?? "League";
                for (const uid of unbetMembers) {
                    (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                        id: `lockrem_${leagueId}_${today}`,
                        type: "lock_reminder",
                        title: `${who} Locks in ${minsLeft}.`,
                        body: `Get your pick in for ${leagueName} before kickoff.`,
                        wallet: "league",
                        leagueId,
                        leagueName,
                        now,
                        data: { gameId, leagueId },
                    }));
                }
                return unbetMembers.length;
            });
            sent += did;
        }
    }
    return sent;
}
exports.lockReminders = (0, scheduler_1.onSchedule)({ schedule: "*/5 * * * *", region: "us-central1", timeoutSeconds: 180 }, async () => {
    const n = await sendLockReminders(Date.now());
    if (n > 0)
        firebase_functions_1.logger.info("lockReminders sent", { count: n });
});
//# sourceMappingURL=reminders.js.map
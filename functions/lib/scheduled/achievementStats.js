"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.achievementStats = void 0;
exports.computeAchievementStats = computeAchievementStats;
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const achievements_1 = require("../lib/achievements");
/**
 * Nightly rarity for the trophy case: how many players hold each achievement,
 * out of everyone. One count() per achievement plus one for users, written to
 * meta/achievementStats (readable by any signed-in client).
 */
async function computeAchievementStats(now = Date.now()) {
    const players = (await economy_1.db.collection("users").count().get()).data().count;
    const counts = {};
    for (const a of achievements_1.ACHIEVEMENTS) {
        counts[a.id] = (await economy_1.db.collectionGroup("trophies").where("achievementId", "==", a.id).count().get()).data().count;
    }
    await economy_1.db.collection("meta").doc("achievementStats").set({ players, counts, updatedAt: now });
    return { players, counts };
}
exports.achievementStats = (0, onlineSchedule_1.onSchedule)({ schedule: "15 4 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 120 }, async () => {
    const r = await computeAchievementStats();
    firebase_functions_1.logger.info("achievementStats", { players: r.players });
});
//# sourceMappingURL=achievementStats.js.map
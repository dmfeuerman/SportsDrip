"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACHIEVEMENTS = void 0;
exports.checkAchievements = checkAchievements;
const economy_1 = require("./economy");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
const progression_1 = require("./progression");
exports.ACHIEVEMENTS = [
    { id: "first_win", title: "First Win", icon: "check-decagram", test: (s) => s.betsWon >= 1 },
    { id: "wins_10", title: "10 Wins", icon: "medal-outline", test: (s) => s.betsWon >= 10 },
    { id: "wins_50", title: "50 Wins", icon: "medal", test: (s) => s.betsWon >= 50 },
    { id: "picks_100", title: "100 Picks", icon: "ticket-confirmation-outline", test: (s) => s.betsPlaced >= 100 },
    { id: "streak_7", title: "7-Day Streak", icon: "fire", test: (s) => s.streakLongest >= 7 },
    { id: "streak_30", title: "30-Day Streak", icon: "fire-circle", test: (s) => s.streakLongest >= 30 },
    { id: "streak_100", title: "100-Day Streak", icon: "crown-outline", test: (s) => s.streakLongest >= 100 },
    { id: "daily_10", title: "Daily Pick Sharp", icon: "calendar-check", test: (s) => s.dailyWins >= 10 },
    { id: "level_5", title: "Level 5", icon: "star-outline", test: (s) => s.level >= 5 },
    { id: "level_10", title: "Level 10", icon: "star", test: (s) => s.level >= 10 },
    { id: "level_25", title: "Level 25", icon: "star-shooting", test: (s) => s.level >= 25 },
    { id: "friends_3", title: "Squad Up", icon: "account-group", test: (s) => s.friends >= 3 },
    { id: "friends_10", title: "Crew Chief", icon: "account-group-outline", test: (s) => s.friends >= 10 },
];
/**
 * Awards any achievements the player now qualifies for. Idempotent: an
 * existing trophy doc is never rewritten, so each one notifies once.
 */
async function checkAchievements(uid) {
    const userRef = economy_1.db.collection("users").doc(uid);
    const [user, friendCount] = await Promise.all([
        userRef.get(),
        economy_1.db.collection("friendships").where("users", "array-contains", uid).count().get().then((r) => r.data().count).catch(() => 0),
    ]);
    if (!user.exists)
        return [];
    const stats = {
        betsPlaced: user.get("stats.betsPlaced") ?? 0,
        betsWon: user.get("stats.betsWon") ?? 0,
        streakLongest: Math.max(user.get("streak.longest") ?? 0, user.get("streak.count") ?? 0),
        level: (0, progression_1.levelFromXp)(user.get("xp") ?? 0),
        dailyWins: user.get("dailyRecord.w") ?? 0,
        friends: friendCount,
    };
    const qualified = exports.ACHIEVEMENTS.filter((a) => a.test(stats));
    if (!qualified.length)
        return [];
    const fresh = await economy_1.db.runTransaction(async (tx) => {
        const refs = qualified.map((a) => userRef.collection("trophies").doc(`ach_${a.id}`));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const fresh = qualified.filter((_, i) => !snaps[i].exists);
        const now = Date.now();
        fresh.forEach((a) => {
            tx.set(userRef.collection("trophies").doc(`ach_${a.id}`), {
                id: `ach_${a.id}`,
                kind: "achievement",
                achievementId: a.id,
                title: a.title,
                label: a.icon,
                awardedAt: now,
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({ id: `ach_${a.id}`, type: "achievement", title: `Achievement: ${a.title}`, body: "It's on your trophy shelf.", now }));
        });
        // Badge count for standings / H2H rows (achievements only stack up).
        if (fresh.length || user.get("achievementCount") !== qualified.length) {
            tx.update(userRef, { achievementCount: qualified.length });
        }
        return fresh.map((a) => a.id);
    });
    if (fresh.length)
        await mirrorAchievementCount(uid, qualified.length).catch(() => { });
    return fresh;
}
/** Standings read member docs, so mirror the count into each active league (one update per league). */
async function mirrorAchievementCount(uid, count) {
    const leagues = await economy_1.db.collection("leagues").where("memberIds", "array-contains", uid).limit(50).get();
    await Promise.all(leagues.docs
        .filter((l) => l.get("status") === "active")
        .map((l) => l.ref.update({ [`members.${uid}.achievementCount`]: count })));
}
//# sourceMappingURL=achievements.js.map
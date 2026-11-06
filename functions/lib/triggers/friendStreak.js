"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendStreakOnPick = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const friendStreak_1 = require("../lib/friendStreak");
const MAX_FRIENDS = 500;
/**
 * When a user's daily streak day moves (their first qualifying pick of an ET
 * day), every friend who has also picked that day advances the pair's Friend
 * Streak. Runs after the pick committed, never inside a money transaction.
 */
exports.friendStreakOnPick = (0, firestore_1.onDocumentUpdated)({ document: "users/{uid}", region: "us-central1", timeoutSeconds: 60 }, async (event) => {
    const before = event.data?.before.get("streak.lastDay");
    const day = event.data?.after.get("streak.lastDay");
    if (!day || day === before)
        return;
    const uid = event.params.uid;
    const pairs = await economy_1.db.collection("friendships").where("users", "array-contains", uid).limit(MAX_FRIENDS).get();
    if (pairs.empty)
        return;
    const others = pairs.docs.map((d) => ({ ref: d.ref, other: d.get("users").find((u) => u !== uid) }));
    const valid = others.filter((o) => !!o.other);
    if (valid.length === 0)
        return;
    const friendDocs = await economy_1.db.getAll(...valid.map((o) => economy_1.db.collection("users").doc(o.other)));
    const actedToday = new Set(friendDocs.filter((d) => d.get("streak.lastDay") === day).map((d) => d.id));
    let advanced = 0;
    for (const { ref, other } of valid) {
        if (!actedToday.has(other))
            continue;
        const did = await economy_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return false;
            const next = (0, friendStreak_1.advanceFriendStreak)(snap.get("streak"), day);
            if (!next)
                return false;
            tx.update(ref, { streak: next });
            return true;
        });
        if (did)
            advanced++;
    }
    if (advanced > 0)
        firebase_functions_1.logger.info("friend streaks advanced", { uid, day, advanced });
});
//# sourceMappingURL=friendStreak.js.map
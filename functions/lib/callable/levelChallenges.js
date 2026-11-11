"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordChallengeAction = exports.claimLevelChallenge = exports.getLevelChallenges = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const xp_1 = require("../lib/xp");
const progression_1 = require("../lib/progression");
const levelChallenges_1 = require("../lib/levelChallenges");
/**
 * Level challenges (lib/levelChallenges.ts). State lives at
 * users/{uid}/levelChallenges/state: { active: id[], claimed: {id: true}, counts: {action: n} }.
 * Progress is lifetime and counted on the server, except the few app-only
 * actions in CLIENT_ACTIONS, which the app reports.
 */
const stateRef = (uid) => economy_1.db.collection("users").doc(uid).collection("levelChallenges").doc("state");
async function count(q) {
    try {
        return (await q.count().get()).data().count;
    }
    catch {
        return 0;
    }
}
async function metricValue(uid, m, user, counts) {
    const userRef = economy_1.db.collection("users").doc(uid);
    switch (m) {
        case "bets":
            return count(economy_1.db.collection("bets").where("uid", "==", uid));
        case "wins":
            return count(economy_1.db.collection("bets").where("uid", "==", uid).where("status", "==", "won"));
        case "parlays":
            return count(economy_1.db.collection("slipParlays").where("uid", "==", uid));
        case "friends":
            return count(economy_1.db.collection("friendships").where("users", "array-contains", uid));
        case "leagues":
            return count(economy_1.db.collection("leagues").where("memberIds", "array-contains", uid));
        case "items":
            return count(userRef.collection("inventory"));
        case "ownedHat":
            return count(userRef.collection("inventory").where("slot", "==", "hat"));
        case "ownedTop":
            return count(userRef.collection("inventory").where("slot", "==", "top"));
        case "ownedShoes":
            return count(userRef.collection("inventory").where("slot", "==", "shoes"));
        case "moves":
            return count(userRef.collection("moves"));
        case "freeBets":
            return count(userRef.collection("freeBets"));
        case "favoriteTeams":
            return (user.get("favoriteTeams") ?? []).length;
        case "scene":
            return user.get("background") ? 1 : 0;
        default:
            return counts[m] ?? 0;
    }
}
async function load(uid) {
    const [user, state] = await Promise.all([economy_1.db.collection("users").doc(uid).get(), stateRef(uid).get()]);
    if (!user.exists)
        throw new https_1.HttpsError("not-found", "Profile not found.");
    const level = (0, progression_1.levelFromXp)(user.get("xp"));
    const claimed = state.get("claimed") ?? {};
    const counts = state.get("counts") ?? {};
    const before = state.get("active") ?? [];
    const active = (0, levelChallenges_1.dealChallenges)(before, claimed, level);
    if (active.join(",") !== before.join(","))
        await stateRef(uid).set({ active }, { merge: true });
    const defs = active.map((id) => (0, levelChallenges_1.challengeById)(id)).filter((c) => !!c);
    const progress = await Promise.all(defs.map((c) => metricValue(uid, c.metric, user, counts)));
    return { level, defs, progress };
}
exports.getLevelChallenges = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { level, defs, progress } = await load(uid);
    return {
        level,
        challenges: defs.map((c, i) => ({
            id: c.id,
            title: c.title,
            target: c.target,
            xp: c.xp,
            to: c.to ?? null,
            minLevel: c.minLevel,
            explore: !!c.explore,
            progress: Math.min(c.target, progress[i] ?? 0),
        })),
    };
});
exports.claimLevelChallenge = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { id } = zod_1.z.object({ id: zod_1.z.string().min(1) }).parse(req.data);
    const { defs, progress } = await load(uid);
    const i = defs.findIndex((c) => c.id === id);
    if (i < 0)
        throw new https_1.HttpsError("not-found", "That challenge isn't active.");
    const c = defs[i];
    if ((progress[i] ?? 0) < c.target)
        throw new https_1.HttpsError("failed-precondition", "Not done yet.");
    await stateRef(uid).set({ claimed: { [c.id]: true }, active: economy_1.FieldValue.arrayRemove(c.id) }, { merge: true });
    // "quest" so it also feeds the season pass, like the weekly quests did.
    const res = await (0, xp_1.grantXp)(uid, c.xp, `levelChallenge_${c.id}`, "quest");
    return { ok: true, xp: res.applied ? c.xp : 0, level: res.level };
});
exports.recordChallengeAction = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { action } = zod_1.z.object({ action: zod_1.z.enum(levelChallenges_1.CLIENT_ACTIONS) }).parse(req.data);
    await stateRef(uid).set({ counts: { [action]: economy_1.FieldValue.increment(1) } }, { merge: true });
    // Changing the app color is listed under "Earn XP" on the Levels screen, so it pays the first
    // time whether or not its challenge is one of the three dealt. Same key as claiming the
    // challenge, so it can never pay twice; marking it claimed takes it out of the deck.
    if (action === "theme") {
        const def = (0, levelChallenges_1.challengeById)(levelChallenges_1.THEME_CHALLENGE_ID);
        if (def) {
            const res = await (0, xp_1.grantXp)(uid, def.xp, `levelChallenge_${def.id}`, "quest");
            await stateRef(uid).set({ claimed: { [def.id]: true }, active: economy_1.FieldValue.arrayRemove(def.id) }, { merge: true });
            return { ok: true, xp: res.applied ? def.xp : 0 };
        }
    }
    return { ok: true, xp: 0 };
});
//# sourceMappingURL=levelChallenges.js.map
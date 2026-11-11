"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralInput = exports.syncProgression = exports.checkReferralCode = exports.getReferralCode = exports.referralCodeRef = void 0;
exports.pickFreeCode = pickFreeCode;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const progression_1 = require("../lib/progression");
const xp_1 = require("../lib/xp");
/**
 * Invite codes.
 *
 *  referralCodes/{CODE}          { uid } — one per player, server-written
 *  users/{uid}.referralCode      their code
 *  users/{uid}.referredBy        who invited them (set once, at signup)
 *  users/{uid}.referralCount     how many players joined with their code
 *
 * The bonus itself is paid inside createProfile (callable/profile.ts), in the
 * same transaction that creates the new account, so it can only happen once per
 * new player and never for an account that already existed.
 */
const referralCodeRef = (code) => economy_1.db.collection("referralCodes").doc(code);
exports.referralCodeRef = referralCodeRef;
/** Reads up to five fresh candidates; returns the first unused one (or null). Reads only. */
async function pickFreeCode(tx) {
    const candidates = Array.from({ length: 5 }, () => (0, progression_1.randomReferralCode)());
    const snaps = await Promise.all(candidates.map((c) => tx.get((0, exports.referralCodeRef)(c))));
    const i = snaps.findIndex((s) => !s.exists);
    return i >= 0 ? candidates[i] : null;
}
function referralSummary(user, code) {
    return {
        code,
        referralCount: user.get("referralCount") ?? 0,
        referrerCredits: progression_1.REFERRAL.referrerCredits,
        newUserCredits: progression_1.REFERRAL.newUserCredits,
        maxRewarded: progression_1.REFERRAL.maxRewarded,
        referrerXp: progression_1.XP.referrer,
    };
}
/** The caller's invite code, created on first ask for accounts that predate codes. */
exports.getReferralCode = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        const existing = user.get("referralCode");
        if (existing)
            return referralSummary(user, existing);
        const code = await pickFreeCode(tx);
        if (!code)
            throw new https_1.HttpsError("unavailable", "Couldn't make a code. Try again.");
        tx.set((0, exports.referralCodeRef)(code), { uid, createdAt: economy_1.FieldValue.serverTimestamp() });
        tx.update(userRef, { referralCode: code, updatedAt: economy_1.FieldValue.serverTimestamp() });
        return referralSummary(user, code);
    });
});
/** Signup-form check: is this a real code, and whose? Public fields only. */
exports.checkReferralCode = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const code = (0, progression_1.normalizeReferralCode)(req.data?.code);
    if (!code)
        return { valid: false };
    const snap = await (0, exports.referralCodeRef)(code).get();
    const owner = snap.exists ? snap.get("uid") : null;
    if (!owner || owner === uid)
        return { valid: false };
    const user = await economy_1.db.collection("users").doc(owner).get();
    if (!user.exists)
        return { valid: false };
    return {
        valid: true,
        code,
        uid: owner,
        displayName: user.get("displayName") ?? "A player",
        username: user.get("username") ?? null,
        newUserCredits: progression_1.REFERRAL.newUserCredits,
    };
});
/**
 * Called by the app on open. Brings accounts that predate levels onto the
 * curve (XP seeded from their betting record; no back-paid level credits),
 * grants any level reward they've already earned but don't own, and makes sure
 * they have an invite code. Idempotent.
 */
exports.syncProgression = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        const stored = user.get("xp");
        const stats = user.get("stats") ?? {};
        const xp = typeof stored === "number" ? stored : Math.max(0, (stats.betsWon ?? 0) * progression_1.XP.betWin + (stats.betsPlaced ?? 0) * 5);
        const level = (0, progression_1.levelFromXp)(xp);
        const pending = await (0, xp_1.readLevelUnlocks)(tx, uid, level);
        const needsCode = !user.get("referralCode");
        const code = needsCode ? await pickFreeCode(tx) : user.get("referralCode");
        pending.write();
        const update = {};
        if (typeof stored !== "number")
            update.xp = xp;
        if (user.get("level") !== level)
            update.level = level;
        if (needsCode && code) {
            tx.set((0, exports.referralCodeRef)(code), { uid, createdAt: economy_1.FieldValue.serverTimestamp() });
            update.referralCode = code;
        }
        if (Object.keys(update).length)
            tx.update(userRef, { ...update, updatedAt: economy_1.FieldValue.serverTimestamp() });
        return { ok: true, xp, level, unlocked: pending.unlocks, referralCode: code ?? null };
    });
});
exports.ReferralInput = zod_1.z.string().trim().max(16).optional();
//# sourceMappingURL=referrals.js.map
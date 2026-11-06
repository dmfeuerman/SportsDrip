"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimSeasonTier = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const seasonPass_1 = require("../lib/seasonPass");
const experiments_1 = require("../lib/experiments");
/** Claims one free-track tier the player has reached. Idempotent per tier. */
exports.claimSeasonTier = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z.object({ seasonId: zod_1.z.string().min(1).max(64), tier: zod_1.z.number().int().min(0).max(200) }).parse(req.data);
    const seasonRef = economy_1.db.collection("seasons").doc(input.seasonId);
    const userRef = economy_1.db.collection("users").doc(uid);
    const claimRef = userRef.collection("seasonClaims").doc(`${input.seasonId}_${input.tier}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [season, user, claim, exp] = await Promise.all([
            tx.get(seasonRef),
            tx.get(userRef),
            tx.get(claimRef),
            tx.get(economy_1.db.collection("meta").doc("experiments")),
        ]);
        if (claim.exists)
            return { ok: true, duplicate: true };
        if ((0, experiments_1.assignArm)(exp.exists ? exp.data() : null, experiments_1.EXPERIMENTS.seasonPass, { uid }) === experiments_1.CONTROL) {
            throw new https_1.HttpsError("failed-precondition", "The season pass isn't available yet.");
        }
        if (!season.exists)
            throw new https_1.HttpsError("not-found", "Unknown season.");
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        const def = { ...season.data(), id: season.id };
        (0, seasonPass_1.validateSeason)(def);
        const tier = def.tiers[input.tier];
        if (!tier)
            throw new https_1.HttpsError("not-found", "Unknown tier.");
        const xp = user.get(`seasonXp.${def.id}`) ?? 0;
        if (xp < tier.xp)
            throw new https_1.HttpsError("failed-precondition", "Not reached yet.");
        const item = tier.reward.kind === "item" ? await tx.get(economy_1.db.collection("catalog").doc(tier.reward.id)) : null;
        (0, seasonPass_1.writeSeasonReward)(tx, uid, def.id, input.tier, tier.reward, user.get("balance") ?? 0, item?.get("slot"));
        tx.set(claimRef, { seasonId: def.id, tier: input.tier, at: Date.now() });
        return { ok: true, reward: tier.reward };
    });
});
//# sourceMappingURL=seasonPass.js.map
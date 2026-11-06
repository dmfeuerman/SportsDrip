import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { validateSeason, writeSeasonReward, type SeasonDef } from "../lib/seasonPass";
import { assignArm, CONTROL, EXPERIMENTS, type ExperimentsDoc } from "../lib/experiments";

/** Claims one free-track tier the player has reached. Idempotent per tier. */
export const claimSeasonTier = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z.object({ seasonId: z.string().min(1).max(64), tier: z.number().int().min(0).max(200) }).parse(req.data);
  const seasonRef = db.collection("seasons").doc(input.seasonId);
  const userRef = db.collection("users").doc(uid);
  const claimRef = userRef.collection("seasonClaims").doc(`${input.seasonId}_${input.tier}`);

  return db.runTransaction(async (tx) => {
    const [season, user, claim, exp] = await Promise.all([
      tx.get(seasonRef),
      tx.get(userRef),
      tx.get(claimRef),
      tx.get(db.collection("meta").doc("experiments")),
    ]);
    if (claim.exists) return { ok: true, duplicate: true };
    if (assignArm(exp.exists ? (exp.data() as ExperimentsDoc) : null, EXPERIMENTS.seasonPass, { uid }) === CONTROL) {
      throw new HttpsError("failed-precondition", "The season pass isn't available yet.");
    }
    if (!season.exists) throw new HttpsError("not-found", "Unknown season.");
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const def = { ...(season.data() as Omit<SeasonDef, "id">), id: season.id };
    validateSeason(def);
    const tier = def.tiers[input.tier];
    if (!tier) throw new HttpsError("not-found", "Unknown tier.");
    const xp = (user.get(`seasonXp.${def.id}`) as number | undefined) ?? 0;
    if (xp < tier.xp) throw new HttpsError("failed-precondition", "Not reached yet.");
    const item = tier.reward.kind === "item" ? await tx.get(db.collection("catalog").doc(tier.reward.id)) : null;

    writeSeasonReward(tx, uid, def.id, input.tier, tier.reward, (user.get("balance") as number) ?? 0, item?.get("slot"));
    tx.set(claimRef, { seasonId: def.id, tier: input.tier, at: Date.now() });
    return { ok: true, reward: tier.reward };
  });
});

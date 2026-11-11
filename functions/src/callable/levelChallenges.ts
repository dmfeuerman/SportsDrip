import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { grantXp } from "../lib/xp";
import { levelFromXp } from "../lib/progression";
import {
  challengeById,
  CLIENT_ACTIONS,
  THEME_CHALLENGE_ID,
  dealChallenges,
  type ChallengeDef,
  type ChallengeMetric,
} from "../lib/levelChallenges";

/**
 * Level challenges (lib/levelChallenges.ts). State lives at
 * users/{uid}/levelChallenges/state: { active: id[], claimed: {id: true}, counts: {action: n} }.
 * Progress is lifetime and counted on the server, except the few app-only
 * actions in CLIENT_ACTIONS, which the app reports.
 */

const stateRef = (uid: string) => db.collection("users").doc(uid).collection("levelChallenges").doc("state");

async function count(q: FirebaseFirestore.Query): Promise<number> {
  try {
    return (await q.count().get()).data().count;
  } catch {
    return 0;
  }
}

async function metricValue(uid: string, m: ChallengeMetric, user: FirebaseFirestore.DocumentSnapshot, counts: Record<string, number>): Promise<number> {
  const userRef = db.collection("users").doc(uid);
  switch (m) {
    case "bets":
      return count(db.collection("bets").where("uid", "==", uid));
    case "wins":
      return count(db.collection("bets").where("uid", "==", uid).where("status", "==", "won"));
    case "parlays":
      return count(db.collection("slipParlays").where("uid", "==", uid));
    case "friends":
      return count(db.collection("friendships").where("users", "array-contains", uid));
    case "leagues":
      return count(db.collection("leagues").where("memberIds", "array-contains", uid));
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
      return ((user.get("favoriteTeams") as unknown[] | undefined) ?? []).length;
    case "scene":
      return user.get("background") ? 1 : 0;
    default:
      return counts[m] ?? 0;
  }
}

async function load(uid: string) {
  const [user, state] = await Promise.all([db.collection("users").doc(uid).get(), stateRef(uid).get()]);
  if (!user.exists) throw new HttpsError("not-found", "Profile not found.");
  const level = levelFromXp(user.get("xp"));
  const claimed = (state.get("claimed") as Record<string, boolean> | undefined) ?? {};
  const counts = (state.get("counts") as Record<string, number> | undefined) ?? {};
  const before = (state.get("active") as string[] | undefined) ?? [];
  const active = dealChallenges(before, claimed, level);
  if (active.join(",") !== before.join(",")) await stateRef(uid).set({ active }, { merge: true });
  const defs = active.map((id) => challengeById(id)).filter((c): c is ChallengeDef => !!c);
  const progress = await Promise.all(defs.map((c) => metricValue(uid, c.metric, user, counts)));
  return { level, defs, progress };
}

export const getLevelChallenges = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
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

export const claimLevelChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { id } = z.object({ id: z.string().min(1) }).parse(req.data);
  const { defs, progress } = await load(uid);
  const i = defs.findIndex((c) => c.id === id);
  if (i < 0) throw new HttpsError("not-found", "That challenge isn't active.");
  const c = defs[i]!;
  if ((progress[i] ?? 0) < c.target) throw new HttpsError("failed-precondition", "Not done yet.");
  await stateRef(uid).set({ claimed: { [c.id]: true }, active: FieldValue.arrayRemove(c.id) }, { merge: true });
  // "quest" so it also feeds the season pass, like the weekly quests did.
  const res = await grantXp(uid, c.xp, `levelChallenge_${c.id}`, "quest");
  return { ok: true as const, xp: res.applied ? c.xp : 0, level: res.level };
});

export const recordChallengeAction = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { action } = z.object({ action: z.enum(CLIENT_ACTIONS) }).parse(req.data);
  await stateRef(uid).set({ counts: { [action]: FieldValue.increment(1) } }, { merge: true });
  // Changing the app color is listed under "Earn XP" on the Levels screen, so it pays the first
  // time whether or not its challenge is one of the three dealt. Same key as claiming the
  // challenge, so it can never pay twice; marking it claimed takes it out of the deck.
  if (action === "theme") {
    const def = challengeById(THEME_CHALLENGE_ID);
    if (def) {
      const res = await grantXp(uid, def.xp, `levelChallenge_${def.id}`, "quest");
      await stateRef(uid).set({ claimed: { [def.id]: true }, active: FieldValue.arrayRemove(def.id) }, { merge: true });
      return { ok: true as const, xp: res.applied ? def.xp : 0 };
    }
  }
  return { ok: true as const, xp: 0 };
});

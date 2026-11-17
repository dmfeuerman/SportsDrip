import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { grantXp } from "../lib/xp";
import { playerLevel } from "../lib/progression";
import {
  levelSet,
  CLIENT_ACTIONS,
  type ChallengeMetric,
} from "../lib/levelChallenges";

/**
 * Level challenges (lib/levelChallenges.ts). State lives at
 * users/{uid}/levelChallenges/state: { setLevel, active: id[] (this level's set, claimed ones
 * included), claimed: {id: true}, counts: {action: n} }.
 * Progress is lifetime and counted on the server, except the few app-only
 * actions in CLIENT_ACTIONS, which the app reports.
 */

/** Bumped when the set format changes, so old states re-deal with a baseline. */
const SET_VERSION = 2;

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
    case "boxes":
      return count(userRef.collection("ledger").where("type", "==", "prize_box"));
    case "videos":
      return count(userRef.collection("ledger").where("type", "==", "ad_reward"));
    case "referrals":
      return (user.get("referralCount") as number | undefined) ?? 0;
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
  const level = playerLevel(user);
  const claimed = (state.get("claimed") as Record<string, boolean> | undefined) ?? {};
  const counts = (state.get("counts") as Record<string, number> | undefined) ?? {};
  // The whole set for this level, completed ones included.
  const defs = levelSet(level);
  // One read per metric, shared by every challenge on it.
  const metrics = [...new Set(defs.map((c) => c.metric))];
  const values = new Map(await Promise.all(metrics.map(async (m) => [m, await metricValue(uid, m, user, counts)] as const)));
  // Level goals count from where the player stood when the level's set was dealt.
  let base = (state.get("base") as Record<string, number> | undefined) ?? {};
  if (state.get("setLevel") !== level || state.get("v") !== SET_VERSION) {
    base = Object.fromEntries(metrics.map((m) => [m, values.get(m) ?? 0]));
    await stateRef(uid).set({ setLevel: level, v: SET_VERSION, base, active: defs.map((c) => c.id) }, { merge: true });
  }
  const progress = defs.map((c) => Math.max(0, (values.get(c.metric) ?? 0) - (c.explore || c.lifetime ? 0 : base[c.metric] ?? 0)));
  return { level, defs, progress, claimed };
}

export const getLevelChallenges = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  await autoClaimChallenges(uid).catch(() => 0);
  const { level, defs, progress, claimed } = await load(uid);
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
      claimed: !!claimed[c.id],
    })),
  };
});

/**
 * Pays every finished, unclaimed challenge in the player's current set. Run
 * after anything that can move a challenge (bets, wins, boxes, purchases,
 * friends, app actions) and on every load, so XP lands on its own — the app's
 * XP popup shows each one. Safe to run concurrently: each challenge is marked
 * claimed first and paid under its own idempotent key.
 */
export async function autoClaimChallenges(uid: string): Promise<number> {
  let paid = 0;
  // A payout can level the player up, which deals a new set that may already be partly done.
  for (let round = 0; round < 3; round++) {
    const { defs, progress, claimed } = await load(uid);
    const done = defs.filter((c, i) => !claimed[c.id] && (progress[i] ?? 0) >= c.target);
    if (!done.length) break;
    await stateRef(uid).set({ claimed: Object.fromEntries(done.map((c) => [c.id, true])) }, { merge: true });
    for (const c of done) {
      // "quest" so it also feeds the season pass.
      const res = await grantXp(uid, c.xp, `levelChallenge_${c.id}`, "quest", c.title);
      if (res.applied) paid++;
    }
  }
  return paid;
}

/** Best-effort wrapper for triggers. */
export function autoClaimSoon(uid: string | undefined | null): Promise<void> {
  if (!uid) return Promise.resolve();
  return autoClaimChallenges(uid).then(
    () => undefined,
    () => undefined
  );
}

/** Kept for older app builds: claims everything that's finished. */
export const claimLevelChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  z.object({ id: z.string().min(1) }).parse(req.data);
  await autoClaimChallenges(uid);
  const { level } = await load(uid);
  return { ok: true as const, xp: 0, level };
});

export const recordChallengeAction = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { action } = z.object({ action: z.enum(CLIENT_ACTIONS) }).parse(req.data);
  await stateRef(uid).set({ counts: { [action]: FieldValue.increment(1) } }, { merge: true });
  await autoClaimChallenges(uid).catch(() => 0);
  return { ok: true as const, xp: 0 };
});

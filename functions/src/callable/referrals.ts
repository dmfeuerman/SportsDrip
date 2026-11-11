import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, requireAuth, type Tx } from "../lib/economy";
import { levelFromXp, normalizeReferralCode, randomReferralCode, REFERRAL, XP } from "../lib/progression";
import { readLevelUnlocks } from "../lib/xp";

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

export const referralCodeRef = (code: string) => db.collection("referralCodes").doc(code);

/** Reads up to five fresh candidates; returns the first unused one (or null). Reads only. */
export async function pickFreeCode(tx: Tx): Promise<string | null> {
  const candidates = Array.from({ length: 5 }, () => randomReferralCode());
  const snaps = await Promise.all(candidates.map((c) => tx.get(referralCodeRef(c))));
  const i = snaps.findIndex((s) => !s.exists);
  return i >= 0 ? candidates[i]! : null;
}

function referralSummary(user: FirebaseFirestore.DocumentSnapshot, code: string) {
  return {
    code,
    referralCount: (user.get("referralCount") as number | undefined) ?? 0,
    referrerCredits: REFERRAL.referrerCredits,
    newUserCredits: REFERRAL.newUserCredits,
    maxRewarded: REFERRAL.maxRewarded,
    referrerXp: XP.referrer,
  };
}

/** The caller's invite code, created on first ask for accounts that predate codes. */
export const getReferralCode = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const existing = user.get("referralCode") as string | undefined;
    if (existing) return referralSummary(user, existing);
    const code = await pickFreeCode(tx);
    if (!code) throw new HttpsError("unavailable", "Couldn't make a code. Try again.");
    tx.set(referralCodeRef(code), { uid, createdAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { referralCode: code, updatedAt: FieldValue.serverTimestamp() });
    return referralSummary(user, code);
  });
});

/** Signup-form check: is this a real code, and whose? Public fields only. */
export const checkReferralCode = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const code = normalizeReferralCode(req.data?.code);
  if (!code) return { valid: false as const };
  const snap = await referralCodeRef(code).get();
  const owner = snap.exists ? (snap.get("uid") as string) : null;
  if (!owner || owner === uid) return { valid: false as const };
  const user = await db.collection("users").doc(owner).get();
  if (!user.exists) return { valid: false as const };
  return {
    valid: true as const,
    code,
    uid: owner,
    displayName: (user.get("displayName") as string) ?? "A player",
    username: (user.get("username") as string) ?? null,
    newUserCredits: REFERRAL.newUserCredits,
  };
});

/**
 * Called by the app on open. Brings accounts that predate levels onto the
 * curve (XP seeded from their betting record; no back-paid level credits),
 * grants any level reward they've already earned but don't own, and makes sure
 * they have an invite code. Idempotent.
 */
export const syncProgression = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const stored = user.get("xp") as number | undefined;
    const stats = (user.get("stats") as { betsWon?: number; betsPlaced?: number } | undefined) ?? {};
    const xp = typeof stored === "number" ? stored : Math.max(0, (stats.betsWon ?? 0) * XP.betWin + (stats.betsPlaced ?? 0) * 5);
    const level = levelFromXp(xp);
    const pending = await readLevelUnlocks(tx, uid, level);
    const needsCode = !user.get("referralCode");
    const code = needsCode ? await pickFreeCode(tx) : (user.get("referralCode") as string);

    pending.write();
    const update: Record<string, unknown> = {};
    if (typeof stored !== "number") update.xp = xp;
    if (user.get("level") !== level) update.level = level;
    if (needsCode && code) {
      tx.set(referralCodeRef(code), { uid, createdAt: FieldValue.serverTimestamp() });
      update.referralCode = code;
    }
    if (Object.keys(update).length) tx.update(userRef, { ...update, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true as const, xp, level, unlocked: pending.unlocks, referralCode: code ?? null };
  });
});

export const ReferralInput = z.string().trim().max(16).optional();

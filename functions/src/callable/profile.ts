import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  db,
  FieldValue,
  STARTING_BALANCE,
  STARTER_ITEMS,
  pairId,
  requireAuth,
} from "../lib/economy";
import { DEFAULT_AVATAR } from "../lib/avatarRules";
import { AvatarSchema } from "./avatar";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { normalizeReferralCode, REFERRAL, XP } from "../lib/progression";
import { grantXp } from "../lib/xp";
import { pickFreeCode, ReferralInput, referralCodeRef } from "./referrals";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const CreateProfileInput = z.object({
  username: z.string().trim().toLowerCase(),
  displayName: z.string().trim().min(1).max(30),
  avatar: AvatarSchema.optional(),
  age: z.number().int().min(13).max(120).optional(),
  birthDate: z.string().trim().max(20).optional(),
  phoneNumber: z.string().trim().max(24).optional(),
  /** A friend's invite code (callable/referrals.ts). Optional; an unknown code is rejected so it can be fixed. */
  referralCode: ReferralInput,
});

/**
 * Creates users/{uid} exactly once, claims the username atomically, grants the
 * starting balance and starter outfit, and writes the opening ledger entry.
 *
 * Fixes B4 (no profile documents ever existed) and B3 (nothing to read a real
 * display name from). Callable, so the client cannot set its own balance (S2).
 */
export const createProfile = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = CreateProfileInput.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid profile.");
  }
  const input = parsed.data;

  if (!USERNAME_RE.test(input.username)) {
    throw new HttpsError(
      "invalid-argument",
      "Usernames are 3–20 characters: lowercase letters, numbers and underscores."
    );
  }

  const userRef = db.collection("users").doc(uid);
  const nameRef = db.collection("usernames").doc(input.username);

  const inviteCode = input.referralCode ? normalizeReferralCode(input.referralCode) : null;
  if (input.referralCode && input.referralCode.trim() && !inviteCode) {
    throw new HttpsError("invalid-argument", "That invite code isn't valid.");
  }

  const referral = await db.runTransaction(async (tx) => {
    const [userSnap, nameSnap, codeSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(nameRef),
      inviteCode ? tx.get(referralCodeRef(inviteCode)) : Promise.resolve(null),
    ]);

    if (userSnap.exists) throw new HttpsError("already-exists", "Profile already created.");
    if (nameSnap.exists) throw new HttpsError("already-exists", "That username is taken.");

    // ── invite code ──
    const referrerUid = codeSnap?.exists ? (codeSnap.get("uid") as string) : null;
    if (inviteCode && (!referrerUid || referrerUid === uid)) {
      throw new HttpsError("invalid-argument", "That invite code isn't valid.");
    }
    const referrerRef = referrerUid ? db.collection("users").doc(referrerUid) : null;
    const referrer = referrerRef ? await tx.get(referrerRef) : null;
    if (referrerRef && !referrer?.exists) throw new HttpsError("invalid-argument", "That invite code isn't valid.");
    const myCode = await pickFreeCode(tx);

    const referralCount = (referrer?.get("referralCount") as number | undefined) ?? 0;
    const referrerPaid = !!referrer && referralCount < REFERRAL.maxRewarded;
    const welcomeBonus = referrer ? REFERRAL.newUserCredits : 0;
    const openingBalance = STARTING_BALANCE + welcomeBonus;

    tx.set(nameRef, { uid, createdAt: FieldValue.serverTimestamp() });
    if (myCode) tx.set(referralCodeRef(myCode), { uid, createdAt: FieldValue.serverTimestamp() });

    // Email and phone live in the owner-only private subdoc. users/{uid} is readable by
    // every signed-in user so friend lists and standings can render, which
    // made every account's email address public.
    tx.set(userRef.collection("private").doc("contact"), {
      email: req.auth?.token.email ?? null,
      phoneNumber: input.phoneNumber ?? null,
      birthDate: input.birthDate ?? null,
      age: input.age ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      uid,
      username: input.username,
      displayName: input.displayName,
      balance: openingBalance,
      avatar: input.avatar ?? DEFAULT_AVATAR,
      xp: 0,
      level: 1,
      ...(myCode ? { referralCode: myCode } : {}),
      ...(referrerUid ? { referredBy: referrerUid } : {}),
      ...(input.age != null ? { age: input.age } : {}),
      // Nothing worn at signup: the starter kit lands in the inventory to put on
      // (or not) from the wardrobe.
      equipped: {},
      stats: { betsPlaced: 0, betsWon: 0, betsLost: 0, betsPush: 0, creditsWon: 0, creditsStaked: 0 },
      onboarded: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    for (const itemId of STARTER_ITEMS) {
      tx.set(userRef.collection("inventory").doc(itemId), {
        itemId,
        source: "starter",
        acquiredAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(userRef.collection("ledger").doc(`signup_${uid}`), {
      type: "signup_grant",
      delta: STARTING_BALANCE,
      balanceAfter: STARTING_BALANCE,
      ref: null,
      note: "Welcome grant",
      createdAt: FieldValue.serverTimestamp(),
    });

    if (!referrer || !referrerRef || !referrerUid) return null;

    // Joined with a friend's code: a welcome bonus, the friend's bonus, and
    // they start out as friends.
    tx.set(userRef.collection("ledger").doc(`referral_${uid}`), {
      type: "referral_bonus",
      delta: welcomeBonus,
      balanceAfter: openingBalance,
      ref: referrerUid,
      note: "Invite code bonus",
      createdAt: FieldValue.serverTimestamp(),
    });
    const referrerBalance = ((referrer.get("balance") as number | undefined) ?? 0) + (referrerPaid ? REFERRAL.referrerCredits : 0);
    tx.update(referrerRef, {
      referralCount: referralCount + 1,
      ...(referrerPaid ? { balance: referrerBalance } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (referrerPaid) {
      tx.set(referrerRef.collection("ledger").doc(`referral_${uid}`), {
        type: "referral_bonus",
        delta: REFERRAL.referrerCredits,
        balanceAfter: referrerBalance,
        ref: uid,
        note: `@${input.username} joined with your code`,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection("friendships").doc(pairId(uid, referrerUid)), {
      users: [uid, referrerUid].sort(),
      via: "referral",
      createdAt: FieldValue.serverTimestamp(),
    });
    writeNotification(
      tx,
      referrerUid,
      simpleNotification({
        id: `referral_${uid}`,
        type: "referral_bonus",
        title: `${input.displayName} joined with your invite code`,
        body: referrerPaid
          ? `+${REFERRAL.referrerCredits.toLocaleString("en-US")} credits and ${XP.referrer} XP. You're friends now.`
          : `+${XP.referrer} XP. You're friends now.`,
        now: Date.now(),
        delta: referrerPaid ? REFERRAL.referrerCredits : 0,
        balanceAfter: referrerPaid ? referrerBalance : null,
        popup: true,
        data: { fromUid: uid },
      })
    );
    return { referrerUid };
  });

  // XP after the account exists; separate transactions, idempotent by key.
  if (referral) {
    await Promise.all([
      grantXp(referral.referrerUid, XP.referrer, `referral_${uid}`, "referral"),
      grantXp(uid, XP.referred, "referred", "joined_with_code"),
    ]).catch(() => undefined);
  }

  return { ok: true, username: input.username, referred: !!referral };
});

/** Availability check for the signup form. Cheap, read-only. */
export const checkUsername = onCall({ region: "us-central1" }, async (req) => {
  const raw = z.string().trim().toLowerCase().parse(req.data?.username);
  if (!USERNAME_RE.test(raw)) return { available: false, reason: "invalid" as const };
  const snap = await db.collection("usernames").doc(raw).get();
  return { available: !snap.exists, reason: snap.exists ? ("taken" as const) : null };
});

/**
 * Appearance-only write (onboarding, older clients). Rules deny direct client
 * writes to users/{uid}, so this and saveAppearance are the only paths that
 * change the avatar — balance, stats and inventory stay out of reach (S2).
 */
export const updateAvatar = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = AvatarSchema.safeParse(req.data?.avatar);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid appearance.");
  const avatar = parsed.data;
  await db.collection("users").doc(uid).update({
    avatar,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * Username prefix search. Returns public fields only.
 *
 * Firestore has no substring search; this is a `>=` / `<= \uf8ff` prefix range,
 * which is the correct primitive here. If fuzzy search becomes a requirement,
 * move to Algolia or Typesense rather than fanning out reads.
 */
export const searchUsers = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const q = z.string().trim().toLowerCase().min(2).max(20).parse(req.data?.q);

  const snap = await db
    .collection("users")
    .orderBy("username")
    .startAt(q)
    .endAt(q + "\uf8ff")
    .limit(20)
    .get();

  return {
    results: snap.docs
      .filter((d) => d.id !== me)
      .map((d) => ({
        uid: d.id,
        username: d.get("username") as string,
        displayName: d.get("displayName") as string,
        avatar: d.get("avatar"),
        equipped: d.get("equipped"),
      })),
  };
});

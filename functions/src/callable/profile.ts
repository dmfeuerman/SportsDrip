import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  db,
  FieldValue,
  STARTING_BALANCE,
  STARTER_ITEMS,
  requireAuth,
} from "../lib/economy";
import { DEFAULT_AVATAR } from "../lib/avatarRules";
import { AvatarSchema } from "./avatar";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const CreateProfileInput = z.object({
  username: z.string().trim().toLowerCase(),
  displayName: z.string().trim().min(1).max(30),
  avatar: AvatarSchema.optional(),
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

  await db.runTransaction(async (tx) => {
    const [userSnap, nameSnap] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);

    if (userSnap.exists) throw new HttpsError("already-exists", "Profile already created.");
    if (nameSnap.exists) throw new HttpsError("already-exists", "That username is taken.");

    tx.set(nameRef, { uid, createdAt: FieldValue.serverTimestamp() });

    // Email lives in the owner-only private subdoc. users/{uid} is readable by
    // every signed-in user so friend lists and standings can render, which
    // made every account's email address public.
    tx.set(userRef.collection("private").doc("contact"), {
      email: req.auth?.token.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      uid,
      username: input.username,
      displayName: input.displayName,
      balance: STARTING_BALANCE,
      avatar: input.avatar ?? DEFAULT_AVATAR,
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
  });

  return { ok: true, username: input.username };
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

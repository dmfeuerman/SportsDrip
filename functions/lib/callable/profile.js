"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchUsers = exports.updateAvatar = exports.checkUsername = exports.createProfile = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const CreateProfileInput = zod_1.z.object({
    username: zod_1.z.string().trim().toLowerCase(),
    displayName: zod_1.z.string().trim().min(1).max(30),
    avatar: zod_1.z
        .object({
        height: zod_1.z.number().min(0).max(1).default(0.5),
        bodyType: zod_1.z.number().min(0).max(1).default(0.5),
        skinTone: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
        hairStyle: zod_1.z.string().max(40),
        hairColor: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
        faceShape: zod_1.z.string().max(40).optional(),
        eyeColor: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        eyebrows: zod_1.z.string().max(40).optional(),
    })
        .optional(),
});
/**
 * Creates users/{uid} exactly once, claims the username atomically, grants the
 * starting balance and starter outfit, and writes the opening ledger entry.
 *
 * Fixes B4 (no profile documents ever existed) and B3 (nothing to read a real
 * display name from). Callable, so the client cannot set its own balance (S2).
 */
exports.createProfile = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = CreateProfileInput.parse(req.data);
    if (!USERNAME_RE.test(input.username)) {
        throw new https_1.HttpsError("invalid-argument", "Usernames are 3–20 characters: lowercase letters, numbers and underscores.");
    }
    const userRef = economy_1.db.collection("users").doc(uid);
    const nameRef = economy_1.db.collection("usernames").doc(input.username);
    await economy_1.db.runTransaction(async (tx) => {
        const [userSnap, nameSnap] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
        if (userSnap.exists)
            throw new https_1.HttpsError("already-exists", "Profile already created.");
        if (nameSnap.exists)
            throw new https_1.HttpsError("already-exists", "That username is taken.");
        tx.set(nameRef, { uid, createdAt: economy_1.FieldValue.serverTimestamp() });
        tx.set(userRef, {
            uid,
            email: req.auth?.token.email ?? null,
            username: input.username,
            displayName: input.displayName,
            balance: economy_1.STARTING_BALANCE,
            avatar: input.avatar ?? {
                height: 0.5,
                bodyType: 0.5,
                skinTone: "#C68642",
                hairStyle: "short_crop",
                hairColor: "#2B1B12",
            },
            equipped: {
                top: "tee_basic_white",
                bottom: "shorts_basic_navy",
                shoes: "shoes_basic_white",
            },
            stats: { betsPlaced: 0, betsWon: 0, betsLost: 0, betsPush: 0, creditsWon: 0, creditsStaked: 0 },
            onboarded: true,
            createdAt: economy_1.FieldValue.serverTimestamp(),
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        for (const itemId of economy_1.STARTER_ITEMS) {
            tx.set(userRef.collection("inventory").doc(itemId), {
                itemId,
                source: "starter",
                acquiredAt: economy_1.FieldValue.serverTimestamp(),
            });
        }
        tx.set(userRef.collection("ledger").doc(`signup_${uid}`), {
            type: "signup_grant",
            delta: economy_1.STARTING_BALANCE,
            balanceAfter: economy_1.STARTING_BALANCE,
            ref: null,
            note: "Welcome grant",
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
    });
    return { ok: true, username: input.username };
});
/** Availability check for the signup form. Cheap, read-only. */
exports.checkUsername = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const raw = zod_1.z.string().trim().toLowerCase().parse(req.data?.username);
    if (!USERNAME_RE.test(raw))
        return { available: false, reason: "invalid" };
    const snap = await economy_1.db.collection("usernames").doc(raw).get();
    return { available: !snap.exists, reason: snap.exists ? "taken" : null };
});
const AvatarInput = CreateProfileInput.shape.avatar.unwrap();
/**
 * Appearance-only write. Rules deny direct client writes to users/{uid}, so
 * this is the single path that can change the avatar — which keeps balance,
 * stats and inventory out of reach of a crafted update (S2).
 */
exports.updateAvatar = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const avatar = AvatarInput.parse(req.data?.avatar);
    await economy_1.db.collection("users").doc(uid).update({
        avatar,
        updatedAt: economy_1.FieldValue.serverTimestamp(),
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
exports.searchUsers = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const q = zod_1.z.string().trim().toLowerCase().min(2).max(20).parse(req.data?.q);
    const snap = await economy_1.db
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
            username: d.get("username"),
            displayName: d.get("displayName"),
            avatar: d.get("avatar"),
            equipped: d.get("equipped"),
        })),
    };
});
//# sourceMappingURL=profile.js.map
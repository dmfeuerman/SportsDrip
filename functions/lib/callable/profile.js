"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchUsers = exports.updateAvatar = exports.checkUsername = exports.createProfile = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const avatarRules_1 = require("../lib/avatarRules");
const avatar_1 = require("./avatar");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const progression_1 = require("../lib/progression");
const xp_1 = require("../lib/xp");
const referrals_1 = require("./referrals");
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const CreateProfileInput = zod_1.z.object({
    username: zod_1.z.string().trim().toLowerCase(),
    displayName: zod_1.z.string().trim().min(1).max(30),
    avatar: avatar_1.AvatarSchema.optional(),
    age: zod_1.z.number().int().min(13).max(120).optional(),
    birthDate: zod_1.z.string().trim().max(20).optional(),
    phoneNumber: zod_1.z.string().trim().max(24).optional(),
    /** A friend's invite code (callable/referrals.ts). Optional; an unknown code is rejected so it can be fixed. */
    referralCode: referrals_1.ReferralInput,
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
    const parsed = CreateProfileInput.safeParse(req.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid profile.");
    }
    const input = parsed.data;
    if (!USERNAME_RE.test(input.username)) {
        throw new https_1.HttpsError("invalid-argument", "Usernames are 3–20 characters: lowercase letters, numbers and underscores.");
    }
    const userRef = economy_1.db.collection("users").doc(uid);
    const nameRef = economy_1.db.collection("usernames").doc(input.username);
    const inviteCode = input.referralCode ? (0, progression_1.normalizeReferralCode)(input.referralCode) : null;
    if (input.referralCode && input.referralCode.trim() && !inviteCode) {
        throw new https_1.HttpsError("invalid-argument", "That invite code isn't valid.");
    }
    const referral = await economy_1.db.runTransaction(async (tx) => {
        const [userSnap, nameSnap, codeSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(nameRef),
            inviteCode ? tx.get((0, referrals_1.referralCodeRef)(inviteCode)) : Promise.resolve(null),
        ]);
        if (userSnap.exists)
            throw new https_1.HttpsError("already-exists", "Profile already created.");
        if (nameSnap.exists)
            throw new https_1.HttpsError("already-exists", "That username is taken.");
        // ── invite code ──
        const referrerUid = codeSnap?.exists ? codeSnap.get("uid") : null;
        if (inviteCode && (!referrerUid || referrerUid === uid)) {
            throw new https_1.HttpsError("invalid-argument", "That invite code isn't valid.");
        }
        const referrerRef = referrerUid ? economy_1.db.collection("users").doc(referrerUid) : null;
        const referrer = referrerRef ? await tx.get(referrerRef) : null;
        if (referrerRef && !referrer?.exists)
            throw new https_1.HttpsError("invalid-argument", "That invite code isn't valid.");
        const myCode = await (0, referrals_1.pickFreeCode)(tx);
        const referralCount = referrer?.get("referralCount") ?? 0;
        const referrerPaid = !!referrer && referralCount < progression_1.REFERRAL.maxRewarded;
        const welcomeBonus = referrer ? progression_1.REFERRAL.newUserCredits : 0;
        const openingBalance = economy_1.STARTING_BALANCE + welcomeBonus;
        tx.set(nameRef, { uid, createdAt: economy_1.FieldValue.serverTimestamp() });
        if (myCode)
            tx.set((0, referrals_1.referralCodeRef)(myCode), { uid, createdAt: economy_1.FieldValue.serverTimestamp() });
        // Email and phone live in the owner-only private subdoc. users/{uid} is readable by
        // every signed-in user so friend lists and standings can render, which
        // made every account's email address public.
        tx.set(userRef.collection("private").doc("contact"), {
            email: req.auth?.token.email ?? null,
            phoneNumber: input.phoneNumber ?? null,
            birthDate: input.birthDate ?? null,
            age: input.age ?? null,
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
        tx.set(userRef, {
            uid,
            username: input.username,
            displayName: input.displayName,
            balance: openingBalance,
            avatar: input.avatar ?? avatarRules_1.DEFAULT_AVATAR,
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
        if (!referrer || !referrerRef || !referrerUid)
            return null;
        // Joined with a friend's code: a welcome bonus, the friend's bonus, and
        // they start out as friends.
        tx.set(userRef.collection("ledger").doc(`referral_${uid}`), {
            type: "referral_bonus",
            delta: welcomeBonus,
            balanceAfter: openingBalance,
            ref: referrerUid,
            note: "Invite code bonus",
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
        const referrerBalance = (referrer.get("balance") ?? 0) + (referrerPaid ? progression_1.REFERRAL.referrerCredits : 0);
        tx.update(referrerRef, {
            referralCount: referralCount + 1,
            ...(referrerPaid ? { balance: referrerBalance } : {}),
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        if (referrerPaid) {
            tx.set(referrerRef.collection("ledger").doc(`referral_${uid}`), {
                type: "referral_bonus",
                delta: progression_1.REFERRAL.referrerCredits,
                balanceAfter: referrerBalance,
                ref: uid,
                note: `@${input.username} joined with your code`,
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
        }
        tx.set(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(uid, referrerUid)), {
            users: [uid, referrerUid].sort(),
            via: "referral",
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
        (0, notify_1.writeNotification)(tx, referrerUid, (0, notifyModel_1.simpleNotification)({
            id: `referral_${uid}`,
            type: "referral_bonus",
            title: `${input.displayName} joined with your invite code`,
            body: referrerPaid
                ? `+${progression_1.REFERRAL.referrerCredits.toLocaleString("en-US")} credits and ${progression_1.XP.referrer} XP. You're friends now.`
                : `+${progression_1.XP.referrer} XP. You're friends now.`,
            now: Date.now(),
            delta: referrerPaid ? progression_1.REFERRAL.referrerCredits : 0,
            balanceAfter: referrerPaid ? referrerBalance : null,
            popup: true,
            data: { fromUid: uid },
        }));
        return { referrerUid };
    });
    // XP after the account exists; separate transactions, idempotent by key.
    if (referral) {
        await Promise.all([
            (0, xp_1.grantXp)(referral.referrerUid, progression_1.XP.referrer, `referral_${uid}`, "referral"),
            (0, xp_1.grantXp)(uid, progression_1.XP.referred, "referred", "joined_with_code"),
        ]).catch(() => undefined);
    }
    return { ok: true, username: input.username, referred: !!referral };
});
/** Availability check for the signup form. Cheap, read-only. */
exports.checkUsername = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const raw = zod_1.z.string().trim().toLowerCase().parse(req.data?.username);
    if (!USERNAME_RE.test(raw))
        return { available: false, reason: "invalid" };
    const snap = await economy_1.db.collection("usernames").doc(raw).get();
    return { available: !snap.exists, reason: snap.exists ? "taken" : null };
});
/**
 * Appearance-only write (onboarding, older clients). Rules deny direct client
 * writes to users/{uid}, so this and saveAppearance are the only paths that
 * change the avatar — balance, stats and inventory stay out of reach (S2).
 */
exports.updateAvatar = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = avatar_1.AvatarSchema.safeParse(req.data?.avatar);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid appearance.");
    const avatar = parsed.data;
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
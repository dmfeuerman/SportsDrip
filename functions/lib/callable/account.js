"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccount = exports.acceptTerms = exports.reportContent = exports.unblockUser = exports.blockUser = exports.blockRef = void 0;
exports.blockedEitherWay = blockedEitherWay;
exports.deletionBlockers = deletionBlockers;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const legal_1 = require("../lib/legal");
const birthdays_1 = require("../scheduled/birthdays");
/**
 * Account-level actions App Review requires: delete account (5.1.1(v)) and
 * the user-generated-content tools (1.2): block, report, accept terms.
 */
const blockRef = (owner, other) => economy_1.db.collection("users").doc(owner).collection("blocks").doc(other);
exports.blockRef = blockRef;
/** True if either player has blocked the other. */
async function blockedEitherWay(a, b) {
    const [x, y] = await Promise.all([(0, exports.blockRef)(a, b).get(), (0, exports.blockRef)(b, a).get()]);
    return x.exists || y.exists;
}
const OtherUid = zod_1.z.object({ otherUid: zod_1.z.string().min(1).max(128) });
/** Blocks a player: hides their messages, unfriends, and stops DMs and friend requests both ways. */
exports.blockUser = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { otherUid } = OtherUid.parse(req.data);
    if (otherUid === me)
        throw new https_1.HttpsError("invalid-argument", "You can't block yourself.");
    const batch = economy_1.db.batch();
    batch.set((0, exports.blockRef)(me, otherUid), { uid: otherUid, at: Date.now() });
    batch.delete(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, otherUid)));
    batch.delete(economy_1.db.collection("friendRequests").doc(`${me}_${otherUid}`));
    batch.delete(economy_1.db.collection("friendRequests").doc(`${otherUid}_${me}`));
    await batch.commit();
    return { ok: true };
});
exports.unblockUser = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { otherUid } = OtherUid.parse(req.data);
    await (0, exports.blockRef)(me, otherUid).delete();
    return { ok: true };
});
const ReportInput = zod_1.z.object({
    kind: zod_1.z.enum(["user", "league_message", "dm", "bet_comment"]),
    targetUid: zod_1.z.string().min(1).max(128),
    reason: zod_1.z.enum(["harassment", "hate", "sexual", "spam", "threat", "other"]),
    /** The reported item: leagues/{id}/messages/{id}, directMessages/{t}/messages/{id}, betComments/{b}/comments/{id}. */
    path: zod_1.z.string().max(300).optional(),
    text: zod_1.z.string().max(600).optional(),
    details: zod_1.z.string().max(500).optional(),
});
/**
 * Files a report into reports/{id} (server-only; review it in the Firebase
 * console or an admin tool — App Review expects action within 24 hours).
 */
exports.reportContent = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const input = ReportInput.parse(req.data);
    if (input.targetUid === me)
        throw new https_1.HttpsError("invalid-argument", "You can't report yourself.");
    const ref = economy_1.db.collection("reports").doc();
    await ref.set({
        id: ref.id,
        reporterUid: me,
        ...input,
        path: input.path ?? null,
        text: input.text ?? null,
        details: input.details ?? null,
        status: "open",
        createdAt: economy_1.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
    });
    firebase_functions_1.logger.warn("content reported", { id: ref.id, kind: input.kind, reason: input.reason, targetUid: input.targetUid });
    return { ok: true, reportId: ref.id };
});
/** Records acceptance of the current Terms of Service / Community Guidelines. */
exports.acceptTerms = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const version = zod_1.z.number().int().min(1).parse(req.data?.version);
    if (version !== legal_1.TERMS_VERSION)
        throw new https_1.HttpsError("failed-precondition", "Update the app to accept the latest terms.");
    await economy_1.db.collection("users").doc(me).update({ termsVersion: legal_1.TERMS_VERSION, termsAcceptedAt: economy_1.FieldValue.serverTimestamp() });
    return { ok: true, version: legal_1.TERMS_VERSION };
});
// ---------------------------------------------------------------------------
// Delete account
// ---------------------------------------------------------------------------
const PAGE = 400;
async function deleteMatching(q) {
    let n = 0;
    for (;;) {
        const snap = await q.limit(PAGE).get();
        if (snap.empty)
            return n;
        const batch = economy_1.db.batch();
        for (const d of snap.docs)
            batch.delete(d.ref);
        await batch.commit();
        n += snap.size;
        if (snap.size < PAGE)
            return n;
    }
}
/** Open items that hold another player's credits; these must be settled first. */
async function deletionBlockers(uid) {
    const [loans, challenges] = await Promise.all([
        economy_1.db.collection("friendLoans").where("parties", "array-contains", uid).limit(500).get(),
        economy_1.db.collection("challenges").where("participants", "array-contains", uid).limit(500).get(),
    ]);
    const owes = loans.docs.some((d) => d.get("status") === "active" && d.get("borrowerUid") === uid && (d.get("owed") ?? 0) - (d.get("repaid") ?? 0) > 0);
    if (owes)
        return "Pay back what you owe your friends before deleting your account.";
    const open = challenges.docs.some((d) => d.get("status") === "accepted" || (d.get("status") === "pending" && d.get("opponentUid") === uid));
    if (open)
        return "Answer or wait out your open challenges before deleting your account — a friend's credits are riding on them.";
    return null;
}
/**
 * Permanently deletes the caller: Auth user, profile and every subcollection
 * (inventory, ledger, notifications, private contact…), username, invite code,
 * birthday, presence, friendships, friend requests, bets, loans, challenges,
 * and every chat message / comment they wrote or received in DMs. In active
 * leagues the standings row stays (other players' results depend on it) but
 * is renamed "Deleted player"; leagues that haven't started drop them.
 */
exports.deleteAccount = (0, https_1.onCall)({ region: "us-central1", timeoutSeconds: 300 }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    zod_1.z.object({ confirm: zod_1.z.literal("DELETE") }).parse(req.data);
    const blocker = await deletionBlockers(uid);
    if (blocker)
        throw new https_1.HttpsError("failed-precondition", blocker);
    const userRef = economy_1.db.collection("users").doc(uid);
    const user = await userRef.get();
    const username = user.get("username");
    const referralCode = user.get("referralCode");
    // Leagues
    const leagues = await economy_1.db.collection("leagues").where("memberIds", "array-contains", uid).get();
    for (const l of leagues.docs) {
        await economy_1.db.runTransaction(async (tx) => {
            const fresh = await tx.get(l.ref);
            if (!fresh.exists)
                return;
            const memberIds = (fresh.get("memberIds") ?? []).filter((m) => m !== uid);
            if (fresh.get("status") === "active") {
                tx.update(l.ref, { [`members.${uid}.displayName`]: "Deleted player", [`members.${uid}.deleted`]: true, endVotes: economy_1.FieldValue.arrayRemove(uid) });
                return;
            }
            const update = {
                [`members.${uid}`]: economy_1.FieldValue.delete(),
                memberIds: economy_1.FieldValue.arrayRemove(uid),
                endVotes: economy_1.FieldValue.arrayRemove(uid),
            };
            if (fresh.get("creatorId") === uid && memberIds[0])
                update.creatorId = memberIds[0];
            if (memberIds.length === 0)
                update.status = "ended";
            tx.update(l.ref, update);
        });
    }
    // Chat and comments, wherever they live.
    await deleteMatching(economy_1.db.collectionGroup("messages").where("uid", "==", uid));
    await deleteMatching(economy_1.db.collectionGroup("messages").where("senderUid", "==", uid));
    await deleteMatching(economy_1.db.collectionGroup("messages").where("recipientUid", "==", uid));
    await deleteMatching(economy_1.db.collectionGroup("comments").where("uid", "==", uid));
    // Social graph and economy records.
    await deleteMatching(economy_1.db.collection("friendships").where("users", "array-contains", uid));
    await deleteMatching(economy_1.db.collection("friendRequests").where("from", "==", uid));
    await deleteMatching(economy_1.db.collection("friendRequests").where("to", "==", uid));
    await deleteMatching(economy_1.db.collection("bets").where("uid", "==", uid));
    await deleteMatching(economy_1.db.collection("slipParlays").where("uid", "==", uid));
    await deleteMatching(economy_1.db.collection("friendLoans").where("parties", "array-contains", uid));
    await deleteMatching(economy_1.db.collection("challenges").where("participants", "array-contains", uid));
    await deleteMatching(economy_1.db.collection("analyticsEvents").where("uid", "==", uid));
    const singles = economy_1.db.batch();
    if (username)
        singles.delete(economy_1.db.collection("usernames").doc(username));
    if (referralCode)
        singles.delete(economy_1.db.collection("referralCodes").doc(referralCode));
    singles.delete((0, birthdays_1.birthdayRef)(uid));
    singles.delete(economy_1.db.collection("presence").doc(uid));
    await singles.commit();
    // Profile + every subcollection (inventory, ledger, notifications, private, blocks…).
    await economy_1.db.recursiveDelete(userRef);
    try {
        await (0, auth_1.getAuth)().deleteUser(uid);
    }
    catch (e) {
        const code = e?.code;
        if (code !== "auth/user-not-found")
            throw e;
    }
    firebase_functions_1.logger.info("account deleted", { uid });
    return { ok: true };
});
//# sourceMappingURL=account.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFriends = exports.removeFriend = exports.respondFriendRequest = exports.sendFriendRequest = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const MAX_FRIENDS = 500;
/**
 * Friend requests are keyed `${from}_${to}` and friendships are keyed by a
 * *sorted* pair id. That single choice is what makes duplicate connections and
 * one-sided relationships structurally impossible — you cannot create two docs
 * with the same id, and A→B and B→A resolve to the same friendship document
 * regardless of who initiated (requirement §2).
 */
exports.sendFriendRequest = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const from = (0, economy_1.requireAuth)(req.auth);
    const to = zod_1.z.string().min(1).parse(req.data?.toUid);
    if (from === to)
        throw new https_1.HttpsError("invalid-argument", "You can't friend yourself.");
    const targetRef = economy_1.db.collection("users").doc(to);
    const friendshipRef = economy_1.db.collection("friendships").doc((0, economy_1.pairId)(from, to));
    const outgoingRef = economy_1.db.collection("friendRequests").doc(`${from}_${to}`);
    const incomingRef = economy_1.db.collection("friendRequests").doc(`${to}_${from}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [target, friendship, outgoing, incoming] = await Promise.all([
            tx.get(targetRef),
            tx.get(friendshipRef),
            tx.get(outgoingRef),
            tx.get(incomingRef),
        ]);
        if (!target.exists)
            throw new https_1.HttpsError("not-found", "That user doesn't exist.");
        if (friendship.exists)
            throw new https_1.HttpsError("already-exists", "You're already friends.");
        if (outgoing.exists && outgoing.get("status") === "pending") {
            return { ok: true, status: "already_sent" };
        }
        // If they already asked you, sending back = accepting. Removes the
        // classic double-pending dead end.
        if (incoming.exists && incoming.get("status") === "pending") {
            tx.update(incomingRef, { status: "accepted", respondedAt: economy_1.FieldValue.serverTimestamp() });
            tx.set(friendshipRef, {
                users: [from, to].sort(),
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
            return { ok: true, status: "accepted" };
        }
        tx.set(outgoingRef, {
            from,
            to,
            status: "pending",
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
        return { ok: true, status: "sent" };
    });
});
exports.respondFriendRequest = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { fromUid, accept } = zod_1.z
        .object({ fromUid: zod_1.z.string().min(1), accept: zod_1.z.boolean() })
        .parse(req.data);
    const reqRef = economy_1.db.collection("friendRequests").doc(`${fromUid}_${me}`);
    const friendshipRef = economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, fromUid));
    return economy_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(reqRef);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "Request not found.");
        if (snap.get("to") !== me)
            throw new https_1.HttpsError("permission-denied", "Not your request.");
        if (snap.get("status") !== "pending") {
            return { ok: true, status: snap.get("status") };
        }
        if (!accept) {
            tx.update(reqRef, { status: "declined", respondedAt: economy_1.FieldValue.serverTimestamp() });
            return { ok: true, status: "declined" };
        }
        const existing = await tx.get(friendshipRef);
        if (!existing.exists) {
            tx.set(friendshipRef, {
                users: [me, fromUid].sort(),
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
        }
        tx.update(reqRef, { status: "accepted", respondedAt: economy_1.FieldValue.serverTimestamp() });
        return { ok: true, status: "accepted" };
    });
});
exports.removeFriend = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const other = zod_1.z.string().min(1).parse(req.data?.otherUid);
    const friendshipRef = economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, other));
    const batch = economy_1.db.batch();
    batch.delete(friendshipRef);
    // Clear both request docs so the pair can re-add each other later.
    batch.delete(economy_1.db.collection("friendRequests").doc(`${me}_${other}`));
    batch.delete(economy_1.db.collection("friendRequests").doc(`${other}_${me}`));
    await batch.commit();
    return { ok: true };
});
/**
 * Friends list with the data the UI actually needs to render a friend card:
 * name, avatar config and equipped items, so friends' avatars appear correctly
 * on the head-to-head screen (§21).
 */
exports.listFriends = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const snap = await economy_1.db
        .collection("friendships")
        .where("users", "array-contains", me)
        .limit(MAX_FRIENDS)
        .get();
    const otherIds = snap.docs
        .map((d) => d.get("users").find((u) => u !== me))
        .filter((u) => Boolean(u));
    if (otherIds.length === 0)
        return { friends: [] };
    // getAll is a single round trip; a per-friend get() loop is the usual
    // accidental N+1 here.
    const refs = otherIds.map((id) => economy_1.db.collection("users").doc(id));
    const docs = await economy_1.db.getAll(...refs);
    return {
        friends: docs
            .filter((d) => d.exists)
            .map((d) => ({
            uid: d.id,
            username: d.get("username"),
            displayName: d.get("displayName"),
            avatar: d.get("avatar"),
            equipped: d.get("equipped"),
            balance: d.get("balance"),
            stats: d.get("stats"),
        })),
    };
});
//# sourceMappingURL=friends.js.map
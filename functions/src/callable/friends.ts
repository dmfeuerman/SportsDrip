import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

const MAX_FRIENDS = 500;

/**
 * Friend requests are keyed `${from}_${to}` and friendships are keyed by a
 * *sorted* pair id. That single choice is what makes duplicate connections and
 * one-sided relationships structurally impossible — you cannot create two docs
 * with the same id, and A→B and B→A resolve to the same friendship document
 * regardless of who initiated (requirement §2).
 */

export const sendFriendRequest = onCall({ region: "us-central1" }, async (req) => {
  const from = requireAuth(req.auth);
  const to = z.string().min(1).parse(req.data?.toUid);

  if (from === to) throw new HttpsError("invalid-argument", "You can't friend yourself.");

  const targetRef = db.collection("users").doc(to);
  const friendshipRef = db.collection("friendships").doc(pairId(from, to));
  const outgoingRef = db.collection("friendRequests").doc(`${from}_${to}`);
  const incomingRef = db.collection("friendRequests").doc(`${to}_${from}`);

  return db.runTransaction(async (tx) => {
    const [target, friendship, outgoing, incoming, sender] = await Promise.all([
      tx.get(targetRef),
      tx.get(friendshipRef),
      tx.get(outgoingRef),
      tx.get(incomingRef),
      tx.get(db.collection("users").doc(from)),
    ]);
    const senderName = (sender.get("displayName") as string | undefined) || "A player";
    const senderHandle = sender.get("username") as string | undefined;
    const now = Date.now();

    if (!target.exists) throw new HttpsError("not-found", "That user doesn't exist.");
    if (friendship.exists) throw new HttpsError("already-exists", "You're already friends.");
    if (outgoing.exists && outgoing.get("status") === "pending") {
      return { ok: true, status: "already_sent" as const };
    }

    // If they already asked you, sending back = accepting. Removes the
    // classic double-pending dead end.
    if (incoming.exists && incoming.get("status") === "pending") {
      tx.update(incomingRef, { status: "accepted", respondedAt: FieldValue.serverTimestamp() });
      tx.set(friendshipRef, {
        users: [from, to].sort(),
        createdAt: FieldValue.serverTimestamp(),
      });
      writeNotification(tx, to, friendAccepted(from, to, senderName, now));
      return { ok: true, status: "accepted" as const };
    }

    tx.set(outgoingRef, {
      from,
      to,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    // Before this the request doc was the only trace, so the recipient saw
    // nothing until they happened to open the Friends tab. Same deterministic
    // id on a re-send after a decline, so it resurfaces instead of stacking.
    writeNotification(
      tx,
      to,
      simpleNotification({
        id: `freq_${from}_${to}`,
        type: "friend_request",
        title: `${senderName} sent you a friend request`,
        body: senderHandle ? `@${senderHandle} wants to compete with you. Tap to respond.` : "Tap to respond.",
        now,
        popup: true,
        data: { fromUid: from },
      })
    );
    return { ok: true, status: "sent" as const };
  });
});

export const respondFriendRequest = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { fromUid, accept } = z
    .object({ fromUid: z.string().min(1), accept: z.boolean() })
    .parse(req.data);

  const reqRef = db.collection("friendRequests").doc(`${fromUid}_${me}`);
  const friendshipRef = db.collection("friendships").doc(pairId(me, fromUid));

  return db.runTransaction(async (tx) => {
    const [snap, meSnap] = await Promise.all([tx.get(reqRef), tx.get(db.collection("users").doc(me))]);
    if (!snap.exists) throw new HttpsError("not-found", "Request not found.");
    if (snap.get("to") !== me) throw new HttpsError("permission-denied", "Not your request.");
    if (snap.get("status") !== "pending") {
      return { ok: true, status: snap.get("status") as string };
    }

    if (!accept) {
      tx.update(reqRef, { status: "declined", respondedAt: FieldValue.serverTimestamp() });
      return { ok: true, status: "declined" as const };
    }

    const existing = await tx.get(friendshipRef);
    if (!existing.exists) {
      tx.set(friendshipRef, {
        users: [me, fromUid].sort(),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(reqRef, { status: "accepted", respondedAt: FieldValue.serverTimestamp() });
    writeNotification(
      tx,
      fromUid,
      friendAccepted(me, fromUid, (meSnap.get("displayName") as string | undefined) || "A player", Date.now())
    );
    return { ok: true, status: "accepted" as const };
  });
});

function friendAccepted(accepter: string, requester: string, accepterName: string, now: number) {
  return simpleNotification({
    id: `faccept_${pairId(accepter, requester)}`,
    type: "friend_accepted",
    title: `${accepterName} accepted your friend request`,
    body: "You can now see each other's bets and invite each other to leagues.",
    now,
    popup: true,
    data: { fromUid: accepter },
  });
}

export const removeFriend = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const other = z.string().min(1).parse(req.data?.otherUid);

  const friendshipRef = db.collection("friendships").doc(pairId(me, other));
  const batch = db.batch();
  batch.delete(friendshipRef);
  // Clear both request docs so the pair can re-add each other later.
  batch.delete(db.collection("friendRequests").doc(`${me}_${other}`));
  batch.delete(db.collection("friendRequests").doc(`${other}_${me}`));
  await batch.commit();

  return { ok: true };
});

/**
 * Friends list with the data the UI actually needs to render a friend card:
 * name, avatar config and equipped items, so friends' avatars appear correctly
 * on the head-to-head screen (§21).
 */
export const listFriends = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);

  const snap = await db
    .collection("friendships")
    .where("users", "array-contains", me)
    .limit(MAX_FRIENDS)
    .get();

  const otherIds = snap.docs
    .map((d) => (d.get("users") as string[]).find((u) => u !== me))
    .filter((u): u is string => Boolean(u));

  if (otherIds.length === 0) return { friends: [] };

  // getAll is a single round trip; a per-friend get() loop is the usual
  // accidental N+1 here.
  const refs = otherIds.map((id) => db.collection("users").doc(id));
  const docs = await db.getAll(...refs);

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
        favoriteTeams: d.get("favoriteTeams") ?? [],
      })),
  };
});

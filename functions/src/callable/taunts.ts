import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { isFreeMove, MOVE_ID_RE } from "../lib/moves";
import { nyDay } from "../lib/streak";

/**
 * Avatar taunts: a chat row of kind "taunt" that plays one of the sender's
 * dance moves. Server-posted so the checks hold:
 *   - the sender owns the move (free moves count)
 *   - the receiver hasn't muted taunts (users/{uid}.muteTaunts)
 * As many as you like: the app names each one (`clientId`), so the row it
 * shows straight away has the same id as the one written here, and a retry
 * of the same taunt is a no-op. (Builds without `clientId` keep the old
 * one-per-matchup-per-day id.)
 * League taunts target your H2H opponent in that week's matchup; DM taunts
 * target a friend, with matchupId naming the challenge/bet being rubbed in.
 */
const ClientId = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/).optional();

const Input = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("league"),
    leagueId: z.string().min(1).max(64),
    /** leagues/{id}/matchups/{week} doc id. */
    matchupId: z.string().min(1).max(64),
    receiverUid: z.string().min(1).max(128),
    moveId: z.string().regex(MOVE_ID_RE),
    clientId: ClientId,
  }),
  z.object({
    scope: z.literal("dm"),
    receiverUid: z.string().min(1).max(128),
    matchupId: z.string().min(1).max(64),
    moveId: z.string().regex(MOVE_ID_RE),
    clientId: ClientId,
  }),
]);

export function tauntDocId(matchupId: string, uid: string, now: number, clientId?: string): string {
  if (clientId) return `taunt_${uid}_${clientId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return `taunt_${matchupId}_${uid}_${nyDay(now)}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export const sendTaunt = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = Input.parse(req.data);
  if (input.receiverUid === uid) throw new HttpsError("invalid-argument", "Pick someone else.");
  const now = Date.now();
  const userRef = db.collection("users").doc(uid);
  const receiverRef = db.collection("users").doc(input.receiverUid);
  const id = tauntDocId(input.matchupId, uid, now, input.clientId);

  const msgRef =
    input.scope === "league"
      ? db.collection("leagues").doc(input.leagueId).collection("messages").doc(id)
      : db
          .collection("directMessages")
          .doc(uid < input.receiverUid ? `dm_${uid}_${input.receiverUid}` : `dm_${input.receiverUid}_${uid}`)
          .collection("messages")
          .doc(id);

  return db.runTransaction(async (tx) => {
    const reads = await Promise.all([
      tx.get(userRef),
      tx.get(receiverRef),
      tx.get(userRef.collection("moves").doc(input.moveId)),
      tx.get(msgRef),
      tx.get(db.collection("moves").doc(input.moveId)),
      input.scope === "league"
        ? tx.get(db.collection("leagues").doc(input.leagueId))
        : tx.get(db.collection("friendships").doc(pairId(uid, input.receiverUid))),
      input.scope === "league" ? tx.get(db.collection("leagues").doc(input.leagueId).collection("matchups").doc(input.matchupId)) : null,
    ]);
    const [me, receiver, owned, existing, move, scopeDoc, matchup] = reads;
    // Same clientId: this taunt already went through (a retry). Legacy ids: the old daily cap.
    if (existing.exists) {
      if (input.clientId) return { ok: true, id };
      throw new HttpsError("resource-exhausted", input.scope === "dm" ? "You already taunted them today." : "One taunt per matchup a day.");
    }
    if (!me.exists || !receiver.exists) throw new HttpsError("not-found", "Player not found.");
    if (!isFreeMove(input.moveId) && !owned.exists) throw new HttpsError("permission-denied", "You don't own that move.");
    if (receiver.get("muteTaunts") === true) throw new HttpsError("failed-precondition", "They've muted taunts.");

    if (input.scope === "league") {
      const memberIds = (scopeDoc.get("memberIds") as string[] | undefined) ?? [];
      if (!scopeDoc.exists || !memberIds.includes(uid) || !memberIds.includes(input.receiverUid)) {
        throw new HttpsError("permission-denied", "You're not both in this league.");
      }
      const pairs = (matchup?.get("pairs") as Array<{ aUid: string; bUid: string | null }> | undefined) ?? [];
      const paired = pairs.some(
        (p) => (p.aUid === uid && p.bUid === input.receiverUid) || (p.bUid === uid && p.aUid === input.receiverUid)
      );
      if (!matchup?.exists || !paired) throw new HttpsError("failed-precondition", "You can only taunt your matchup opponent.");
    } else if (!scopeDoc.exists) {
      throw new HttpsError("permission-denied", "You can only taunt friends.");
    }

    const myName = (me.get("displayName") as string) ?? "Player";
    const moveName = (move.get("name") as string | undefined) ?? input.moveId.replace(/_/g, " ");
    const text = `${myName} hit the ${moveName} 💃`;
    const avatar = { avatar: me.get("avatar") ?? null, equipped: me.get("equipped") ?? {} };
    if (input.scope === "league") {
      tx.set(msgRef, {
        uid,
        name: myName,
        kind: "taunt",
        text,
        moveId: input.moveId,
        matchupId: input.matchupId,
        receiverUid: input.receiverUid,
        ...avatar,
        at: now,
        reactions: {},
        reactors: {},
      });
    } else {
      tx.set(msgRef, {
        id,
        threadId: msgRef.parent.parent!.id,
        senderUid: uid,
        senderName: myName,
        recipientUid: input.receiverUid,
        recipientName: (receiver.get("displayName") as string) ?? "Player",
        kind: "taunt",
        text,
        moveId: input.moveId,
        matchupId: input.matchupId,
        ...avatar,
        at: now,
        replyTo: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, id };
  });
});

/** Opt out of receiving taunts. */
export const setMuteTaunts = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { mute } = z.object({ mute: z.boolean() }).parse(req.data);
  await db.collection("users").doc(uid).update({ muteTaunts: mute, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

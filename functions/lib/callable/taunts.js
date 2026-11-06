"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMuteTaunts = exports.sendTaunt = void 0;
exports.tauntDocId = tauntDocId;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const moves_1 = require("../lib/moves");
const streak_1 = require("../lib/streak");
/**
 * Avatar taunts: a chat row of kind "taunt" that plays one of the sender's
 * dance moves. Server-posted so the checks hold:
 *   - the sender owns the move (free moves count)
 *   - at most one per matchup per sender per ET day (deterministic doc id)
 *   - the receiver hasn't muted taunts (users/{uid}.muteTaunts)
 * League taunts target your H2H opponent in that week's matchup; DM taunts
 * target a friend, with matchupId naming the challenge/bet being rubbed in.
 */
const Input = zod_1.z.discriminatedUnion("scope", [
    zod_1.z.object({
        scope: zod_1.z.literal("league"),
        leagueId: zod_1.z.string().min(1).max(64),
        /** leagues/{id}/matchups/{week} doc id. */
        matchupId: zod_1.z.string().min(1).max(64),
        receiverUid: zod_1.z.string().min(1).max(128),
        moveId: zod_1.z.string().regex(moves_1.MOVE_ID_RE),
    }),
    zod_1.z.object({
        scope: zod_1.z.literal("dm"),
        receiverUid: zod_1.z.string().min(1).max(128),
        matchupId: zod_1.z.string().min(1).max(64),
        moveId: zod_1.z.string().regex(moves_1.MOVE_ID_RE),
    }),
]);
function tauntDocId(matchupId, uid, now) {
    return `taunt_${matchupId}_${uid}_${(0, streak_1.nyDay)(now)}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}
exports.sendTaunt = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = Input.parse(req.data);
    if (input.receiverUid === uid)
        throw new https_1.HttpsError("invalid-argument", "Pick someone else.");
    const now = Date.now();
    const userRef = economy_1.db.collection("users").doc(uid);
    const receiverRef = economy_1.db.collection("users").doc(input.receiverUid);
    const id = tauntDocId(input.matchupId, uid, now);
    const msgRef = input.scope === "league"
        ? economy_1.db.collection("leagues").doc(input.leagueId).collection("messages").doc(id)
        : economy_1.db
            .collection("directMessages")
            .doc(uid < input.receiverUid ? `dm_${uid}_${input.receiverUid}` : `dm_${input.receiverUid}_${uid}`)
            .collection("messages")
            .doc(id);
    return economy_1.db.runTransaction(async (tx) => {
        const reads = await Promise.all([
            tx.get(userRef),
            tx.get(receiverRef),
            tx.get(userRef.collection("moves").doc(input.moveId)),
            tx.get(msgRef),
            tx.get(economy_1.db.collection("moves").doc(input.moveId)),
            input.scope === "league"
                ? tx.get(economy_1.db.collection("leagues").doc(input.leagueId))
                : tx.get(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(uid, input.receiverUid))),
            input.scope === "league" ? tx.get(economy_1.db.collection("leagues").doc(input.leagueId).collection("matchups").doc(input.matchupId)) : null,
        ]);
        const [me, receiver, owned, existing, move, scopeDoc, matchup] = reads;
        if (existing.exists)
            throw new https_1.HttpsError("resource-exhausted", "One taunt per matchup a day.");
        if (!me.exists || !receiver.exists)
            throw new https_1.HttpsError("not-found", "Player not found.");
        if (!(0, moves_1.isFreeMove)(input.moveId) && !owned.exists)
            throw new https_1.HttpsError("permission-denied", "You don't own that move.");
        if (receiver.get("muteTaunts") === true)
            throw new https_1.HttpsError("failed-precondition", "They've muted taunts.");
        if (input.scope === "league") {
            const memberIds = scopeDoc.get("memberIds") ?? [];
            if (!scopeDoc.exists || !memberIds.includes(uid) || !memberIds.includes(input.receiverUid)) {
                throw new https_1.HttpsError("permission-denied", "You're not both in this league.");
            }
            const pairs = matchup?.get("pairs") ?? [];
            const paired = pairs.some((p) => (p.aUid === uid && p.bUid === input.receiverUid) || (p.bUid === uid && p.aUid === input.receiverUid));
            if (!matchup?.exists || !paired)
                throw new https_1.HttpsError("failed-precondition", "You can only taunt your matchup opponent.");
        }
        else if (!scopeDoc.exists) {
            throw new https_1.HttpsError("permission-denied", "You can only taunt friends.");
        }
        const myName = me.get("displayName") ?? "Player";
        const moveName = move.get("name") ?? input.moveId.replace(/_/g, " ");
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
        }
        else {
            tx.set(msgRef, {
                id,
                threadId: msgRef.parent.parent.id,
                senderUid: uid,
                senderName: myName,
                recipientUid: input.receiverUid,
                recipientName: receiver.get("displayName") ?? "Player",
                kind: "taunt",
                text,
                moveId: input.moveId,
                matchupId: input.matchupId,
                ...avatar,
                at: now,
                replyTo: null,
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
        }
        return { ok: true, id };
    });
});
/** Opt out of receiving taunts. */
exports.setMuteTaunts = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { mute } = zod_1.z.object({ mute: zod_1.z.boolean() }).parse(req.data);
    await economy_1.db.collection("users").doc(uid).update({ muteTaunts: mute, updatedAt: economy_1.FieldValue.serverTimestamp() });
    return { ok: true };
});
//# sourceMappingURL=taunts.js.map
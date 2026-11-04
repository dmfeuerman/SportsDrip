"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPushToken = exports.pushDocRef = void 0;
const node_crypto_1 = require("node:crypto");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const push_1 = require("../lib/push");
/**
 * Device push tokens live at users/{uid}/private/push → { pushTokens: [...] }.
 *
 * Not on users/{uid} itself: that document is readable by every signed-in user
 * (friend lists, standings), and a raw Expo token is enough to push to
 * someone's phone. private/* is owner-read, server-write.
 *
 * pushTokenOwners/{sha256(token)} records which account a device currently
 * belongs to. Signing into a second account on the same phone moves the token,
 * so the first account's pushes stop arriving on a phone it no longer uses.
 */
const pushDocRef = (uid) => economy_1.db.collection("users").doc(uid).collection("private").doc("push");
exports.pushDocRef = pushDocRef;
const ownerRef = (token) => economy_1.db.collection("pushTokenOwners").doc((0, node_crypto_1.createHash)("sha256").update(token).digest("hex"));
const Input = zod_1.z.object({
    token: zod_1.z.string().min(1).max(256),
    /** false removes this device (sign-out, or the user turned pushes off). */
    enabled: zod_1.z.boolean().default(true),
    platform: zod_1.z.literal("ios").default("ios"),
});
exports.registerPushToken = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = Input.parse(req.data);
    if (!(0, push_1.isExpoPushToken)(input.token))
        throw new https_1.HttpsError("invalid-argument", "That isn't an Expo push token.");
    const now = Date.now();
    return economy_1.db.runTransaction(async (tx) => {
        const owner = ownerRef(input.token);
        const [ownerSnap, mine] = await Promise.all([tx.get(owner), tx.get((0, exports.pushDocRef)(uid))]);
        const previousUid = ownerSnap.exists ? ownerSnap.get("uid") : null;
        const previous = previousUid && previousUid !== uid ? await tx.get((0, exports.pushDocRef)(previousUid)) : null;
        const current = (mine.get("pushTokens") ?? []).filter(Boolean);
        if (!input.enabled) {
            tx.set((0, exports.pushDocRef)(uid), { pushTokens: current.filter((t) => t.token !== input.token), updatedAt: now }, { merge: true });
            if (previousUid === uid)
                tx.delete(owner);
            return { ok: true, registered: false };
        }
        if (previous?.exists) {
            const theirs = (previous.get("pushTokens") ?? []).filter((t) => t && t.token !== input.token);
            tx.set(previous.ref, { pushTokens: theirs, updatedAt: now }, { merge: true });
        }
        tx.set((0, exports.pushDocRef)(uid), { pushTokens: (0, push_1.mergeToken)(current, input.token, now), updatedAt: now }, { merge: true });
        tx.set(owner, { uid, platform: input.platform, updatedAt: now });
        return { ok: true, registered: true };
    });
});
//# sourceMappingURL=push.js.map
import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { isExpoPushToken, mergeToken, type StoredPushToken } from "../lib/push";

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

export const pushDocRef = (uid: string) => db.collection("users").doc(uid).collection("private").doc("push");
const ownerRef = (token: string) =>
  db.collection("pushTokenOwners").doc(createHash("sha256").update(token).digest("hex"));

const Input = z.object({
  token: z.string().min(1).max(256),
  /** false removes this device (sign-out, or the user turned pushes off). */
  enabled: z.boolean().default(true),
  platform: z.literal("ios").default("ios"),
});

export const registerPushToken = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = Input.parse(req.data);
  if (!isExpoPushToken(input.token)) throw new HttpsError("invalid-argument", "That isn't an Expo push token.");
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const owner = ownerRef(input.token);
    const [ownerSnap, mine] = await Promise.all([tx.get(owner), tx.get(pushDocRef(uid))]);
    const previousUid = ownerSnap.exists ? (ownerSnap.get("uid") as string) : null;
    const previous = previousUid && previousUid !== uid ? await tx.get(pushDocRef(previousUid)) : null;

    const current = ((mine.get("pushTokens") as StoredPushToken[] | undefined) ?? []).filter(Boolean);

    if (!input.enabled) {
      tx.set(pushDocRef(uid), { pushTokens: current.filter((t) => t.token !== input.token), updatedAt: now }, { merge: true });
      if (previousUid === uid) tx.delete(owner);
      return { ok: true as const, registered: false };
    }

    if (previous?.exists) {
      const theirs = ((previous.get("pushTokens") as StoredPushToken[] | undefined) ?? []).filter((t) => t && t.token !== input.token);
      tx.set(previous.ref, { pushTokens: theirs, updatedAt: now }, { merge: true });
    }
    tx.set(pushDocRef(uid), { pushTokens: mergeToken(current, input.token, now), updatedAt: now }, { merge: true });
    tx.set(owner, { uid, platform: input.platform, updatedAt: now });
    return { ok: true as const, registered: true };
  });
});

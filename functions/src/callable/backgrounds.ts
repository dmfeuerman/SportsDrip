import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { BACKGROUND_ID_RE, DEFAULT_BACKGROUND, isFreeBackground } from "../lib/backgrounds";
import { levelFromXp } from "../lib/progression";

const BackgroundId = z.string().regex(BACKGROUND_ID_RE, "Unknown background.");

/**
 * Buys a background. Same guarantees as purchaseItem / purchaseMove, in one
 * transaction: server price, ownership doc id = background id (no double
 * purchase), debit and grant commit together, idempotency key. Level gates are
 * checked against the server-side XP. The new background goes straight on.
 */
export const purchaseBackground = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = z.object({ backgroundId: BackgroundId, idempotencyKey: z.string().min(8).max(64) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { backgroundId, idempotencyKey } = parsed.data;
  if (isFreeBackground(backgroundId)) throw new HttpsError("already-exists", "Everyone already has that background.");

  const userRef = db.collection("users").doc(uid);
  const listingRef = db.collection("backgrounds").doc(backgroundId);
  const ownRef = userRef.collection("backgrounds").doc(backgroundId);

  return db.runTransaction(async (tx) => {
    const [listing, owned, user] = await Promise.all([tx.get(listingRef), tx.get(ownRef), tx.get(userRef)]);
    if (!listing.exists) throw new HttpsError("not-found", "That background isn't in the store.");
    if (owned.exists) throw new HttpsError("already-exists", "You already own this background.");
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    if (listing.get("available") === false) throw new HttpsError("failed-precondition", "That background isn't available right now.");
    const releaseAt = listing.get("releaseAt") as number | null | undefined;
    if (releaseAt && releaseAt > Date.now()) throw new HttpsError("failed-precondition", "That background hasn't dropped yet.");
    // Level-reward scenes are granted free on reaching that level, and can be bought before then.
    const required = (listing.get("levelRequired") as number | null | undefined) ?? 0;
    if (required > levelFromXp(user.get("xp"))) {
      throw new HttpsError("failed-precondition", `Reach level ${required} to buy this background.`);
    }
    const price = listing.get("price") as number;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new HttpsError("internal", "Background is misconfigured.");
    }

    const balance = await applyCredits(tx, uid, {
      delta: -price,
      type: "purchase",
      idempotencyKey: `bg_${idempotencyKey}`,
      ref: `background:${backgroundId}`,
      note: (listing.get("name") as string | undefined) ?? backgroundId,
    });
    if (balance === null) return { ok: true as const, balance: null, backgroundId };

    tx.set(ownRef, { backgroundId, source: "purchase", pricePaid: price, acquiredAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { background: backgroundId, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true as const, balance, backgroundId };
  });
});

/** Puts a free or owned background behind the character. `null` = the default. */
export const setBackground = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = z.object({ backgroundId: BackgroundId.nullable() }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  const id = parsed.data.backgroundId ?? DEFAULT_BACKGROUND;
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const [user, owned] = await Promise.all([tx.get(userRef), isFreeBackground(id) ? Promise.resolve(null) : tx.get(userRef.collection("backgrounds").doc(id))]);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    if (owned && !owned.exists) throw new HttpsError("permission-denied", "You don't own that background.");
    tx.update(userRef, { background: id, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true as const, backgroundId: id };
});

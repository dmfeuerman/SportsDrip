import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { DEFAULT_MOVE_LISTINGS, isFreeMove, loadoutOf, MAX_LOADOUT, MOVE_ID_RE } from "../lib/moves";

const MoveId = z.string().regex(MOVE_ID_RE, "Unknown move.");

/**
 * Buys a move. Same guarantees as purchaseItem, in one transaction: the price
 * comes from moves/{moveId}, the ownership doc id is the move id (no double
 * purchase), debit and grant commit together, the balance can't go negative,
 * and the idempotency key absorbs double taps and retries.
 *
 * A new move goes straight into the loadout when there's a free slot, so it's
 * on the dance button the moment it's bought.
 */
export const purchaseMove = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = z.object({ moveId: MoveId, idempotencyKey: z.string().min(8).max(64) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { moveId, idempotencyKey } = parsed.data;
  if (isFreeMove(moveId)) throw new HttpsError("already-exists", "Everyone already has that move.");

  const userRef = db.collection("users").doc(uid);
  const moveRef = db.collection("moves").doc(moveId);
  const ownRef = userRef.collection("moves").doc(moveId);

  return db.runTransaction(async (tx) => {
    const [move, owned, user] = await Promise.all([tx.get(moveRef), tx.get(ownRef), tx.get(userRef)]);
    const fallback = DEFAULT_MOVE_LISTINGS[moveId];
    if (!move.exists && !fallback) throw new HttpsError("not-found", "That move isn't in the store.");
    if (owned.exists) throw new HttpsError("already-exists", "You already own this move.");
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    if (move.get("available") === false) throw new HttpsError("failed-precondition", "That move isn't available right now.");
    const releaseAt = move.get("releaseAt") as number | null | undefined;
    if (releaseAt && releaseAt > Date.now()) throw new HttpsError("failed-precondition", "That move hasn't dropped yet.");
    const price = (move.exists ? (move.get("price") as number) : fallback!.price) as number;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new HttpsError("internal", "Move is misconfigured.");
    }

    const loadout = loadoutOf(user.get("moves"));
    const balance = await applyCredits(tx, uid, {
      delta: -price,
      type: "purchase",
      idempotencyKey: `move_${idempotencyKey}`,
      ref: `move:${moveId}`,
      note: (move.exists ? (move.get("name") as string | undefined) : fallback?.name) ?? moveId,
    });
    // A replayed key: the first call already granted it.
    if (balance === null) return { ok: true as const, balance: null, moveId, equipped: loadout.includes(moveId) };

    tx.set(ownRef, { moveId, source: "purchase", pricePaid: price, acquiredAt: FieldValue.serverTimestamp() });
    const equipped = loadout.length < MAX_LOADOUT;
    if (equipped) tx.update(userRef, { moves: [...loadout, moveId], updatedAt: FieldValue.serverTimestamp() });
    return { ok: true as const, balance, moveId, equipped };
  });
});

/**
 * Sets the loadout: 1–4 distinct moves, in button order, each one free or
 * owned. Ownership is checked here, so a crafted call can't dance a move
 * nobody paid for.
 */
export const setMoveLoadout = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = z
    .object({ moves: z.array(MoveId).min(1, "Pick at least one move.").max(MAX_LOADOUT, `Pick up to ${MAX_LOADOUT} moves.`) })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid loadout.");
  const moves = parsed.data.moves;
  if (new Set(moves).size !== moves.length) throw new HttpsError("invalid-argument", "A move can only be in your loadout once.");

  const userRef = db.collection("users").doc(uid);
  const paid = moves.filter((m) => !isFreeMove(m));
  await db.runTransaction(async (tx) => {
    const [user, ...owned] = await Promise.all([tx.get(userRef), ...paid.map((m) => tx.get(userRef.collection("moves").doc(m)))]);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    if (owned.some((o) => !o.exists)) throw new HttpsError("permission-denied", "You don't own one of those moves.");
    tx.update(userRef, { moves, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true as const, moves };
});

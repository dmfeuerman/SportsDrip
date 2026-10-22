import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCredits,
  db,
  FieldValue,
  PRIZE_BOXES,
  pickWeighted,
  requireAuth,
  type BoxTier,
} from "../lib/economy";

const TierInput = z.object({ tier: z.enum(["bronze", "silver", "gold"]) });

/**
 * Prize box state lives at users/{uid}/prizeBoxes/{tier} and is written only by
 * these two functions. That fixes every branch of B8 at once:
 *
 *  - `readyAt` is computed from the *server* clock, so changing the phone's
 *    time does nothing
 *  - state is in Firestore, not AsyncStorage, so it survives reinstall, logout,
 *    and follows the user to a second device
 *  - the box goes `waiting -> ready -> claimed -> idle` explicitly, instead of
 *    the old code deleting the claim and losing both the `spun` flag and the
 *    cooldown record
 *  - the reward is drawn on the server (S3), not passed in from the wheel
 */

export const openPrizeBox = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { tier } = TierInput.parse(req.data);
  const def = PRIZE_BOXES[tier as BoxTier];

  const ref = db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (snap.exists) {
      const state = snap.get("state") as string;
      const readyAt = (snap.get("readyAt") as number | undefined) ?? 0;
      if (state === "waiting" && now < readyAt) {
        throw new HttpsError("failed-precondition", "That box is still on cooldown.");
      }
      if (state === "waiting" || state === "ready") {
        // Timer elapsed. Persist the transition instead of only reporting it,
        // so the stored document and the response agree.
        if (state === "waiting") {
          tx.update(ref, { state: "ready", updatedAt: FieldValue.serverTimestamp() });
        }
        return { ok: true, state: "ready" as const, readyAt };
      }
    }

    const readyAt = now + def.waitHours * 3_600_000;
    tx.set(ref, {
      tier,
      state: "waiting",
      openedAt: now,
      readyAt,
      rewardCredits: null,
      claimedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, state: "waiting" as const, readyAt };
  });
});

export const claimPrizeBox = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { tier } = TierInput.parse(req.data);
  const def = PRIZE_BOXES[tier as BoxTier];

  const ref = db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "That box isn't open yet.");

    const state = snap.get("state") as string;
    const readyAt = (snap.get("readyAt") as number | undefined) ?? 0;
    const openedAt = (snap.get("openedAt") as number | undefined) ?? 0;

    if (state === "claimed") {
      // Idempotent replay: return what was already awarded rather than paying twice.
      return {
        ok: true,
        duplicate: true,
        rewardCredits: snap.get("rewardCredits") as number,
        balance: null,
      };
    }
    if (state !== "waiting" && state !== "ready") {
      throw new HttpsError("failed-precondition", "That box isn't ready.");
    }
    if (Date.now() < readyAt) {
      throw new HttpsError("failed-precondition", "That box isn't ready yet.");
    }

    const rewardCredits = pickWeighted(def.segments);

    // openedAt is part of the key so the next cycle of the same box gets its
    // own ledger row, but a retry of *this* claim does not.
    const balance = await applyCredits(tx, uid, {
      delta: rewardCredits,
      type: "prize_box",
      idempotencyKey: `prize_${tier}_${openedAt}`,
      ref: tier,
      note: `${tier} box`,
    });

    tx.update(ref, {
      state: "claimed",
      rewardCredits,
      claimedAt: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, duplicate: false, rewardCredits, balance };
  });
});

/**
 * Moves a claimed box back to idle so it can be opened again. Separate from
 * claim so the UI can show the "+250" result before the card resets.
 */
export const resetPrizeBox = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { tier } = TierInput.parse(req.data);
  const ref = db.collection("users").doc(uid).collection("prizeBoxes").doc(tier);

  // Clear the spent cycle rather than merging one field over stale data, so
  // a box in the database is self-describing.
  await ref.set(
    {
      state: "idle",
      openedAt: null,
      readyAt: null,
      rewardCredits: null,
      claimedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
});

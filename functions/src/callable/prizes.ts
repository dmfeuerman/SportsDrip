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

/** Claims in a row without the top prize before it is guaranteed (shown in the app). */
export const PITY_AFTER = 15;
import { activeStreakCount, streakBonusFor, type StreakState } from "../lib/streak";

const TierInput = z.object({ tier: z.enum(["bronze", "silver", "gold"]) });

/**
 * Prize box state lives at users/{uid}/prizeBoxes/{tier} and is written only by
 * these functions.
 *
 *  - `readyAt` is computed from the *server* clock, so changing the phone's
 *    time does nothing
 *  - state is in Firestore, not AsyncStorage, so it survives reinstall, logout,
 *    and follows the user to a second device
 *  - the box goes `waiting -> ready -> claimed -> idle` explicitly
 *  - the reward is drawn on the server (S3) and includes a small daily pick
 *    streak bonus when the user has an active streak (America/New_York)
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

  const userRef = db.collection("users").doc(uid);
  const ref = userRef.collection("prizeBoxes").doc(tier);

  return db.runTransaction(async (tx) => {
    const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
    if (!snap.exists) throw new HttpsError("failed-precondition", "That box isn't open yet.");

    const state = snap.get("state") as string;
    const readyAt = (snap.get("readyAt") as number | undefined) ?? 0;
    const openedAt = (snap.get("openedAt") as number | undefined) ?? 0;
    const now = Date.now();

    if (state === "claimed") {
      return {
        ok: true,
        duplicate: true,
        rewardCredits: snap.get("rewardCredits") as number,
        baseCredits: (snap.get("baseCredits") as number | undefined) ?? (snap.get("rewardCredits") as number),
        streakBonus: (snap.get("streakBonus") as number | undefined) ?? 0,
        streakDays: (snap.get("streakDays") as number | undefined) ?? 0,
        balance: null,
      };
    }
    if (state !== "waiting" && state !== "ready") {
      throw new HttpsError("failed-precondition", "That box isn't ready.");
    }
    if (now < readyAt) {
      throw new HttpsError("failed-precondition", "That box isn't ready yet.");
    }

    // Pity: the top prize is guaranteed by the PITY_AFTER-th claim without one.
    const top = Math.max(...def.segments.map((s) => s.credits));
    const sinceTop = (userSnap.get(`boxPity.${tier}`) as number | undefined) ?? 0;
    const baseCredits = sinceTop + 1 >= PITY_AFTER ? top : pickWeighted(def.segments);

    const streakState = userSnap.get("streak") as Partial<StreakState> | undefined;
    const streakDays = activeStreakCount(streakState, now);
    const streakBonus = streakBonusFor(tier as BoxTier, streakDays);
    const rewardCredits = baseCredits + streakBonus;

    const balance = await applyCredits(tx, uid, {
      delta: rewardCredits,
      type: "prize_box",
      idempotencyKey: `prize_${tier}_${openedAt}`,
      ref: tier,
      note: streakBonus > 0 ? `${tier} box (+${streakBonus} streak)` : `${tier} box`,
    });

    tx.update(userRef, { [`boxPity.${tier}`]: baseCredits === top ? 0 : sinceTop + 1 });
    tx.update(ref, {
      state: "claimed",
      rewardCredits,
      baseCredits,
      streakBonus,
      streakDays,
      claimedAt: now,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      duplicate: false,
      rewardCredits,
      baseCredits,
      streakBonus,
      streakDays,
      balance,
    };
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

  await ref.set(
    {
      state: "idle",
      openedAt: null,
      readyAt: null,
      rewardCredits: null,
      baseCredits: null,
      streakBonus: null,
      streakDays: null,
      claimedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
});

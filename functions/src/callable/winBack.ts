import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyCredits, db, PRIZE_BOXES, pickWeighted, requireAuth } from "../lib/economy";
import { canClaimWinBack, type WinBackState } from "../lib/winBack";

/** Returning-player Prize Box (silver odds). One per lapse, keyed by the lapse's lastDay. */
export const claimWinBackBox = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    const state = user.get("winBack") as Partial<WinBackState> | undefined;
    if (!canClaimWinBack(state)) throw new HttpsError("failed-precondition", "No welcome-back box right now.");
    const credits = pickWeighted(PRIZE_BOXES.silver.segments);
    const balance = await applyCredits(tx, uid, {
      delta: credits,
      type: "win_back",
      idempotencyKey: `winback_${state!.lastDay}`,
      ref: "win_back",
      note: "Welcome-back Prize Box",
    });
    const now = Date.now();
    tx.update(userRef, { "winBack.pending": false, "winBack.claimedAt": now });
    return { ok: true, credits: balance === null ? 0 : credits, balance };
  });
});

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { applyCredits, db, requireAuth } from "../lib/economy";

/** The first-bet tutorial's prize box. */
export const TUTORIAL_GIFT = 10;

/**
 * Pays the first-bet tutorial's prize box: 10 credits, once per account, and
 * only to a player who has never placed a bet (single, parlay or daily pick).
 * The ledger id is fixed per user, so replays, retries or a modified client
 * can't claim it twice (applyCredits returns null when it's already paid).
 */
export const claimTutorialGift = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const [user, bet, parlay] = await Promise.all([
      tx.get(userRef),
      tx.get(db.collection("bets").where("uid", "==", uid).limit(1)),
      tx.get(db.collection("slipParlays").where("uid", "==", uid).limit(1)),
    ]);
    const placed = ((user.get("stats.betsPlaced") as number | undefined) ?? 0) > 0 || !bet.empty || !parlay.empty;
    if (placed) throw new HttpsError("failed-precondition", "The first-bet prize box is only for players who haven't placed a bet yet.");
    const balance = await applyCredits(tx, uid, {
      delta: TUTORIAL_GIFT,
      type: "tutorial_gift",
      idempotencyKey: "tutorial_gift",
      ref: "tutorial",
      note: "First-bet tutorial prize box",
    });
    if (balance !== null) tx.update(userRef, { tutorialGiftAt: Date.now() });
    return { ok: true as const, credits: balance === null ? 0 : TUTORIAL_GIFT, balance, already: balance === null };
  });
});

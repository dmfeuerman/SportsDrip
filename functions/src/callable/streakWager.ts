import { HttpsError, onCall } from "firebase-functions/v2/https";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { activeStreakCount, nyDay, type StreakState } from "../lib/streak";
import { evaluateWager, WAGER_DAYS, WAGER_MULTIPLIER, WAGER_STAKES, type StreakWager } from "../lib/streakWager";

/**
 * streakWager({ action: "place", stake }) stakes credits on adding 7 days to
 * your pick streak. streakWager({ action: "settle" }) grades the open wager
 * against the streak the server already tracks; the client calls it when it
 * sees the wager is decided, and the result never depends on what it sends.
 */
export const streakWager = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const action = req.data?.action === "settle" ? "settle" : "place";
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("not-found", "Profile not found.");
    const now = Date.now();
    const streak = (user.get("streak") as Partial<StreakState> | undefined) ?? null;
    const open = (user.get("streakWager") as StreakWager | undefined) ?? null;

    if (action === "settle") {
      if (!open) return { ok: true as const, state: "none" as const, credits: 0 };
      const state = evaluateWager(open, streak, now);
      if (state === "active") return { ok: true as const, state, credits: 0 };
      const credits = state === "won" ? open.stake * WAGER_MULTIPLIER : 0;
      if (credits > 0) {
        await applyCredits(tx, uid, {
          delta: credits,
          type: "streak_wager",
          idempotencyKey: `streak_wager_win_${open.startDay}`,
          ref: open.startDay,
          note: `Streak wager won: ${WAGER_DAYS} days`,
        });
      }
      tx.update(userRef, { streakWager: FieldValue.delete(), streakWagerLast: { state, stake: open.stake, credits, at: now } });
      return { ok: true as const, state, credits };
    }

    const stake = Number(req.data?.stake);
    if (!(WAGER_STAKES as readonly number[]).includes(stake)) throw new HttpsError("invalid-argument", "Pick one of the listed stakes.");
    if (open) throw new HttpsError("failed-precondition", "You already have a streak wager running.");
    const breakUntil = user.get("limits.breakUntil") as number | undefined;
    if (breakUntil && breakUntil > now) throw new HttpsError("failed-precondition", "You're on a break. Wagers open again when it ends.");

    const startCount = activeStreakCount(streak, now);
    const startDay = nyDay(now);
    const wager: StreakWager = { stake, startCount, startDay, target: startCount + WAGER_DAYS };
    // Reads are done (applyCredits reads the same user doc first); now charge and record.
    await applyCredits(tx, uid, {
      delta: -stake,
      type: "streak_wager",
      idempotencyKey: `streak_wager_${startDay}`,
      ref: startDay,
      note: `Streak wager: ${WAGER_DAYS} more days`,
    });
    tx.update(userRef, { streakWager: wager });
    return { ok: true as const, state: "active" as const, wager };
  });
});

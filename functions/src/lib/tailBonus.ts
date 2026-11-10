import { logger } from "firebase-functions";
import { applyCredits, db, FieldValue } from "./economy";
import { writeNotification } from "./notify";
import { simpleNotification } from "./notifyModel";

/** Credits to the original picker each time a pick that tailed theirs wins. */
export const TAIL_BONUS = 10;
/** At most this many bonuses per original pick, so a big league can't farm it. */
export const TAIL_BONUS_CAP = 5;

/**
 * Pays the picker whose bet was tailed, after the tail's own settlement has
 * committed. One transaction per winning tail; the ledger id is the tailing
 * bet's id, so a re-run of settlement pays nothing twice.
 */
export async function payTailBonus(leagueId: string, tailBetId: string, sourceBetId: string, tailerName: string, now = Date.now()): Promise<boolean> {
  const sourceRef = db.collection("leagues").doc(leagueId).collection("leagueBets").doc(sourceBetId);
  try {
    return await db.runTransaction(async (tx) => {
      const source = await tx.get(sourceRef);
      if (!source.exists) return false;
      const paid = (source.get("tailBonuses") as number | undefined) ?? 0;
      if (paid >= TAIL_BONUS_CAP) return false;
      const uid = source.get("uid") as string;
      const balance = await applyCredits(tx, uid, {
        delta: TAIL_BONUS,
        type: "tail_bonus",
        idempotencyKey: `tail_bonus_${leagueId}_${tailBetId}`,
        ref: sourceBetId,
        note: `${tailerName} tailed your pick and won`,
      });
      if (balance === null) return false;
      tx.update(sourceRef, { tailBonuses: FieldValue.increment(1) });
      writeNotification(
        tx,
        uid,
        simpleNotification({
          id: `tail_bonus_${leagueId}_${tailBetId}`,
          type: "bet_tailed",
          title: `${tailerName} cashed your pick`,
          body: `They tailed ${(source.get("label") as string | undefined) ?? (source.get("teamAbbr") as string | undefined) ?? "your pick"} and won. +${TAIL_BONUS} credits for the call.`,
          delta: TAIL_BONUS,
          balanceAfter: balance,
          leagueId,
          now,
          data: { leagueId },
        })
      );
      return true;
    });
  } catch (err) {
    logger.warn("tail bonus failed", { leagueId, tailBetId, error: String(err) });
    return false;
  }
}

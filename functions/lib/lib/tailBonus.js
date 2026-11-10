"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAIL_BONUS_CAP = exports.TAIL_BONUS = void 0;
exports.payTailBonus = payTailBonus;
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
/** Credits to the original picker each time a pick that tailed theirs wins. */
exports.TAIL_BONUS = 10;
/** At most this many bonuses per original pick, so a big league can't farm it. */
exports.TAIL_BONUS_CAP = 5;
/**
 * Pays the picker whose bet was tailed, after the tail's own settlement has
 * committed. One transaction per winning tail; the ledger id is the tailing
 * bet's id, so a re-run of settlement pays nothing twice.
 */
async function payTailBonus(leagueId, tailBetId, sourceBetId, tailerName, now = Date.now()) {
    const sourceRef = economy_1.db.collection("leagues").doc(leagueId).collection("leagueBets").doc(sourceBetId);
    try {
        return await economy_1.db.runTransaction(async (tx) => {
            const source = await tx.get(sourceRef);
            if (!source.exists)
                return false;
            const paid = source.get("tailBonuses") ?? 0;
            if (paid >= exports.TAIL_BONUS_CAP)
                return false;
            const uid = source.get("uid");
            const balance = await (0, economy_1.applyCredits)(tx, uid, {
                delta: exports.TAIL_BONUS,
                type: "tail_bonus",
                idempotencyKey: `tail_bonus_${leagueId}_${tailBetId}`,
                ref: sourceBetId,
                note: `${tailerName} tailed your pick and won`,
            });
            if (balance === null)
                return false;
            tx.update(sourceRef, { tailBonuses: economy_1.FieldValue.increment(1) });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                id: `tail_bonus_${leagueId}_${tailBetId}`,
                type: "bet_tailed",
                title: `${tailerName} cashed your pick`,
                body: `They tailed ${source.get("label") ?? source.get("teamAbbr") ?? "your pick"} and won. +${exports.TAIL_BONUS} credits for the call.`,
                delta: exports.TAIL_BONUS,
                balanceAfter: balance,
                leagueId,
                now,
                data: { leagueId },
            }));
            return true;
        });
    }
    catch (err) {
        firebase_functions_1.logger.warn("tail bonus failed", { leagueId, tailBetId, error: String(err) });
        return false;
    }
}
//# sourceMappingURL=tailBonus.js.map
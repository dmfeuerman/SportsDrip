"use strict";
/**
 * Season trophies, badges, and last-place punishments.
 *
 * At league finalization (`finalizeLeague`), champions receive a permanent
 * trophy doc (`users/{uid}/trophies/champ_{leagueId}`) plus the champion crown
 * in their inventory (`source: "trophy"`). Last place (in leagues of 2+ members)
 * receives a last-place badge and a forced punishment cosmetic worn for 7 days.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUNISHMENT_DURATION_MS = exports.PUNISHMENT_ITEM_ID = exports.CHAMPION_ITEM_ID = void 0;
exports.applySeasonAwards = applySeasonAwards;
exports.expirePunishments = expirePunishments;
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
const avatar_1 = require("../callable/avatar");
exports.CHAMPION_ITEM_ID = "hat_gold_crown";
exports.PUNISHMENT_ITEM_ID = "hat_bubblegum_beanie";
exports.PUNISHMENT_DURATION_MS = 7 * 86_400_000;
async function applySeasonAwards(leagueId, leagueName, results, now = Date.now()) {
    if (results.length === 0)
        return;
    const champ = results[0];
    const champUserRef = economy_1.db.collection("users").doc(champ.memberId);
    await Promise.all([
        champUserRef.collection("trophies").doc(`champ_${leagueId}`).set({
            id: `champ_${leagueId}`,
            kind: "champion",
            title: `${leagueName} Champion`,
            leagueId,
            leagueName,
            rank: 1,
            netWorth: champ.netWorth,
            itemId: exports.CHAMPION_ITEM_ID,
            awardedAt: now,
        }, { merge: true }),
        champUserRef.collection("inventory").doc(exports.CHAMPION_ITEM_ID).set({
            itemId: exports.CHAMPION_ITEM_ID,
            slot: "hat",
            source: "trophy",
            pricePaid: 0,
            leagueId,
            acquiredAt: economy_1.FieldValue.serverTimestamp(),
        }, { merge: true }),
    ]);
    if (results.length >= 2) {
        const loser = results[results.length - 1];
        if (loser.memberId !== champ.memberId && loser.netWorth < champ.netWorth) {
            const loserRef = economy_1.db.collection("users").doc(loser.memberId);
            const expiresAt = now + exports.PUNISHMENT_DURATION_MS;
            await Promise.all([
                loserRef.collection("trophies").doc(`last_${leagueId}`).set({
                    id: `last_${leagueId}`,
                    kind: "last_place",
                    title: `${leagueName} Last Place`,
                    leagueId,
                    leagueName,
                    rank: results.length,
                    netWorth: loser.netWorth,
                    itemId: exports.PUNISHMENT_ITEM_ID,
                    expiresAt,
                    awardedAt: now,
                }, { merge: true }),
                loserRef.collection("inventory").doc(exports.PUNISHMENT_ITEM_ID).set({
                    itemId: exports.PUNISHMENT_ITEM_ID,
                    slot: "hat",
                    source: "trophy",
                    pricePaid: 0,
                    leagueId,
                    expiresAt,
                    acquiredAt: economy_1.FieldValue.serverTimestamp(),
                }, { merge: true }),
                loserRef.set({
                    punishment: {
                        itemId: exports.PUNISHMENT_ITEM_ID,
                        slot: "hat",
                        leagueId,
                        leagueName,
                        expiresAt,
                    },
                }, { merge: true }),
            ]);
            try {
                await (0, avatar_1.equipOne)(loser.memberId, "hat", exports.PUNISHMENT_ITEM_ID);
            }
            catch (err) {
                firebase_functions_1.logger.warn("couldn't equip punishment item", {
                    leagueId,
                    uid: loser.memberId,
                    err: String(err),
                });
            }
        }
    }
}
/** Clears forced punishment items whose 7-day window has elapsed. */
async function expirePunishments(now = Date.now()) {
    const snaps = await economy_1.db
        .collection("users")
        .where("punishment.expiresAt", "<=", now)
        .limit(200)
        .get();
    let cleared = 0;
    for (const doc of snaps.docs) {
        await doc.ref.update({ punishment: economy_1.FieldValue.delete() });
        cleared++;
    }
    return cleared;
}
//# sourceMappingURL=awards.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeFlashPick = void 0;
exports.settleFlashForGame = settleFlashForGame;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const flash_1 = require("../lib/flash");
const streak_1 = require("../lib/streak");
/**
 * makeFlashPick({ gameId, side, stake? }): "who scores next?" on a live game.
 *
 * First FLASH_FREE_PER_DAY (3) picks each day are free (0 stake, +200 credits).
 * Once the 3 free daily picks are spent, players can place unlimited paid live
 * picks by supplying `stake` (credits), deducted up front and paying
 * Math.round(stake * 1.91) on a win (or refunded on a push). Strictly 1 active
 * pending pick per game at a time.
 */
exports.makeFlashPick = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const gameId = String(req.data?.gameId ?? "");
    const side = req.data?.side;
    const rawStake = req.data?.stake;
    if (!gameId || (side !== "home" && side !== "away"))
        throw new https_1.HttpsError("invalid-argument", "Pick a team.");
    const userRef = economy_1.db.collection("users").doc(uid);
    const gameRef = economy_1.db.collection("games").doc(gameId);
    const pendingQuery = economy_1.db
        .collection("flashPicks")
        .where("uid", "==", uid)
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(1);
    return economy_1.db.runTransaction(async (tx) => {
        const [user, game, pendingSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(gameRef),
            tx.get(pendingQuery),
        ]);
        if (!user.exists)
            throw new https_1.HttpsError("not-found", "Profile not found.");
        if (!game.exists || game.get("status") !== "live" || game.get("disrupted")) {
            throw new https_1.HttpsError("failed-precondition", "Live picks open while the game is live.");
        }
        const now = Date.now();
        const breakUntil = user.get("limits.breakUntil");
        if (breakUntil && breakUntil > now)
            throw new https_1.HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");
        if (!pendingSnap.empty) {
            throw new https_1.HttpsError("failed-precondition", "You already have a live pick riding on this game.");
        }
        const day = (0, streak_1.nyDay)(now);
        const prev = user.get("flashToday");
        const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
        const freeCount = prev?.day === day ? Math.max(0, prev.freeCount ?? Math.min(prev.count ?? 0, flash_1.FLASH_FREE_PER_DAY)) : 0;
        const isFree = freeCount < flash_1.FLASH_FREE_PER_DAY;
        let stake = 0;
        let reward = flash_1.FLASH_REWARD;
        const home = game.get("homeTeam");
        const away = game.get("awayTeam");
        const teamAbbr = (side === "home" ? home?.abbreviation : away?.abbreviation) ?? side.toUpperCase();
        const pickRef = economy_1.db.collection("flashPicks").doc();
        if (!isFree) {
            const parsed = typeof rawStake === "number" ? Math.floor(rawStake) : Number.parseInt(String(rawStake ?? ""), 10);
            if (!Number.isFinite(parsed) || parsed < flash_1.FLASH_MIN_STAKE || parsed > flash_1.FLASH_MAX_STAKE) {
                throw new https_1.HttpsError("invalid-argument", `Choose a live stake between ${flash_1.FLASH_MIN_STAKE} and ${flash_1.FLASH_MAX_STAKE.toLocaleString()} credits.`);
            }
            stake = parsed;
            reward = Math.round(stake * flash_1.FLASH_PAID_ODDS);
            // Must run before any tx.set / tx.update so Firestore reads precede writes.
            await (0, economy_1.applyCredits)(tx, uid, {
                delta: -stake,
                type: "flash_pick",
                idempotencyKey: `flash_stake_${pickRef.id}`,
                ref: gameId,
                note: `Live pick: ${teamAbbr} scores next`,
            });
        }
        const nextFreeCount = isFree ? freeCount + 1 : freeCount;
        const pick = {
            uid,
            gameId,
            sport: game.get("sport") ?? null,
            side,
            teamAbbr,
            homeAt: game.get("homeScore") ?? 0,
            awayAt: game.get("awayScore") ?? 0,
            stake,
            paid: !isFree,
            odds: isFree ? null : flash_1.FLASH_PAID_ODDS,
            reward,
            status: "pending",
            createdAt: now,
            settledAt: null,
        };
        tx.set(pickRef, pick);
        tx.update(userRef, { flashToday: { day, count: count + 1, freeCount: nextFreeCount } });
        return {
            ok: true,
            id: pickRef.id,
            freeLeft: Math.max(0, flash_1.FLASH_FREE_PER_DAY - nextFreeCount),
            stake,
            reward,
            paid: !isFree,
        };
    });
});
/**
 * Grades every open flash pick on a game against the scoreboard just written.
 * Called from the games trigger when a score changes or the game ends.
 * Each pick settles in its own transaction; the ledger id makes a replay a no-op.
 */
async function settleFlashForGame(gameId, home, away, status) {
    const open = await economy_1.db.collection("flashPicks").where("gameId", "==", gameId).where("status", "==", "pending").limit(500).get();
    let settled = 0;
    for (const doc of open.docs) {
        const outcome = (0, flash_1.decideFlash)({ side: doc.get("side"), homeAt: doc.get("homeAt"), awayAt: doc.get("awayAt") }, home, away, status);
        if (!outcome)
            continue;
        try {
            await economy_1.db.runTransaction(async (tx) => {
                const fresh = await tx.get(doc.ref);
                if (!fresh.exists || fresh.get("status") !== "pending")
                    return;
                const uid = fresh.get("uid");
                const stake = fresh.get("stake") ?? 0;
                if (outcome === "won") {
                    await (0, economy_1.applyCredits)(tx, uid, {
                        delta: fresh.get("reward") ?? flash_1.FLASH_REWARD,
                        type: "flash_pick",
                        idempotencyKey: `flash_${doc.id}`,
                        ref: gameId,
                        note: `Flash pick: ${fresh.get("teamAbbr")} scored next`,
                    });
                }
                else if (outcome === "push" && stake > 0) {
                    await (0, economy_1.applyCredits)(tx, uid, {
                        delta: stake,
                        type: "bet_refund",
                        idempotencyKey: `flash_refund_${doc.id}`,
                        ref: gameId,
                        note: `Live pick push refund: ${fresh.get("teamAbbr")}`,
                    });
                }
                tx.update(doc.ref, { status: outcome, settledAt: Date.now(), homeEnd: home, awayEnd: away });
            });
            settled++;
        }
        catch (err) {
            firebase_functions_1.logger.warn("flash pick settle failed", { id: doc.id, error: String(err) });
        }
    }
    return settled;
}
//# sourceMappingURL=flash.js.map
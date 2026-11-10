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
 * makeFlashPick({ gameId, side }): a free "who scores next?" call on a live game.
 * flashPicks/{uid}_{gameId}_{n}; one open pick per game, FLASH_PER_GAME per
 * game, FLASH_PER_DAY per day. The scoreboard at pick time is snapshotted
 * server-side, so the client can't choose a favourable baseline.
 */
exports.makeFlashPick = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const gameId = String(req.data?.gameId ?? "");
    const side = req.data?.side;
    if (!gameId || (side !== "home" && side !== "away"))
        throw new https_1.HttpsError("invalid-argument", "Pick a team.");
    const userRef = economy_1.db.collection("users").doc(uid);
    const gameRef = economy_1.db.collection("games").doc(gameId);
    const slot = (n) => economy_1.db.collection("flashPicks").doc(`${uid}_${gameId}_${n}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [user, game, ...slots] = await Promise.all([
            tx.get(userRef),
            tx.get(gameRef),
            ...Array.from({ length: flash_1.FLASH_PER_GAME }, (_, n) => tx.get(slot(n))),
        ]);
        if (!user.exists)
            throw new https_1.HttpsError("not-found", "Profile not found.");
        if (!game.exists || game.get("status") !== "live" || game.get("disrupted")) {
            throw new https_1.HttpsError("failed-precondition", "Flash picks open while the game is live.");
        }
        const now = Date.now();
        const breakUntil = user.get("limits.breakUntil");
        if (breakUntil && breakUntil > now)
            throw new https_1.HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");
        if (slots.some((s) => s.exists && s.get("status") === "pending")) {
            throw new https_1.HttpsError("failed-precondition", "You already have a flash pick riding on this game.");
        }
        const n = slots.findIndex((s) => !s.exists);
        if (n < 0)
            throw new https_1.HttpsError("resource-exhausted", `That's all ${flash_1.FLASH_PER_GAME} flash picks for this game.`);
        const day = (0, streak_1.nyDay)(now);
        const prev = user.get("flashToday");
        const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
        if (count >= flash_1.FLASH_PER_DAY)
            throw new https_1.HttpsError("resource-exhausted", "You've used today's flash picks. They reset at midnight ET.");
        const home = game.get("homeTeam");
        const away = game.get("awayTeam");
        const pick = {
            uid,
            gameId,
            sport: game.get("sport") ?? null,
            side,
            teamAbbr: (side === "home" ? home?.abbreviation : away?.abbreviation) ?? side.toUpperCase(),
            homeAt: game.get("homeScore") ?? 0,
            awayAt: game.get("awayScore") ?? 0,
            reward: flash_1.FLASH_REWARD,
            status: "pending",
            createdAt: now,
            settledAt: null,
        };
        tx.set(slot(n), pick);
        tx.update(userRef, { flashToday: { day, count: count + 1 } });
        return { ok: true, id: slot(n).id, left: flash_1.FLASH_PER_GAME - n - 1, leftToday: flash_1.FLASH_PER_DAY - count - 1 };
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
                if (outcome === "won") {
                    await (0, economy_1.applyCredits)(tx, uid, {
                        delta: fresh.get("reward") ?? flash_1.FLASH_REWARD,
                        type: "flash_pick",
                        idempotencyKey: `flash_${doc.id}`,
                        ref: gameId,
                        note: `Flash pick: ${fresh.get("teamAbbr")} scored next`,
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
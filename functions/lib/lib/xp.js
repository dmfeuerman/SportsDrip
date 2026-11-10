"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLevelUnlocks = readLevelUnlocks;
exports.grantXp = grantXp;
const economy_1 = require("./economy");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
const progression_1 = require("./progression");
const seasonPass_1 = require("./seasonPass");
/**
 * Reads every level reward at or below `level` that this player doesn't own.
 * Reads only: call `write()` after the transaction's other reads.
 */
async function readLevelUnlocks(tx, uid, level) {
    const userRef = economy_1.db.collection("users").doc(uid);
    const [items, bgs] = await Promise.all([
        tx.get(economy_1.db.collection("catalog").where("levelReward", "<=", level)),
        tx.get(economy_1.db.collection("backgrounds").where("levelReward", "<=", level)),
    ]);
    const candidates = [];
    for (const d of items.docs) {
        const lv = d.get("levelReward");
        if (typeof lv !== "number" || lv < 1)
            continue;
        candidates.push({ kind: "item", id: d.id, name: d.get("name") ?? d.id, level: lv, ref: userRef.collection("inventory").doc(d.id), slot: d.get("slot") });
    }
    for (const d of bgs.docs) {
        const lv = d.get("levelReward");
        if (typeof lv !== "number" || lv < 1)
            continue;
        candidates.push({ kind: "background", id: d.id, name: d.get("name") ?? d.id, level: lv, ref: userRef.collection("backgrounds").doc(d.id) });
    }
    const owned = await Promise.all(candidates.map((c) => tx.get(c.ref)));
    const missing = candidates.filter((_, i) => !owned[i].exists);
    return {
        unlocks: missing.map(({ kind, id, name, level: lv }) => ({ kind, id, name, level: lv })),
        write: () => {
            for (const m of missing) {
                tx.set(m.ref, m.kind === "item"
                    ? { itemId: m.id, slot: m.slot ?? null, source: "level", level: m.level, acquiredAt: economy_1.FieldValue.serverTimestamp() }
                    : { backgroundId: m.id, source: "level", level: m.level, acquiredAt: economy_1.FieldValue.serverTimestamp() });
            }
        },
    };
}
/**
 * Adds `amount` XP once per `key` (users/{uid}/xpEvents/{key}). Safe to call
 * from retried triggers. Returns what happened, for tests and callers.
 */
async function grantXp(uid, amount, key, reason) {
    const userRef = economy_1.db.collection("users").doc(uid);
    const eventRef = userRef.collection("xpEvents").doc(key);
    const none = (xp = 0) => ({ applied: false, xp, level: (0, progression_1.levelFromXp)(xp), levelsGained: 0, credits: 0, unlocks: [] });
    if (!(amount > 0) || !Number.isFinite(amount))
        return none();
    // Season pass XP: a parallel counter, only from quests and Daily Picks.
    const season = seasonPass_1.SEASON_XP_REASONS.has(reason) ? await (0, seasonPass_1.activeSeason)().catch(() => null) : null;
    return economy_1.db.runTransaction(async (tx) => {
        const [user, ev] = await Promise.all([tx.get(userRef), tx.get(eventRef)]);
        if (!user.exists)
            return none();
        const before = user.get("xp") ?? 0;
        if (ev.exists)
            return none(before);
        const oldLevel = (0, progression_1.levelFromXp)(before);
        amount = (0, progression_1.scaledXp)(Math.floor(amount), oldLevel);
        const after = before + amount;
        const newLevel = (0, progression_1.levelFromXp)(after);
        // ── reads (all before the first write) ──
        const crossed = [];
        for (let l = oldLevel + 1; l <= newLevel; l++)
            crossed.push(l);
        const ledgerRefs = crossed.map((l) => userRef.collection("ledger").doc(`level_${l}`));
        const paid = await Promise.all(ledgerRefs.map((r) => tx.get(r)));
        const pending = crossed.length ? await readLevelUnlocks(tx, uid, newLevel) : null;
        // ── writes ──
        let balance = user.get("balance") ?? 0;
        let credits = 0;
        crossed.forEach((l, i) => {
            if (paid[i].exists)
                return;
            const c = (0, progression_1.levelUpCredits)(l);
            if (c <= 0)
                return;
            balance += c;
            credits += c;
            tx.set(ledgerRefs[i], {
                type: "level_reward",
                delta: c,
                balanceAfter: balance,
                ref: `level:${l}`,
                note: `Reached level ${l}`,
                createdAt: economy_1.FieldValue.serverTimestamp(),
            });
        });
        pending?.write();
        tx.set(eventRef, { amount: Math.floor(amount), reason, xpAfter: after, createdAt: economy_1.FieldValue.serverTimestamp() });
        tx.update(userRef, {
            xp: after,
            level: newLevel,
            ...(season ? { [`seasonXp.${season.id}`]: economy_1.FieldValue.increment(Math.floor(amount)) } : {}),
            ...(credits > 0 ? { balance } : {}),
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        const unlocks = pending?.unlocks ?? [];
        if (crossed.length) {
            const parts = [credits > 0 ? `+${credits.toLocaleString("en-US")} credits` : null, ...unlocks.map((u) => u.name)].filter(Boolean);
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                id: `level_${newLevel}`,
                type: "level_up",
                title: `Level ${newLevel} reached`,
                body: parts.length ? `Unlocked: ${parts.join(" · ")}` : "Keep winning to climb.",
                now: Date.now(),
                delta: credits,
                balanceAfter: credits > 0 ? balance : null,
                data: { level: String(newLevel), from: String(oldLevel), unlocks: unlocks.map((u) => `${u.kind}:${u.id}`).join(",") },
            }));
        }
        return { applied: true, xp: after, level: newLevel, levelsGained: crossed.length, credits, unlocks };
    });
}
//# sourceMappingURL=xp.js.map
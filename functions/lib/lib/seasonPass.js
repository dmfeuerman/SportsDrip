"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEASON_XP_REASONS = void 0;
exports.validateSeason = validateSeason;
exports.activeSeason = activeSeason;
exports.resetSeasonCache = resetSeasonCache;
exports.writeSeasonReward = writeSeasonReward;
const economy_1 = require("./economy");
exports.SEASON_XP_REASONS = new Set(["quest", "daily_pick"]);
/** Throws on a config that breaks the rules. Run in tests and before writing a season doc. */
function validateSeason(s) {
    if (!s.id || !(s.endsAt > s.startsAt))
        throw new Error(`season ${s.id}: bad window`);
    const check = (tiers, track) => {
        let prev = 0;
        for (const t of tiers) {
            if (!(t.xp > prev))
                throw new Error(`season ${s.id} ${track}: tier xp must strictly increase`);
            prev = t.xp;
            if (t.reward.kind === "credits" && !(t.reward.amount > 0))
                throw new Error(`season ${s.id} ${track}: credits must be > 0`);
        }
    };
    check(s.tiers, "free");
    if (s.premium) {
        check(s.premium.tiers, "premium");
        if (!(s.premium.price > 0))
            throw new Error(`season ${s.id}: premium price must be > 0`);
        // The pass can never pay for the next pass.
        const credits = [...s.tiers, ...s.premium.tiers].reduce((n, t) => n + (t.reward.kind === "credits" ? t.reward.amount : 0), 0);
        if (credits >= s.premium.price) {
            throw new Error(`season ${s.id}: tracks award ${credits} credits, which buys the next ${s.premium.price}-credit pass`);
        }
    }
}
let cache = null;
/** The season running at `now`, cached for a minute per instance. */
async function activeSeason(now = Date.now()) {
    if (cache && now - cache.at < 60_000)
        return cache.season && cache.season.endsAt > now && cache.season.startsAt <= now ? cache.season : null;
    const snap = await economy_1.db.collection("seasons").where("endsAt", ">", now).orderBy("endsAt").limit(3).get().catch(() => null);
    const season = snap?.docs.map((d) => ({ ...d.data(), id: d.id })).find((s) => s.startsAt <= now) ?? null;
    cache = { at: now, season };
    return season;
}
function resetSeasonCache() {
    cache = null;
}
/** Applies a tier reward inside a transaction (writes only; caller did the reads). */
function writeSeasonReward(tx, uid, seasonId, tierIndex, r, balance, slot = null) {
    const userRef = economy_1.db.collection("users").doc(uid);
    const src = { source: "season", seasonId, tier: tierIndex, acquiredAt: economy_1.FieldValue.serverTimestamp() };
    if (r.kind === "item")
        tx.set(userRef.collection("inventory").doc(r.id), { itemId: r.id, slot: slot ?? null, ...src });
    else if (r.kind === "background")
        tx.set(userRef.collection("backgrounds").doc(r.id), { backgroundId: r.id, ...src });
    else if (r.kind === "move")
        tx.set(userRef.collection("moves").doc(r.id), { moveId: r.id, ...src });
    else {
        balance += r.amount;
        tx.set(userRef.collection("ledger").doc(`season_${seasonId}_${tierIndex}`), {
            type: "season_reward",
            delta: r.amount,
            balanceAfter: balance,
            ref: `season:${seasonId}:${tierIndex}`,
            note: `Season tier ${tierIndex + 1}`,
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
        tx.update(userRef, { balance });
    }
    return balance;
}
//# sourceMappingURL=seasonPass.js.map
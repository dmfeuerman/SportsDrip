"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coopTarget = void 0;
exports.coopEnabled = coopEnabled;
exports.recordCoopWins = recordCoopWins;
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
const experiments_1 = require("./experiments");
const weekly_1 = require("./weekly");
/**
 * League co-op goals (experimental, behind coop_goals_v1, leagueId unit).
 * leagues/{id}/coop/{week}: { target, progress, contributions, counted, rewardItemId, completedAt }.
 * target = clamp(5 × members, 20, 80) correct picks; the reward id comes from
 * meta/coopRewards.current (live-ops). Runs after settlement commits; each won
 * bet is counted once (counted.{betId}), so replays are no-ops.
 */
const coopTarget = (members) => Math.min(80, Math.max(20, 5 * members));
exports.coopTarget = coopTarget;
async function coopEnabled(leagueId) {
    const exp = await economy_1.db.collection("meta").doc("experiments").get().catch(() => null);
    return (0, experiments_1.assignArm)(exp?.exists ? exp.data() : null, experiments_1.EXPERIMENTS.coopGoals, { uid: leagueId, leagueId }) === "treatment";
}
async function recordCoopWins(wins, now = Date.now()) {
    const byLeague = new Map();
    for (const w of wins)
        byLeague.set(w.leagueId, [...(byLeague.get(w.leagueId) ?? []), w]);
    let completed = 0;
    const rewards = await economy_1.db.collection("meta").doc("coopRewards").get().catch(() => null);
    const rewardItemId = rewards?.get("current") ?? null;
    for (const [leagueId, rows] of byLeague) {
        if (!(await coopEnabled(leagueId)))
            continue;
        try {
            const done = await economy_1.db.runTransaction(async (tx) => {
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const week = (0, weekly_1.weekKey)(now);
                const coopRef = leagueRef.collection("coop").doc(week);
                const [league, coop] = await Promise.all([tx.get(leagueRef), tx.get(coopRef)]);
                if (!league.exists || league.get("status") !== "active")
                    return null;
                const memberIds = league.get("memberIds") ?? [];
                const counted = { ...(coop.get("counted") ?? {}) };
                const contributions = { ...(coop.get("contributions") ?? {}) };
                const fresh = rows.filter((r) => !counted[r.betId]);
                if (!fresh.length)
                    return null;
                for (const r of fresh) {
                    counted[r.betId] = true;
                    contributions[r.uid] = (contributions[r.uid] ?? 0) + 1;
                }
                const target = coop.get("target") ?? (0, exports.coopTarget)(memberIds.length);
                const progress = (coop.get("progress") ?? 0) + fresh.length;
                const reward = coop.get("rewardItemId") ?? rewardItemId;
                const justCompleted = !coop.get("completedAt") && progress >= target;
                // Reads for the grant (before any write).
                const item = justCompleted && reward ? await tx.get(economy_1.db.collection("catalog").doc(reward)) : null;
                const owned = justCompleted && reward ? await Promise.all(memberIds.map((u) => tx.get(economy_1.db.collection("users").doc(u).collection("inventory").doc(reward)))) : [];
                tx.set(coopRef, { week, target, progress, contributions, counted, rewardItemId: reward ?? null, updatedAt: now, ...(justCompleted ? { completedAt: now } : {}) }, { merge: true });
                if (justCompleted) {
                    if (reward && item?.exists) {
                        memberIds.forEach((u, i) => {
                            if (owned[i]?.exists)
                                return;
                            tx.set(economy_1.db.collection("users").doc(u).collection("inventory").doc(reward), {
                                itemId: reward,
                                slot: item.get("slot") ?? null,
                                source: "coop",
                                leagueId,
                                week,
                                acquiredAt: economy_1.FieldValue.serverTimestamp(),
                            });
                        });
                    }
                    tx.set(leagueRef.collection("messages").doc(`coop_${week}`), {
                        uid: "system",
                        name: "SportDrip",
                        kind: "system",
                        text: `🤝 League goal hit: ${target} correct picks this week!${reward && item?.exists ? ` Everyone unlocked ${item.get("name") ?? "a new item"}.` : ""}`,
                        at: now,
                        reactions: {},
                        reactors: {},
                    });
                }
                return justCompleted;
            });
            if (done)
                completed++;
        }
        catch (err) {
            firebase_functions_1.logger.warn("coop update failed", { leagueId, error: String(err) });
        }
    }
    return completed;
}
//# sourceMappingURL=coop.js.map
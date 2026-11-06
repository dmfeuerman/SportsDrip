"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockParlay = exports.rideParlay = exports.addParlayLeg = exports.createGroupParlay = void 0;
exports.gradeParlays = gradeParlays;
exports.voidDisruptedParlayLegs = voidDisruptedParlayLegs;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const gameState_1 = require("../lib/gameState");
const leagueConfig_1 = require("../lib/leagueConfig");
const parlay_1 = require("../lib/parlay");
const pricing_1 = require("../lib/pricing");
const settlement_1 = require("../lib/settlement");
/**
 * Group Parlays (`leagues/{leagueId}/parlays/{parlayId}`).
 *
 *  - `createGroupParlay`: starts a shared parlay ticket in a league (with an
 *    optional first leg and creator stake).
 *  - `addParlayLeg`: a member adds one leg (up to 4 legs total, one leg per
 *    game, combined price capped at 20x).
 *  - `rideParlay`: a member joins the ticket at their own stake in league tokens.
 *  - `lockParlay`: locks the ticket once it has 2–4 legs.
 *  - `gradeParlays`: grades finished games; if any leg loses, records `bustedBy`
 *    and posts a chat/feed row calling out whose leg killed the parlay.
 */
const Key = zod_1.z.string().min(8).max(64);
const LegSpecSchema = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]).optional(),
    market: zod_1.z.enum(["ml", "spread", "total"]).optional(),
    selection: zod_1.z.enum(["home", "away", "over", "under"]).optional(),
    expectedOdds: zod_1.z.number().positive().max(100).optional(),
    expectedLine: zod_1.z.number().finite().optional(),
});
const CreateParlayInput = zod_1.z.object({
    leagueId: zod_1.z.string().min(1),
    idempotencyKey: Key,
    stake: zod_1.z.number().int().min(leagueConfig_1.MIN_LEAGUE_STAKE).max(10_000_000).optional(),
    leg: LegSpecSchema.optional(),
});
function buildLegFromGame(uid, name, game, spec, league, now) {
    if (!game.exists)
        throw new https_1.HttpsError("not-found", "That game is no longer available.");
    if (game.get("status") !== "upcoming") {
        throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
    }
    const startsAt = game.get("startsAt") ?? 0;
    if (startsAt && startsAt <= now) {
        throw new https_1.HttpsError("failed-precondition", "This game has already started.");
    }
    if (startsAt && startsAt >= (league.get("endsAt") ?? Infinity)) {
        throw new https_1.HttpsError("failed-precondition", "That game starts after this league's season ends.");
    }
    const allowed = league.get("allowedSports") ?? [];
    if (!allowed.includes(game.get("sport"))) {
        throw new https_1.HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
    }
    const priced = (0, pricing_1.requirePricedMarket)(game, spec);
    return {
        uid,
        name,
        gameId: spec.gameId,
        sport: game.get("sport"),
        market: priced.market,
        selection: priced.selection,
        side: priced.side,
        line: priced.line,
        label: priced.label,
        teamAbbr: priced.teamAbbr,
        opponentAbbr: priced.opponentAbbr,
        odds: priced.odds,
        startsAt,
        status: "pending",
    };
}
exports.createGroupParlay = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = CreateParlayInput.parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const parlayId = `parlay_${uid.slice(0, 8)}_${input.idempotencyKey}`;
    const parlayRef = leagueRef.collection("parlays").doc(parlayId);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, league, game] = await Promise.all([
            tx.get(parlayRef),
            tx.get(leagueRef),
            input.leg ? tx.get(economy_1.db.collection("games").doc(input.leg.gameId)) : Promise.resolve(null),
        ]);
        if (existing.exists)
            return { ok: true, parlayId, duplicate: true };
        const now = Date.now();
        if (!league.exists || league.get("status") !== "active") {
            throw new https_1.HttpsError("failed-precondition", "That league is not active.");
        }
        if (!(0, leagueConfig_1.leagueStarted)(league, now))
            throw new https_1.HttpsError("failed-precondition", "This league hasn't started yet.");
        const me = league.get(`members.${uid}`);
        if (!me)
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        const legs = [];
        if (input.leg && game) {
            legs.push(buildLegFromGame(uid, me.displayName, game, input.leg, league, now));
        }
        const riders = {};
        if (input.stake !== undefined) {
            if (input.stake > (0, parlay_1.parlayStakeCap)(me.leagueTokens)) {
                throw new https_1.HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(parlay_1.MAX_PARLAY_SHARE * 100)}% of your wallet (${(0, parlay_1.parlayStakeCap)(me.leagueTokens).toLocaleString("en-US")} tokens).`);
            }
            if (input.stake > me.leagueTokens) {
                throw new https_1.HttpsError("failed-precondition", "Not enough league tokens.");
            }
            riders[uid] = { uid, name: me.displayName, stake: input.stake };
            tx.update(leagueRef, {
                [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
                lastActivityAt: now,
            });
        }
        const combinedOdds = (0, parlay_1.combinedParlayOdds)(legs);
        tx.set(parlayRef, {
            id: parlayId,
            leagueId: input.leagueId,
            creatorUid: uid,
            creatorName: me.displayName,
            status: "open",
            legs,
            riders,
            combinedOdds,
            bustedBy: null,
            bustedByName: null,
            bustedLeg: null,
            createdAt: now,
            settledAt: null,
        });
        tx.set(leagueRef.collection("activity").doc(`parlay_open_${parlayId}`), {
            type: "parlay_opened",
            uid,
            name: me.displayName,
            amount: input.stake ?? 0,
            text: `${me.displayName} started a Group Parlay`,
            at: now,
        });
        return { ok: true, parlayId, duplicate: false, combinedOdds };
    });
});
exports.addParlayLeg = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        parlayId: zod_1.z.string().min(1),
        gameId: zod_1.z.string().min(1),
        side: zod_1.z.enum(["home", "away"]).optional(),
        market: zod_1.z.enum(["ml", "spread", "total"]).optional(),
        selection: zod_1.z.enum(["home", "away", "over", "under"]).optional(),
        expectedOdds: zod_1.z.number().positive().max(100).optional(),
        expectedLine: zod_1.z.number().finite().optional(),
        stake: zod_1.z.number().int().min(leagueConfig_1.MIN_LEAGUE_STAKE).max(10_000_000).optional(),
    })
        .parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);
    const gameRef = economy_1.db.collection("games").doc(input.gameId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, parlay, game] = await Promise.all([
            tx.get(leagueRef),
            tx.get(parlayRef),
            tx.get(gameRef),
        ]);
        const now = Date.now();
        if (!league.exists || league.get("status") !== "active") {
            throw new https_1.HttpsError("failed-precondition", "That league is not active.");
        }
        if (!(0, leagueConfig_1.leagueStarted)(league, now))
            throw new https_1.HttpsError("failed-precondition", "This league hasn't started yet.");
        const me = league.get(`members.${uid}`);
        if (!me)
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        if (!parlay.exists)
            throw new https_1.HttpsError("not-found", "Parlay not found.");
        if (parlay.get("status") !== "open") {
            throw new https_1.HttpsError("failed-precondition", "That parlay is already locked.");
        }
        const legs = [...(parlay.get("legs") ?? [])];
        if (legs.length >= parlay_1.MAX_PARLAY_LEGS) {
            throw new https_1.HttpsError("failed-precondition", `Group parlays cap at ${parlay_1.MAX_PARLAY_LEGS} legs.`);
        }
        if (legs.some((l) => l.uid === uid)) {
            throw new https_1.HttpsError("already-exists", "You already added a leg to this parlay.");
        }
        if (legs.some((l) => l.gameId === input.gameId)) {
            throw new https_1.HttpsError("already-exists", "That game is already on this parlay.");
        }
        const newLeg = buildLegFromGame(uid, me.displayName, game, input, league, now);
        legs.push(newLeg);
        const combinedOdds = (0, parlay_1.combinedParlayOdds)(legs);
        const riders = { ...(parlay.get("riders") ?? {}) };
        if (input.stake !== undefined && !riders[uid]) {
            if (input.stake > (0, parlay_1.parlayStakeCap)(me.leagueTokens)) {
                throw new https_1.HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(parlay_1.MAX_PARLAY_SHARE * 100)}% of your wallet (${(0, parlay_1.parlayStakeCap)(me.leagueTokens).toLocaleString("en-US")} tokens).`);
            }
            if (input.stake > me.leagueTokens) {
                throw new https_1.HttpsError("failed-precondition", "Not enough league tokens.");
            }
            riders[uid] = { uid, name: me.displayName, stake: input.stake };
            tx.update(leagueRef, {
                [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
                lastActivityAt: now,
            });
        }
        tx.update(parlayRef, { legs, riders, combinedOdds });
        return { ok: true, combinedOdds, legCount: legs.length };
    });
});
exports.rideParlay = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        parlayId: zod_1.z.string().min(1),
        stake: zod_1.z.number().int().min(leagueConfig_1.MIN_LEAGUE_STAKE).max(10_000_000),
    })
        .parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, parlay] = await Promise.all([tx.get(leagueRef), tx.get(parlayRef)]);
        const now = Date.now();
        if (!league.exists || league.get("status") !== "active") {
            throw new https_1.HttpsError("failed-precondition", "That league is not active.");
        }
        if (!(0, leagueConfig_1.leagueStarted)(league, now))
            throw new https_1.HttpsError("failed-precondition", "This league hasn't started yet.");
        const me = league.get(`members.${uid}`);
        if (!me)
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        if (!parlay.exists)
            throw new https_1.HttpsError("not-found", "Parlay not found.");
        const status = parlay.get("status");
        if (status !== "open" && status !== "locked") {
            throw new https_1.HttpsError("failed-precondition", "That parlay is already settled.");
        }
        const legs = parlay.get("legs") ?? [];
        if (legs.some((l) => l.startsAt > 0 && l.startsAt <= now)) {
            throw new https_1.HttpsError("failed-precondition", "A leg on this parlay has already kicked off.");
        }
        const riders = { ...(parlay.get("riders") ?? {}) };
        if (riders[uid]) {
            throw new https_1.HttpsError("already-exists", "You're already riding this parlay.");
        }
        if (input.stake > (0, parlay_1.parlayStakeCap)(me.leagueTokens)) {
            throw new https_1.HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(parlay_1.MAX_PARLAY_SHARE * 100)}% of your wallet (${(0, parlay_1.parlayStakeCap)(me.leagueTokens).toLocaleString("en-US")} tokens).`);
        }
        if (input.stake > me.leagueTokens) {
            throw new https_1.HttpsError("failed-precondition", "Not enough league tokens.");
        }
        riders[uid] = { uid, name: me.displayName, stake: input.stake };
        tx.update(leagueRef, {
            [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
            lastActivityAt: now,
        });
        tx.update(parlayRef, { riders });
        return { ok: true, leagueTokens: me.leagueTokens - input.stake };
    });
});
exports.lockParlay = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        parlayId: zod_1.z.string().min(1),
    })
        .parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, parlay] = await Promise.all([tx.get(leagueRef), tx.get(parlayRef)]);
        const now = Date.now();
        if (!league.exists || league.get("status") !== "active") {
            throw new https_1.HttpsError("failed-precondition", "That league is not active.");
        }
        if (!(0, leagueConfig_1.leagueStarted)(league, now))
            throw new https_1.HttpsError("failed-precondition", "This league hasn't started yet.");
        (0, economy_1.requireAuth)(req.auth);
        if (!league.get(`members.${uid}`)) {
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        }
        if (!parlay.exists)
            throw new https_1.HttpsError("not-found", "Parlay not found.");
        if (parlay.get("status") === "locked")
            return { ok: true, combinedOdds: parlay.get("combinedOdds") };
        if (parlay.get("status") !== "open") {
            throw new https_1.HttpsError("failed-precondition", "That parlay is already settled.");
        }
        const legs = parlay.get("legs") ?? [];
        if (legs.length < parlay_1.MIN_PARLAY_LEGS || legs.length > parlay_1.MAX_PARLAY_LEGS) {
            throw new https_1.HttpsError("failed-precondition", `A group parlay needs ${parlay_1.MIN_PARLAY_LEGS} to ${parlay_1.MAX_PARLAY_LEGS} legs.`);
        }
        if (legs.some((l) => l.startsAt > 0 && l.startsAt <= now)) {
            throw new https_1.HttpsError("failed-precondition", "One of the legs has already started.");
        }
        const combinedOdds = (0, parlay_1.combinedParlayOdds)(legs);
        tx.update(parlayRef, { status: "locked", combinedOdds, lockedAt: now });
        return { ok: true, combinedOdds };
    });
});
/** Grades any open/locked group parlays carrying a leg on `gameId`. */
async function gradeParlays(gameId) {
    const gameSnap = await economy_1.db.collection("games").doc(gameId).get();
    if (!gameSnap.exists || gameSnap.get("status") !== "final")
        return 0;
    const homeScore = gameSnap.get("homeScore");
    const awayScore = gameSnap.get("awayScore");
    if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) {
        return 0;
    }
    const all = await economy_1.db.collectionGroup("parlays").where("status", "in", ["open", "locked"]).limit(500).get();
    let graded = 0;
    for (const doc of all.docs) {
        const legs = doc.get("legs") ?? [];
        if (!legs.some((l) => l.gameId === gameId && l.status === "pending"))
            continue;
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const parlay = await tx.get(doc.ref);
                const curStatus = parlay.get("status");
                if (!parlay.exists || (curStatus !== "open" && curStatus !== "locked"))
                    return false;
                const leagueId = parlay.get("leagueId");
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const league = await tx.get(leagueRef);
                if (!league.exists || league.get("status") !== "active")
                    return false;
                const curLegs = parlay.get("legs") ?? [];
                const updatedLegs = curLegs.map((leg) => {
                    if (leg.gameId !== gameId || leg.status !== "pending")
                        return leg;
                    const outcome = (0, settlement_1.decide)({ market: leg.market, selection: leg.selection, side: leg.side, line: leg.line }, homeScore, awayScore);
                    return { ...leg, status: outcome };
                });
                const grade = (0, parlay_1.gradeParlayLegs)(updatedLegs);
                const now = Date.now();
                if (grade.status === "pending") {
                    tx.update(doc.ref, {
                        status: "locked",
                        legs: updatedLegs,
                        combinedOdds: grade.effectiveOdds,
                    });
                    return true;
                }
                const riders = parlay.get("riders") ?? {};
                const leagueUpdate = { lastActivityAt: now };
                if (grade.status === "won") {
                    for (const [uid, r] of Object.entries(riders)) {
                        if (!league.get(`members.${uid}`))
                            continue;
                        const payout = Math.round(r.stake * grade.effectiveOdds);
                        leagueUpdate[`members.${uid}.leagueTokens`] = economy_1.FieldValue.increment(payout);
                        leagueUpdate[`members.${uid}.betsWon`] = economy_1.FieldValue.increment(1);
                    }
                    tx.set(leagueRef.collection("activity").doc(`parlay_win_${doc.id}`), {
                        type: "parlay_won",
                        uid: parlay.get("creatorUid"),
                        name: parlay.get("creatorName"),
                        amount: 0,
                        text: `Group Parlay cashed at ${grade.effectiveOdds.toFixed(2)}x!`,
                        at: now,
                    });
                }
                else if (grade.status === "push") {
                    for (const [uid, r] of Object.entries(riders)) {
                        if (!league.get(`members.${uid}`))
                            continue;
                        leagueUpdate[`members.${uid}.leagueTokens`] = economy_1.FieldValue.increment(r.stake);
                        leagueUpdate[`members.${uid}.betsPush`] = economy_1.FieldValue.increment(1);
                    }
                }
                else if (grade.status === "lost") {
                    for (const [uid] of Object.entries(riders)) {
                        if (!league.get(`members.${uid}`))
                            continue;
                        leagueUpdate[`members.${uid}.betsLost`] = economy_1.FieldValue.increment(1);
                    }
                    const bustText = `Group Parlay busted — ${grade.bustedByName}'s leg (${grade.bustedLeg}) missed`;
                    tx.set(leagueRef.collection("activity").doc(`parlay_bust_${doc.id}`), {
                        type: "parlay_busted",
                        uid: grade.bustedBy ?? "",
                        name: grade.bustedByName ?? "Member",
                        amount: 0,
                        text: bustText,
                        at: now,
                    });
                    tx.set(leagueRef.collection("messages").doc(`parlay_bust_${doc.id}`), {
                        uid: grade.bustedBy ?? "",
                        name: grade.bustedByName ?? "Member",
                        kind: "system",
                        text: bustText,
                        at: now,
                        reactions: {},
                        reactors: {},
                    });
                }
                tx.update(leagueRef, leagueUpdate);
                tx.update(doc.ref, {
                    status: grade.status,
                    legs: updatedLegs,
                    combinedOdds: grade.effectiveOdds,
                    bustedBy: grade.bustedBy,
                    bustedByName: grade.bustedByName,
                    bustedLeg: grade.bustedLeg,
                    settledAt: now,
                });
                return true;
            });
            if (did)
                graded++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to grade parlay", { parlayId: doc.id, err });
        }
    }
    return graded;
}
/** Marks parlay legs on disrupted (cancelled/postponed >24h) games as void and settles if all legs are done. */
async function voidDisruptedParlayLegs(now = Date.now()) {
    const all = await economy_1.db.collectionGroup("parlays").where("status", "in", ["open", "locked"]).limit(500).get();
    let touched = 0;
    for (const doc of all.docs) {
        const legs = doc.get("legs") ?? [];
        const pendingGameIds = [...new Set(legs.filter((l) => l.status === "pending").map((l) => l.gameId))];
        if (!pendingGameIds.length)
            continue;
        const voidGames = new Set();
        for (const gid of pendingGameIds) {
            const g = await economy_1.db.collection("games").doc(gid).get();
            if (!g.exists || (0, gameState_1.voidReason)(g.data(), now)) {
                voidGames.add(gid);
            }
        }
        if (!voidGames.size)
            continue;
        const did = await economy_1.db.runTransaction(async (tx) => {
            const parlay = await tx.get(doc.ref);
            const curStatus = parlay.get("status");
            if (!parlay.exists || (curStatus !== "open" && curStatus !== "locked"))
                return false;
            const leagueId = parlay.get("leagueId");
            const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
            const league = await tx.get(leagueRef);
            if (!league.exists || league.get("status") !== "active")
                return false;
            const curLegs = parlay.get("legs") ?? [];
            const updatedLegs = curLegs.map((l) => l.status === "pending" && voidGames.has(l.gameId) ? { ...l, status: "void" } : l);
            const grade = (0, parlay_1.gradeParlayLegs)(updatedLegs);
            if (grade.status === "pending") {
                tx.update(doc.ref, { legs: updatedLegs, combinedOdds: grade.effectiveOdds });
                return true;
            }
            const riders = parlay.get("riders") ?? {};
            const leagueUpdate = { lastActivityAt: now };
            if (grade.status === "won" || grade.status === "push") {
                for (const [uid, r] of Object.entries(riders)) {
                    if (!league.get(`members.${uid}`))
                        continue;
                    const credit = grade.status === "won" ? Math.round(r.stake * grade.effectiveOdds) : r.stake;
                    leagueUpdate[`members.${uid}.leagueTokens`] = economy_1.FieldValue.increment(credit);
                }
            }
            tx.update(leagueRef, leagueUpdate);
            tx.update(doc.ref, {
                status: grade.status,
                legs: updatedLegs,
                combinedOdds: grade.effectiveOdds,
                settledAt: now,
            });
            return true;
        });
        if (did)
            touched++;
    }
    return touched;
}
//# sourceMappingURL=parlays.js.map
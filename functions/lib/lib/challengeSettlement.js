"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHALLENGES = void 0;
exports.nameFor = nameFor;
exports.friendOf = friendOf;
exports.sideFor = sideFor;
exports.stakeFor = stakeFor;
exports.gameLabel = gameLabel;
exports.summaryFor = summaryFor;
exports.releasePending = releasePending;
exports.settleAccepted = settleAccepted;
exports.voidAccepted = voidAccepted;
exports.settleChallengesForGame = settleChallengesForGame;
exports.expirePendingChallenges = expirePendingChallenges;
exports.sweepChallenges = sweepChallenges;
exports.refundStaleChallenges = refundStaleChallenges;
const firebase_functions_1 = require("firebase-functions");
const challengeMath_1 = require("./challengeMath");
const economy_1 = require("./economy");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
const settlement_1 = require("./settlement");
const CHALLENGES = () => economy_1.db.collection("challenges");
exports.CHALLENGES = CHALLENGES;
function nameFor(ch, uid) {
    return (uid === ch.get("creatorUid") ? ch.get("creatorName") : ch.get("opponentName")) || "Your friend";
}
function friendOf(ch, uid) {
    return (uid === ch.get("creatorUid") ? ch.get("opponentUid") : ch.get("creatorUid"));
}
function sideFor(ch, uid) {
    const creatorSide = ch.get("creatorSide");
    if (uid === ch.get("creatorUid"))
        return creatorSide;
    return creatorSide === "home" ? "away" : "home";
}
function stakeFor(ch, uid) {
    return (uid === ch.get("creatorUid") ? ch.get("creatorStake") : ch.get("opponentStake"));
}
function gameLabel(ch) {
    const home = ch.get("home");
    const away = ch.get("away");
    return `${away.abbreviation} @ ${home.abbreviation}`;
}
/** The challenge from one player's side, in the shape the result popup already renders. */
function summaryFor(ch, uid, homeScore, awayScore) {
    const side = sideFor(ch, uid);
    const home = ch.get("home");
    const away = ch.get("away");
    const team = side === "home" ? home : away;
    const other = side === "home" ? away : home;
    const stake = stakeFor(ch, uid);
    const pot = ch.get("pot");
    return {
        betId: ch.id,
        gameId: ch.get("gameId"),
        sport: ch.get("sport") ?? null,
        side,
        teamName: team.name,
        teamAbbr: team.abbreviation,
        teamColor: team.color,
        opponentAbbr: other.abbreviation,
        odds: stake > 0 ? Math.round((pot / stake) * 100) / 100 : 0,
        stake,
        payout: pot,
        finalHomeScore: homeScore,
        finalAwayScore: awayScore,
    };
}
/**
 * Closes a challenge nobody accepted (expired, declined or withdrawn): the
 * challenger's escrow goes back. Only the challenger ever paid in.
 */
async function releasePending(tx, ch, status, now) {
    const id = ch.id;
    const creator = ch.get("creatorUid");
    const opponent = ch.get("opponentUid");
    const stake = ch.get("creatorStake");
    const label = gameLabel(ch);
    const balances = await (0, economy_1.applyCreditsMany)(tx, [
        {
            uid: creator,
            delta: stake,
            type: "challenge_refund",
            idempotencyKey: `chref_${id}_${creator}`,
            ref: id,
            note: status === "expired" ? `Challenge expired · ${label}` : status === "declined" ? `Challenge declined · ${label}` : `Challenge withdrawn · ${label}`,
        },
    ]);
    tx.update(ch.ref, { status, closedAtMs: now });
    const opponentName = nameFor(ch, opponent);
    const creatorName = nameFor(ch, creator);
    if (status === "expired") {
        (0, notify_1.writeNotification)(tx, creator, (0, notifyModel_1.simpleNotification)({
            id: `chexp_${id}`,
            type: "challenge_expired",
            title: "Challenge expired",
            body: `${opponentName} didn't accept before ${label} started. Your ${stake.toLocaleString("en-US")} is back.`,
            delta: stake,
            balanceAfter: balances[creator] ?? null,
            now,
            data: { challengeId: id },
        }));
    }
    else if (status === "declined") {
        (0, notify_1.writeNotification)(tx, creator, (0, notifyModel_1.simpleNotification)({
            id: `chdec_${id}`,
            type: "challenge_declined",
            title: `${opponentName} passed`,
            body: `${opponentName} declined your ${label} challenge. Your ${stake.toLocaleString("en-US")} is back.`,
            delta: stake,
            balanceAfter: balances[creator] ?? null,
            now,
            data: { challengeId: id },
        }));
    }
    else {
        (0, notify_1.writeNotification)(tx, opponent, (0, notifyModel_1.simpleNotification)({
            id: `chcan_${id}`,
            type: "challenge_cancelled",
            title: `${creatorName} withdrew a challenge`,
            body: `The ${label} challenge is off.`,
            now,
            data: { challengeId: id },
        }));
    }
    return balances[creator] ?? null;
}
/** Pays out an accepted challenge on a final score. */
async function settleAccepted(tx, ch, scores, now) {
    const id = ch.id;
    const creator = ch.get("creatorUid");
    const opponent = ch.get("opponentUid");
    const terms = {
        creatorStake: ch.get("creatorStake"),
        opponentStake: ch.get("opponentStake"),
        pot: ch.get("pot"),
    };
    const creatorResult = (0, settlement_1.decide)(ch.get("creatorSide"), scores.home, scores.away);
    const outcome = creatorResult === "won" ? "creator" : creatorResult === "lost" ? "opponent" : "push";
    const pay = (0, challengeMath_1.challengePayouts)(outcome, terms);
    const label = gameLabel(ch);
    const type = outcome === "push" ? "challenge_refund" : "challenge_payout";
    const note = outcome === "push" ? `Draw · ${label}` : `Won the pot · ${label}`;
    const balances = await (0, economy_1.applyCreditsMany)(tx, [
        { uid: creator, delta: pay.creator, type, idempotencyKey: `chpay_${id}_${creator}`, ref: id, note },
        { uid: opponent, delta: pay.opponent, type, idempotencyKey: `chpay_${id}_${opponent}`, ref: id, note },
    ]);
    tx.update(ch.ref, {
        status: "settled",
        outcome,
        winnerUid: outcome === "creator" ? creator : outcome === "opponent" ? opponent : null,
        finalHomeScore: scores.home,
        finalAwayScore: scores.away,
        settledAtMs: now,
    });
    for (const uid of [creator, opponent]) {
        const result = outcome === "push" ? "push" : (outcome === "creator") === (uid === creator) ? "won" : "lost";
        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.challengeResultNotification)({
            result,
            challengeId: id,
            friendName: nameFor(ch, friendOf(ch, uid)),
            bet: summaryFor(ch, uid, scores.home, scores.away),
            balanceAfter: balances[uid] ?? null,
            now,
        }));
    }
}
/** The game never happened: both stakes go back. */
async function voidAccepted(tx, ch, now) {
    const id = ch.id;
    const creator = ch.get("creatorUid");
    const opponent = ch.get("opponentUid");
    const note = `Game called off · ${gameLabel(ch)}`;
    const balances = await (0, economy_1.applyCreditsMany)(tx, [
        { uid: creator, delta: ch.get("creatorStake"), type: "challenge_refund", idempotencyKey: `chpay_${id}_${creator}`, ref: id, note },
        { uid: opponent, delta: ch.get("opponentStake"), type: "challenge_refund", idempotencyKey: `chpay_${id}_${opponent}`, ref: id, note },
    ]);
    tx.update(ch.ref, { status: "void", outcome: null, winnerUid: null, settledAtMs: now });
    for (const uid of [creator, opponent]) {
        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.challengeResultNotification)({
            result: "refunded",
            challengeId: id,
            friendName: nameFor(ch, friendOf(ch, uid)),
            bet: summaryFor(ch, uid, null, null),
            balanceAfter: balances[uid] ?? null,
            now,
        }));
    }
}
// ---------------------------------------------------------------------------
// Game-level jobs
// ---------------------------------------------------------------------------
async function finalScores(gameId) {
    const g = await economy_1.db.collection("games").doc(gameId).get();
    if (!g.exists || g.get("status") !== "final")
        return null;
    const home = g.get("homeScore");
    const away = g.get("awayScore");
    if (home === null || home === undefined || away === null || away === undefined)
        return null;
    return { home, away };
}
/**
 * Game is final: pay every accepted challenge, and expire any still waiting
 * on an answer. Exported for tests.
 */
async function settleChallengesForGame(gameId) {
    const scores = await finalScores(gameId);
    if (!scores)
        return 0;
    const open = await (0, exports.CHALLENGES)().where("gameId", "==", gameId).where("status", "in", ["pending", "accepted"]).limit(500).get();
    let done = 0;
    for (const doc of open.docs) {
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const ch = await tx.get(doc.ref);
                const status = ch.get("status");
                if (status === "pending") {
                    await releasePending(tx, ch, "expired", Date.now());
                    return true;
                }
                if (status === "accepted") {
                    await settleAccepted(tx, ch, scores, Date.now());
                    return true;
                }
                return false;
            });
            if (did)
                done++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle challenge", { challengeId: doc.id, err });
        }
    }
    return done;
}
/** Game has kicked off: an unanswered challenge can't be accepted any more. */
async function expirePendingChallenges(gameId, now = Date.now()) {
    let q = (0, exports.CHALLENGES)().where("status", "==", "pending");
    if (gameId)
        q = q.where("gameId", "==", gameId);
    const pending = await q.limit(500).get();
    let done = 0;
    for (const doc of pending.docs) {
        const startsAt = doc.get("startsAt") ?? 0;
        if (!gameId && startsAt > now)
            continue;
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const ch = await tx.get(doc.ref);
                if (ch.get("status") !== "pending")
                    return false;
                await releasePending(tx, ch, "expired", Date.now());
                return true;
            });
            if (did)
                done++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to expire challenge", { challengeId: doc.id, err });
        }
    }
    return done;
}
/** Safety net, run with the bet sweep: expire past-kickoff offers and settle anything final. */
async function sweepChallenges(now = Date.now()) {
    let total = await expirePendingChallenges(null, now);
    const accepted = await (0, exports.CHALLENGES)().where("status", "==", "accepted").limit(1000).get();
    const gameIds = [...new Set(accepted.docs.map((d) => d.get("gameId")))];
    for (const gameId of gameIds)
        total += await settleChallengesForGame(gameId);
    return total;
}
/** Accepted challenges on games that vanished or never finished: give both stakes back. */
async function refundStaleChallenges(cutoff) {
    const accepted = await (0, exports.CHALLENGES)().where("status", "==", "accepted").limit(500).get();
    const orphan = new Map();
    let done = 0;
    for (const doc of accepted.docs) {
        const gameId = doc.get("gameId");
        if (!orphan.has(gameId)) {
            const g = await economy_1.db.collection("games").doc(gameId).get();
            const startsAt = g.get("startsAt") ?? 0;
            orphan.set(gameId, !g.exists || (startsAt > 0 && startsAt < cutoff && g.get("status") !== "final"));
        }
        if (!orphan.get(gameId))
            continue;
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const ch = await tx.get(doc.ref);
                if (ch.get("status") !== "accepted")
                    return false;
                await voidAccepted(tx, ch, Date.now());
                return true;
            });
            if (did)
                done++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to void challenge", { challengeId: doc.id, err });
        }
    }
    return done;
}
//# sourceMappingURL=challengeSettlement.js.map
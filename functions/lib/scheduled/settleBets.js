"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundStaleBets = exports.settleBetsSweep = exports.onGameFinal = void 0;
exports.settleBetsForGame = settleBetsForGame;
exports.settleMainBet = settleMainBet;
exports.settleLeagueBetsForGame = settleLeagueBetsForGame;
exports.voidDisrupted = voidDisrupted;
exports.refundStale = refundStale;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const ratings_1 = require("../lib/ratings");
const brackets_1 = require("../callable/brackets");
const coop_1 = require("../lib/coop");
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const settlement_1 = require("../lib/settlement");
const challengeSettlement_1 = require("../lib/challengeSettlement");
const gameState_1 = require("../lib/gameState");
const picks_1 = require("../callable/picks");
const parlays_1 = require("../callable/parlays");
const dailyPick_1 = require("../callable/dailyPick");
const slipParlays_1 = require("../callable/slipParlays");
const loanMath_1 = require("../lib/loanMath");
function summarize(id, bet, homeScore, awayScore) {
    return {
        betId: id,
        gameId: bet.get("gameId"),
        sport: bet.get("sport") ?? null,
        side: bet.get("side") ?? null,
        market: bet.get("market") ?? "ml",
        selection: bet.get("selection") ?? bet.get("side") ?? "home",
        line: bet.get("line") ?? null,
        label: bet.get("label") ?? bet.get("teamAbbr"),
        teamName: bet.get("teamName") ?? bet.get("teamAbbr"),
        teamAbbr: bet.get("teamAbbr"),
        teamColor: bet.get("teamColor") ?? "#888888",
        opponentAbbr: bet.get("opponentAbbr") ?? "OPP",
        odds: bet.get("odds"),
        stake: bet.get("stake"),
        payout: bet.get("potentialPayout"),
        finalHomeScore: homeScore,
        finalAwayScore: awayScore,
    };
}
async function finalScores(gameId) {
    const gameSnap = await economy_1.db.collection("games").doc(gameId).get();
    if (!gameSnap.exists || gameSnap.get("status") !== "final")
        return null;
    const home = gameSnap.get("homeScore");
    const away = gameSnap.get("awayScore");
    if (home === null || away === null || home === undefined || away === undefined) {
        firebase_functions_1.logger.warn("final game missing scores", { gameId });
        return null;
    }
    return { home, away };
}
/** Main wallet. Exported for tests. */
async function settleBetsForGame(gameId) {
    const scores = await finalScores(gameId);
    if (!scores)
        return 0;
    const pending = await economy_1.db
        .collection("bets")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    for (const doc of pending.docs) {
        try {
            if (await settleMainBet(doc.ref, scores))
                settled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle bet", { betId: doc.id, err });
        }
    }
    return settled;
}
/**
 * Settles one pending main-wallet bet against final scores. `force` decides
 * the outcome regardless of the scores (dev tools only).
 */
async function settleMainBet(ref, scores, force) {
    const doc = { id: ref.id, ref };
    return economy_1.db.runTransaction(async (tx) => {
        const userRef = (uid) => economy_1.db.collection("users").doc(uid);
        const bet = await tx.get(doc.ref);
        if (!bet.exists || bet.get("status") !== "pending")
            return false;
        const uid = bet.get("uid");
        const market = bet.get("market") ?? "ml";
        const selection = bet.get("selection") ??
            bet.get("side");
        const side = bet.get("side") ?? null;
        const line = bet.get("line") ?? null;
        const stake = bet.get("stake");
        const payout = bet.get("potentialPayout");
        const outcome = force ?? (0, settlement_1.decide)({ market, selection, side, line }, scores.home, scores.away);
        const credit = (0, settlement_1.settlementCredit)(outcome, stake, payout);
        let balanceAfter;
        if (credit > 0) {
            balanceAfter = await (0, economy_1.applyCredits)(tx, uid, {
                delta: credit,
                type: outcome === "won" ? "bet_payout" : "bet_refund",
                idempotencyKey: `settle_${doc.id}`,
                ref: doc.id,
                note: outcome === "won" ? `Won ${bet.get("label") ?? bet.get("teamAbbr")}` : "Push — stake returned",
            });
        }
        else {
            const u = await tx.get(userRef(uid));
            balanceAfter = u.get("balance") ?? null;
        }
        const stats = outcome === "won"
            ? { "stats.betsWon": economy_1.FieldValue.increment(1), "stats.creditsWon": economy_1.FieldValue.increment(payout - stake) }
            : outcome === "push"
                ? { "stats.betsPush": economy_1.FieldValue.increment(1) }
                : { "stats.betsLost": economy_1.FieldValue.increment(1) };
        tx.update(userRef(uid), stats);
        tx.update(doc.ref, {
            status: outcome,
            finalHomeScore: scores.home,
            finalAwayScore: scores.away,
            settledAt: economy_1.FieldValue.serverTimestamp(),
        });
        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
            outcome,
            bet: summarize(doc.id, bet, scores.home, scores.away),
            balanceAfter,
            wallet: "credits",
            now: Date.now(),
        }));
        return true;
    });
}
function areOppositePicks(a, b) {
    if (a.uid === b.uid)
        return false;
    if (a.market !== b.market)
        return false;
    if (a.market === "ml" || a.market === "spread") {
        return (a.selection === "home" && b.selection === "away") || (a.selection === "away" && b.selection === "home");
    }
    return (a.selection === "over" && b.selection === "under") || (a.selection === "under" && b.selection === "over");
}
async function recordRivalries(gameId, rows, now) {
    const byLeague = new Map();
    for (const r of rows) {
        const list = byLeague.get(r.leagueId) ?? [];
        list.push(r);
        byLeague.set(r.leagueId, list);
    }
    for (const [leagueId, list] of byLeague) {
        const seenPairs = new Set();
        const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const x = list[i];
                const y = list[j];
                if (!areOppositePicks(x, y))
                    continue;
                const pid = (0, economy_1.pairId)(x.uid, y.uid);
                if (seenPairs.has(pid))
                    continue;
                seenPairs.add(pid);
                const aIsX = x.uid < y.uid;
                const a = aIsX ? x : y;
                const b = aIsX ? y : x;
                const rivRef = leagueRef.collection("rivalries").doc(pid);
                await economy_1.db.runTransaction(async (tx) => {
                    const snap = await tx.get(rivRef);
                    const settledGames = (snap.exists ? snap.get("settledGames") : undefined) ?? [];
                    if (settledGames.includes(gameId))
                        return;
                    let aWins = snap.exists ? (snap.get("aWins") ?? 0) : 0;
                    let bWins = snap.exists ? (snap.get("bWins") ?? 0) : 0;
                    let pushes = snap.exists ? (snap.get("pushes") ?? 0) : 0;
                    let winnerName = null;
                    let loserName = null;
                    if (a.outcome === "won" && b.outcome === "lost") {
                        aWins++;
                        winnerName = a.name;
                        loserName = b.name;
                    }
                    else if (b.outcome === "won" && a.outcome === "lost") {
                        bWins++;
                        winnerName = b.name;
                        loserName = a.name;
                    }
                    else {
                        pushes++;
                    }
                    tx.set(rivRef, {
                        id: pid,
                        leagueId,
                        aUid: a.uid,
                        bUid: b.uid,
                        aName: a.name,
                        bName: b.name,
                        users: [a.uid, b.uid],
                        aWins,
                        bWins,
                        pushes,
                        lastGameId: gameId,
                        settledGames: [...settledGames.slice(-49), gameId],
                        updatedAt: now,
                    }, { merge: true });
                    if (winnerName && loserName) {
                        const winCount = winnerName === a.name ? aWins : bWins;
                        const lossCount = winnerName === a.name ? bWins : aWins;
                        tx.set(leagueRef.collection("activity").doc(`rivalry_${gameId}_${pid}`), {
                            type: "rivalry",
                            uid: winnerName === a.name ? a.uid : b.uid,
                            name: winnerName,
                            amount: 0,
                            reactions: {},
                            reactors: {},
                            text: `${winnerName} took down ${loserName} head-to-head (${winCount}–${lossCount} all-time)`,
                            at: now,
                        });
                    }
                });
            }
        }
    }
}
/**
 * League wallet. Same rules, but the money is the member's league tokens on
 * the league document rather than the real credit balance. Exported for tests.
 */
async function settleLeagueBetsForGame(gameId) {
    const scores = await finalScores(gameId);
    if (!scores)
        return 0;
    const pending = await economy_1.db
        .collectionGroup("leagueBets")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    const settledRows = [];
    for (const doc of pending.docs) {
        try {
            const row = await economy_1.db.runTransaction(async (tx) => {
                const bet = await tx.get(doc.ref);
                if (!bet.exists || bet.get("status") !== "pending")
                    return null;
                const leagueId = bet.get("leagueId");
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const [league, loansSnap] = await Promise.all([
                    tx.get(leagueRef),
                    tx.get(leagueRef.collection("loans").where("borrowerId", "==", bet.get("uid")).where("status", "==", "active")),
                ]);
                const uid = bet.get("uid");
                const member = league.get(`members.${uid}`);
                if (!league.exists || league.get("status") !== "active" || !member)
                    return null;
                const market = bet.get("market") ?? "ml";
                const selection = bet.get("selection") ??
                    bet.get("side");
                const side = bet.get("side") ?? null;
                const line = bet.get("line") ?? null;
                const stake = bet.get("stake");
                const payout = bet.get("potentialPayout");
                const isLock = Boolean(bet.get("lock"));
                const outcome = (0, settlement_1.decide)({ market, selection, side, line }, scores.home, scores.away);
                const credit = (0, settlement_1.settlementCredit)(outcome, stake, payout);
                const balanceAfter = member.leagueTokens + credit;
                const leagueName = league.get("name") ?? "your league";
                const now = Date.now();
                const counter = outcome === "won" ? "betsWon" : outcome === "push" ? "betsPush" : "betsLost";
                const leagueUpdate = {
                    [`members.${uid}.leagueTokens`]: economy_1.FieldValue.increment(credit),
                    [`members.${uid}.${counter}`]: economy_1.FieldValue.increment(1),
                    lastActivityAt: now,
                };
                // Feeds the loss-chasing cooldown on bank and peer loans.
                if (outcome === "lost")
                    leagueUpdate[`members.${uid}.lastLossAt`] = now;
                if (isLock) {
                    const lockCounter = outcome === "won" ? "locksWon" : outcome === "push" ? "locksPush" : "locksLost";
                    leagueUpdate[`members.${uid}.${lockCounter}`] = economy_1.FieldValue.increment(1);
                    if (outcome === "won") {
                        tx.set(economy_1.db.collection("users").doc(uid).collection("trophies").doc(`lock_${leagueId}_${doc.id}`), {
                            id: `lock_${leagueId}_${doc.id}`,
                            kind: "lock_of_week",
                            title: "Lock of the Week Hit",
                            leagueId,
                            leagueName,
                            betId: doc.id,
                            label: bet.get("label") ?? bet.get("teamAbbr"),
                            awardedAt: now,
                        }, { merge: true });
                    }
                }
                tx.update(leagueRef, leagueUpdate);
                tx.update(doc.ref, {
                    status: outcome,
                    finalHomeScore: scores.home,
                    finalAwayScore: scores.away,
                    settledAt: economy_1.FieldValue.serverTimestamp(),
                });
                const name = bet.get("displayName") ?? "A member";
                const pickLabel = bet.get("label") ?? bet.get("teamAbbr");
                tx.set(leagueRef.collection("activity").doc(`settle_${doc.id}`), {
                    type: outcome === "won" ? "bet_won" : outcome === "push" ? "bet_push" : "bet_lost",
                    uid,
                    name,
                    amount: outcome === "won" ? payout - stake : outcome === "push" ? 0 : -stake,
                    reactions: {},
                    reactors: {},
                    text: outcome === "won"
                        ? `${name} cashed ${pickLabel} for +${(payout - stake).toLocaleString("en-US")}${isLock ? " 🔒" : ""}`
                        : outcome === "push"
                            ? `${name}'s ${pickLabel} bet pushed`
                            : `${name} lost ${stake.toLocaleString("en-US")} on ${pickLabel}`,
                    at: now,
                });
                // Margin-call drama: if a loss leaves the borrower's tokens below what they owe.
                if (outcome === "lost" && !loansSnap.empty) {
                    const activeLoans = loansSnap.docs.map((d) => ({
                        principal: d.get("principal"),
                        principalOutstanding: d.get("principalOutstanding"),
                        interestAccrued: d.get("interestAccrued") ?? 0,
                        interestPaid: d.get("interestPaid") ?? 0,
                        accruedThrough: d.get("accruedThrough"),
                        ratePct: d.get("ratePct"),
                        intervalHours: d.get("intervalHours"),
                        kind: d.get("kind"),
                        status: d.get("status"),
                        borrowerId: d.get("borrowerId"),
                        lenderId: d.get("lenderId") ?? null,
                    }));
                    const sheet = (0, loanMath_1.balanceSheet)(uid, balanceAfter, activeLoans, now);
                    if (balanceAfter < sheet.debt) {
                        tx.set(leagueRef.collection("activity").doc(`margin_${doc.id}`), {
                            type: "margin_call",
                            uid,
                            name,
                            amount: sheet.debt - balanceAfter,
                            reactions: {},
                            reactors: {},
                            text: `Margin call: ${name} is down to ${balanceAfter.toLocaleString("en-US")} tokens while owing ${sheet.debt.toLocaleString("en-US")}`,
                            at: now,
                        });
                        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                            id: `margin_${leagueId}_${doc.id}`,
                            type: "margin_call",
                            title: `Margin call in ${leagueName}`,
                            body: `You have ${balanceAfter.toLocaleString("en-US")} tokens left and owe ${sheet.debt.toLocaleString("en-US")}.`,
                            wallet: "league",
                            leagueId,
                            leagueName,
                            now,
                        }));
                    }
                }
                (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                    outcome,
                    bet: summarize(doc.id, bet, scores.home, scores.away),
                    balanceAfter,
                    wallet: "league",
                    leagueId,
                    leagueName,
                    now,
                }));
                return {
                    betId: doc.id,
                    leagueId,
                    uid,
                    name,
                    market,
                    selection,
                    side,
                    line,
                    outcome,
                };
            });
            if (row) {
                settled++;
                settledRows.push(row);
            }
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle league bet", { betId: doc.id, err });
        }
    }
    if (settledRows.length >= 2) {
        await recordRivalries(gameId, settledRows, Date.now());
    }
    const wins = settledRows.filter((r) => r.outcome === "won");
    if (wins.length)
        await (0, coop_1.recordCoopWins)(wins, Date.now()).catch(() => 0);
    return settled;
}
/**
 * Voids and refunds open main-wallet bets, league bets, and challenges on
 * disrupted games (cancelled immediately, or postponed and unplayed 24h after
 * original start). Exported for tests.
 */
async function voidDisrupted(now = Date.now()) {
    const [mainPending, leaguePending, chPending] = await Promise.all([
        economy_1.db.collection("bets").where("status", "==", "pending").limit(500).get(),
        economy_1.db.collectionGroup("leagueBets").where("status", "==", "pending").limit(500).get(),
        economy_1.db.collection("challenges").where("status", "in", ["pending", "accepted"]).limit(500).get(),
    ]);
    const gameIds = new Set();
    for (const d of mainPending.docs)
        gameIds.add(d.get("gameId"));
    for (const d of leaguePending.docs)
        gameIds.add(d.get("gameId"));
    for (const d of chPending.docs)
        gameIds.add(d.get("gameId"));
    const reasons = new Map();
    for (const gid of gameIds) {
        const g = await economy_1.db.collection("games").doc(gid).get();
        if (!g.exists)
            continue;
        const reason = (0, gameState_1.voidReason)(g.data(), now);
        if (reason)
            reasons.set(gid, reason);
    }
    if (reasons.size === 0)
        return 0;
    let refunded = 0;
    for (const doc of mainPending.docs) {
        const reason = reasons.get(doc.get("gameId"));
        if (!reason)
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const uid = bet.get("uid");
            const stake = bet.get("stake");
            const balanceAfter = await (0, economy_1.applyCredits)(tx, uid, {
                delta: stake,
                type: "bet_refund",
                idempotencyKey: `settle_${doc.id}`,
                ref: doc.id,
                note: `Game ${reason}`,
            });
            tx.update(doc.ref, {
                status: "cancelled",
                voidReason: reason,
                settledAt: economy_1.FieldValue.serverTimestamp(),
            });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter,
                wallet: "credits",
                now,
            }));
            refunded++;
        });
    }
    for (const doc of leaguePending.docs) {
        const reason = reasons.get(doc.get("gameId"));
        if (!reason)
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const leagueId = bet.get("leagueId");
            const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
            const league = await tx.get(leagueRef);
            const uid = bet.get("uid");
            const member = league.get(`members.${uid}`);
            const stake = bet.get("stake");
            if (league.exists && league.get("status") === "active" && member) {
                tx.update(leagueRef, { [`members.${uid}.leagueTokens`]: economy_1.FieldValue.increment(stake) });
            }
            tx.update(doc.ref, {
                status: "cancelled",
                voidReason: reason,
                settledAt: economy_1.FieldValue.serverTimestamp(),
            });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter: member ? member.leagueTokens + stake : null,
                wallet: "league",
                leagueId,
                leagueName: league.get("name") ?? null,
                now,
            }));
            refunded++;
        });
    }
    for (const doc of chPending.docs) {
        const reason = reasons.get(doc.get("gameId"));
        if (!reason)
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const ch = await tx.get(doc.ref);
            if (!ch.exists)
                return;
            const st = ch.get("status");
            if (st === "accepted") {
                await (0, challengeSettlement_1.voidAccepted)(tx, ch, now);
                refunded++;
            }
        });
    }
    refunded += await (0, parlays_1.voidDisruptedParlayLegs)(now);
    refunded += await (0, slipParlays_1.voidSlipParlayLegs)(now).catch(() => 0);
    return refunded;
}
/**
 * Fires the moment syncGames flips a game to final. This is the fast path —
 * users see results within a couple of minutes of the whistle.
 */
exports.onGameFinal = (0, firestore_1.onDocumentUpdated)({ document: "games/{gameId}", region: "us-central1" }, async (event) => {
    const before = event.data?.before.get("status");
    const after = event.data?.after.get("status");
    const gameId = event.params.gameId;
    if (before === "upcoming" && after && after !== "upcoming") {
        const expired = await (0, challengeSettlement_1.expirePendingChallenges)(gameId);
        if (expired > 0)
            firebase_functions_1.logger.info("challenges expired at kickoff", { gameId, expired });
    }
    if (before === "final" || after !== "final")
        return;
    // Results feed the model line's team ratings (once per game).
    await (0, ratings_1.applyResultToRatings)(gameId).catch((err) => firebase_functions_1.logger.warn("ratings update failed", { gameId, error: String(err) }));
    const settled = await settleBetsForGame(gameId);
    const leagueSettled = await settleLeagueBetsForGame(gameId);
    const challenges = await (0, challengeSettlement_1.settleChallengesForGame)(gameId);
    const picks = await (0, picks_1.settlePicksForGame)(gameId);
    const parlays = await (0, parlays_1.gradeParlays)(gameId);
    const daily = await (0, dailyPick_1.settleDailyPicksForGame)(gameId).catch(() => 0);
    const slips = await (0, slipParlays_1.settleSlipParlaysForGame)(gameId).catch((err) => (firebase_functions_1.logger.warn("slip parlays failed", { gameId, error: String(err) }), 0));
    await (0, brackets_1.settleBracketsForGame)(gameId).catch((err) => firebase_functions_1.logger.warn("brackets failed", { gameId, error: String(err) }));
    firebase_functions_1.logger.info("onGameFinal settled", { gameId, settled, leagueSettled, challenges, picks, parlays, daily, slips });
});
/**
 * Safety net. Catches anything the trigger missed — a cold deploy, a dropped
 * event, a bet placed after the game already went final.
 */
exports.settleBetsSweep = (0, scheduler_1.onSchedule)({ schedule: "*/15 * * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const [pending, leaguePending] = await Promise.all([
        economy_1.db.collection("bets").where("status", "==", "pending").limit(1000).get(),
        economy_1.db.collectionGroup("leagueBets").where("status", "==", "pending").limit(1000).get(),
    ]);
    const gameIds = [...new Set(pending.docs.map((d) => d.get("gameId")))];
    const leagueGameIds = [...new Set(leaguePending.docs.map((d) => d.get("gameId")))];
    let total = 0;
    for (const gameId of gameIds)
        total += await settleBetsForGame(gameId);
    for (const gameId of leagueGameIds)
        total += await settleLeagueBetsForGame(gameId);
    total += await (0, challengeSettlement_1.sweepChallenges)();
    total += await voidDisrupted(Date.now());
    // Bet-slip parlays: any leg on a game that's final.
    const slips = await economy_1.db.collection("slipParlays").where("status", "==", "pending").limit(500).get();
    for (const gameId of new Set(slips.docs.flatMap((d) => d.get("gameIds") ?? [])))
        total += await (0, slipParlays_1.settleSlipParlaysForGame)(gameId);
    const rated = await (0, ratings_1.rateRecentFinals)().catch(() => 0);
    if (rated)
        firebase_functions_1.logger.info("ratings caught up", { rated });
    // Pick'em / survivor picks and group parlay legs on finished games.
    const [picks, parlays] = await Promise.all([
        economy_1.db.collectionGroup("picks").where("status", "==", "pending").limit(1000).get(),
        economy_1.db.collectionGroup("parlays").where("status", "==", "locked").limit(500).get(),
    ]);
    for (const gameId of new Set(picks.docs.map((d) => d.get("gameId")))) {
        total += await (0, picks_1.settlePicksForGame)(gameId);
    }
    const legGames = new Set(parlays.docs.flatMap((d) => (d.get("legs") ?? [])
        .filter((l) => l.status === "pending")
        .map((l) => l.gameId)));
    for (const gameId of legGames)
        total += await (0, parlays_1.gradeParlays)(gameId);
    if (total > 0)
        firebase_functions_1.logger.info("settleBetsSweep", { settled: total });
});
async function isOrphaned(gameId, cutoff) {
    const game = await economy_1.db.collection("games").doc(gameId).get();
    const startsAt = game.get("startsAt") ?? 0;
    return !game.exists || (startsAt > 0 && startsAt < cutoff && game.get("status") !== "final");
}
/** Exported for tests. */
async function refundStale(cutoff) {
    let refunded = 0;
    const pending = await economy_1.db.collection("bets").where("status", "==", "pending").limit(500).get();
    for (const doc of pending.docs) {
        if (!(await isOrphaned(doc.get("gameId"), cutoff)))
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const uid = bet.get("uid");
            const balanceAfter = await (0, economy_1.applyCredits)(tx, uid, {
                delta: bet.get("stake"),
                type: "bet_refund",
                idempotencyKey: `settle_${doc.id}`,
                ref: doc.id,
                note: "Game cancelled or postponed",
            });
            tx.update(doc.ref, { status: "cancelled", voidReason: "stale", settledAt: economy_1.FieldValue.serverTimestamp() });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter,
                wallet: "credits",
                now: Date.now(),
            }));
            refunded++;
        });
        firebase_functions_1.logger.info("refunded stale bet", { betId: doc.id });
    }
    const leaguePending = await economy_1.db
        .collectionGroup("leagueBets")
        .where("status", "==", "pending")
        .limit(500)
        .get();
    for (const doc of leaguePending.docs) {
        if (!(await isOrphaned(doc.get("gameId"), cutoff)))
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const bet = await tx.get(doc.ref);
            if (!bet.exists || bet.get("status") !== "pending")
                return;
            const leagueId = bet.get("leagueId");
            const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
            const league = await tx.get(leagueRef);
            const uid = bet.get("uid");
            const member = league.get(`members.${uid}`);
            const stake = bet.get("stake");
            if (league.exists && league.get("status") === "active" && member) {
                tx.update(leagueRef, { [`members.${uid}.leagueTokens`]: economy_1.FieldValue.increment(stake) });
            }
            tx.update(doc.ref, { status: "cancelled", voidReason: "stale", settledAt: economy_1.FieldValue.serverTimestamp() });
            (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.betResultNotification)({
                outcome: "refunded",
                bet: summarize(doc.id, bet, null, null),
                balanceAfter: member ? member.leagueTokens + stake : null,
                wallet: "league",
                leagueId,
                leagueName: league.get("name") ?? null,
                now: Date.now(),
            }));
            refunded++;
        });
    }
    return refunded;
}
/**
 * Refunds bets on games that vanished from the provider (postponed, cancelled,
 * or pruned) and have been pending well past their start time.
 */
exports.refundStaleBets = (0, scheduler_1.onSchedule)({ schedule: "30 6 * * *", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const now = Date.now();
    const cutoff = now - 72 * 3_600_000;
    const n = (await voidDisrupted(now)) +
        (await refundStale(cutoff)) +
        (await (0, challengeSettlement_1.refundStaleChallenges)(cutoff));
    if (n > 0)
        firebase_functions_1.logger.info("refundStaleBets", { refunded: n });
});
//# sourceMappingURL=settleBets.js.map
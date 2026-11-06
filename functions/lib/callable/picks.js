"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makePick = void 0;
exports.settlePicksForGame = settlePicksForGame;
const https_1 = require("firebase-functions/v2/https");
const leagueConfig_1 = require("../lib/leagueConfig");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const settlement_1 = require("../lib/settlement");
const streak_1 = require("../lib/streak");
const streakDays_1 = require("../lib/streakDays");
const weekly_1 = require("../lib/weekly");
/**
 * Pick'em and Survivor league modes (`leagues/{id}.mode === "pickem" | "survivor"`).
 *
 *  - Pick'em: members choose the winner of any upcoming game in the league's
 *    allowed sports; each correct pick scores 1 point (`pickPoints`), no bankroll
 *    required.
 *  - Survivor: each member picks one team per week, cannot reuse a team in the
 *    same season (`usedTeams`), and a loss (or missed week) eliminates them
 *    (`eliminated: true`).
 */
const MakePickInput = zod_1.z.object({
    leagueId: zod_1.z.string().min(1),
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]),
});
exports.makePick = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = MakePickInput.parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const gameRef = economy_1.db.collection("games").doc(input.gameId);
    const userRef = economy_1.db.collection("users").doc(uid);
    const emptyDays = await (0, streakDays_1.recentEmptyDays)();
    return economy_1.db.runTransaction(async (tx) => {
        const [league, game, userSnap] = await Promise.all([
            tx.get(leagueRef),
            tx.get(gameRef),
            tx.get(userRef),
        ]);
        const now = Date.now();
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        if (league.get("status") !== "active")
            throw new https_1.HttpsError("failed-precondition", "That league has ended.");
        const endsAt = league.get("endsAt") ?? 0;
        if (endsAt && now >= endsAt)
            throw new https_1.HttpsError("failed-precondition", "That league's season is over.");
        if (!(0, leagueConfig_1.leagueStarted)(league, now))
            throw new https_1.HttpsError("failed-precondition", "This league hasn't started yet. Picks open when it does.");
        const me = league.get(`members.${uid}`);
        if (!me)
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        const mode = league.get("mode") ?? "bankroll";
        if (mode !== "pickem" && mode !== "survivor") {
            throw new https_1.HttpsError("failed-precondition", "This league uses bankroll betting, not picks.");
        }
        if (!game.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        if (game.get("status") !== "upcoming" || game.get("disrupted")) {
            throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
        }
        const startsAt = game.get("startsAt") ?? 0;
        if (startsAt && startsAt <= now) {
            throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
        }
        const allowed = league.get("allowedSports") ?? [];
        if (!allowed.includes(game.get("sport"))) {
            throw new https_1.HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
        }
        const home = game.get("homeTeam");
        const away = game.get("awayTeam");
        const picked = input.side === "home" ? home : away;
        const opp = input.side === "home" ? away : home;
        const wk = (0, weekly_1.weekKey)(startsAt || now);
        const pickId = mode === "survivor" ? `${uid}_${wk}` : `${uid}_${input.gameId}`;
        const pickRef = leagueRef.collection("picks").doc(pickId);
        const existingPick = await tx.get(pickRef);
        if (mode === "survivor") {
            if (me.eliminated) {
                throw new https_1.HttpsError("failed-precondition", "You've been knocked out of survivor.");
            }
            if (existingPick.exists && existingPick.get("status") !== "pending") {
                throw new https_1.HttpsError("failed-precondition", "Your survivor pick for this week is already settled.");
            }
            const prevTeam = existingPick.exists ? existingPick.get("teamAbbr") : undefined;
            if (existingPick.exists) {
                const prevStartsAt = existingPick.get("startsAt") ?? 0;
                if (prevStartsAt > 0 && prevStartsAt <= now) {
                    throw new https_1.HttpsError("failed-precondition", "Your survivor pick for this week is already locked.");
                }
            }
            const usedTeams = (me.usedTeams ?? []).filter((t) => t !== prevTeam);
            if (usedTeams.includes(picked.abbreviation)) {
                throw new https_1.HttpsError("failed-precondition", `You already used ${picked.abbreviation} earlier this season.`);
            }
            const nextUsed = [...usedTeams, picked.abbreviation];
            tx.update(leagueRef, {
                [`members.${uid}.usedTeams`]: nextUsed,
                lastActivityAt: now,
            });
        }
        else {
            if (existingPick.exists && existingPick.get("status") !== "pending") {
                throw new https_1.HttpsError("failed-precondition", "That pick is already settled.");
            }
            tx.update(leagueRef, { lastActivityAt: now });
        }
        tx.set(pickRef, {
            id: pickId,
            leagueId: input.leagueId,
            uid,
            displayName: me.displayName,
            mode,
            week: wk,
            gameId: input.gameId,
            sport: game.get("sport"),
            side: input.side,
            teamName: picked.name,
            teamAbbr: picked.abbreviation,
            teamColor: picked.color,
            opponentAbbr: opp.abbreviation,
            startsAt: startsAt || null,
            status: "pending",
            placedAt: now,
            settledAt: null,
        });
        if (userSnap.exists) {
            const prevStreak = userSnap.get("streak");
            tx.update(userRef, { streak: (0, streak_1.advanceStreak)(prevStreak, now, { emptyDays }) });
        }
        return { ok: true, pickId, week: wk, teamAbbr: picked.abbreviation };
    });
});
/** Grades pending pick'em and survivor picks when a game goes final. */
async function settlePicksForGame(gameId) {
    const gameSnap = await economy_1.db.collection("games").doc(gameId).get();
    if (!gameSnap.exists || gameSnap.get("status") !== "final")
        return 0;
    const homeScore = gameSnap.get("homeScore");
    const awayScore = gameSnap.get("awayScore");
    if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) {
        return 0;
    }
    const pending = await economy_1.db
        .collectionGroup("picks")
        .where("gameId", "==", gameId)
        .where("status", "==", "pending")
        .limit(500)
        .get();
    let settled = 0;
    for (const doc of pending.docs) {
        try {
            const did = await economy_1.db.runTransaction(async (tx) => {
                const pick = await tx.get(doc.ref);
                if (!pick.exists || pick.get("status") !== "pending")
                    return false;
                const leagueId = pick.get("leagueId");
                const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
                const league = await tx.get(leagueRef);
                const uid = pick.get("uid");
                const member = league.get(`members.${uid}`);
                if (!league.exists || league.get("status") !== "active" || !member)
                    return false;
                const side = pick.get("side");
                const mode = pick.get("mode") ?? league.get("mode") ?? "pickem";
                const outcome = (0, settlement_1.decide)(side, homeScore, awayScore);
                const now = Date.now();
                tx.update(doc.ref, {
                    status: outcome,
                    finalHomeScore: homeScore,
                    finalAwayScore: awayScore,
                    settledAt: now,
                });
                const update = { lastActivityAt: now };
                if (mode === "pickem") {
                    if (outcome === "won") {
                        update[`members.${uid}.pickPoints`] = economy_1.FieldValue.increment(1);
                        update[`members.${uid}.betsWon`] = economy_1.FieldValue.increment(1);
                    }
                    else if (outcome === "lost") {
                        update[`members.${uid}.betsLost`] = economy_1.FieldValue.increment(1);
                    }
                    else {
                        update[`members.${uid}.betsPush`] = economy_1.FieldValue.increment(1);
                    }
                }
                else if (mode === "survivor") {
                    if (outcome === "won") {
                        update[`members.${uid}.betsWon`] = economy_1.FieldValue.increment(1);
                    }
                    else {
                        // A loss or tie in survivor knocks the player out.
                        update[`members.${uid}.eliminated`] = true;
                        update[`members.${uid}.eliminatedAt`] = now;
                        update[`members.${uid}.eliminatedWeek`] = pick.get("week") ?? null;
                        update[`members.${uid}.betsLost`] = economy_1.FieldValue.increment(1);
                        const name = pick.get("displayName") ?? "Player";
                        const abbr = pick.get("teamAbbr");
                        tx.set(leagueRef.collection("activity").doc(`surv_out_${doc.id}`), {
                            type: "survivor_out",
                            uid,
                            name,
                            amount: 0,
                            text: `${name} was knocked out of Survivor on ${abbr}`,
                            at: now,
                        });
                    }
                }
                tx.update(leagueRef, update);
                return true;
            });
            if (did)
                settled++;
        }
        catch (err) {
            firebase_functions_1.logger.error("failed to settle pick", { pickId: doc.id, err });
        }
    }
    return settled;
}
//# sourceMappingURL=picks.js.map
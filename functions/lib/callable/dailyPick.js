"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeFreeBet = exports.FREE_BET_STAKE = exports.makeDailyPick = exports.scheduleDailyPick = exports.DAILY_PICK_XP = void 0;
exports.chooseDailyPick = chooseDailyPick;
exports.settleDailyPicksForGame = settleDailyPicksForGame;
const https_1 = require("firebase-functions/v2/https");
// import { onSchedule } from "firebase-functions/v2/scheduler";
const onlineSchedule_1 = require("../lib/onlineSchedule");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const streak_1 = require("../lib/streak");
const streakDays_1 = require("../lib/streakDays");
const xp_1 = require("../lib/xp");
const achievements_1 = require("../lib/achievements");
const pricing_1 = require("../lib/pricing");
const playLimits_1 = require("../lib/playLimits");
/**
 * Daily Pick: one featured game a day, the same for everyone, free (no stake,
 * no credits at risk). Making it keeps the daily streak alive and pays XP.
 *
 *   dailyPick/{YYYY-MM-DD}                    the featured game (server-written)
 *   users/{uid}/dailyPicks/{YYYY-MM-DD}       the player's pick and its result
 */
exports.DAILY_PICK_XP = 15;
const SPORT_PRIORITY = ["NFL", "NBA", "NCAAF", "MLB", "NHL", "NCAAB", "Soccer"];
/** Chooses today's featured game: the highest-profile sport, prime-time first. */
async function chooseDailyPick(now = Date.now()) {
    const day = (0, streak_1.nyDay)(now);
    const ref = economy_1.db.collection("dailyPick").doc(day);
    const existing = await ref.get();
    if (existing.exists && existing.get("empty") !== true)
        return ref.id;
    const games = await economy_1.db
        .collection("games")
        .where("status", "==", "upcoming")
        .where("startsAt", ">=", now + 30 * 60_000)
        .where("startsAt", "<=", now + 20 * 3600_000)
        .limit(200)
        .get();
    const todays = games.docs.filter((g) => (0, streak_1.nyDay)(g.get("startsAt")) === day);
    if (!todays.length) {
        // No featured game: mark the day empty so it doesn't break streaks. Only from
        // noon ET, by when the day's slate is synced; a later game overwrites this.
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
        if (!existing.exists && hour >= 12)
            await ref.set({ day, empty: true, createdAt: economy_1.FieldValue.serverTimestamp() });
        return null;
    }
    const rank = (s) => {
        const i = SPORT_PRIORITY.indexOf(s);
        return i < 0 ? 99 : i;
    };
    // Best sport, then the slot closest to 8pm ET.
    const pick = todays.sort((a, b) => {
        const r = rank(a.get("sport")) - rank(b.get("sport"));
        if (r)
            return r;
        const prime = (t) => Math.abs(Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(t))) - 20);
        return prime(a.get("startsAt")) - prime(b.get("startsAt"));
    })[0];
    await ref.set({
        day,
        gameId: pick.id,
        sport: pick.get("sport") ?? null,
        startsAt: pick.get("startsAt"),
        homeTeam: pick.get("homeTeam") ?? null,
        awayTeam: pick.get("awayTeam") ?? null,
        createdAt: economy_1.FieldValue.serverTimestamp(),
    });
    return day;
}
exports.scheduleDailyPick = (0, onlineSchedule_1.onSchedule)({ schedule: "every 60 minutes", region: "us-central1", timeZone: "America/New_York", timeoutSeconds: 120 }, async () => {
    const day = await chooseDailyPick(Date.now());
    if (day)
        firebase_functions_1.logger.info("daily pick ready", { day });
});
const Input = zod_1.z.object({ side: zod_1.z.enum(["home", "away"]) });
exports.makeDailyPick = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { side } = Input.parse(req.data);
    const now = Date.now();
    const day = (0, streak_1.nyDay)(now);
    const featuredRef = economy_1.db.collection("dailyPick").doc(day);
    const userRef = economy_1.db.collection("users").doc(uid);
    const pickRef = userRef.collection("dailyPicks").doc(day);
    const emptyDays = await (0, streakDays_1.recentEmptyDays)();
    const out = await economy_1.db.runTransaction(async (tx) => {
        const [featured, user, existing] = await Promise.all([tx.get(featuredRef), tx.get(userRef), tx.get(pickRef)]);
        if (!featured.exists || featured.get("empty") === true)
            throw new https_1.HttpsError("failed-precondition", "No Daily Pick today yet.");
        const game = await tx.get(economy_1.db.collection("games").doc(featured.get("gameId")));
        if (!game.exists || game.get("status") !== "upcoming" || game.get("startsAt") <= now) {
            throw new https_1.HttpsError("failed-precondition", "Today's Daily Pick has locked.");
        }
        const prev = user.get("streak");
        // Changing sides isn't a second qualifying action (it would complete a streak repair for free).
        const streak = existing.exists && prev ? prev : (0, streak_1.advanceStreak)(prev, now, { emptyDays });
        // Changing your side before kickoff is fine; the streak only advances once a day anyway.
        tx.set(pickRef, {
            day,
            gameId: game.id,
            side,
            teamAbbr: game.get(side === "home" ? "homeTeam.abbreviation" : "awayTeam.abbreviation") ?? null,
            result: null,
            at: now,
            uid,
        });
        tx.update(userRef, { streak });
        const milestone = !existing.exists && (prev?.count ?? 0) !== streak.count && streak_1.STREAK_MILESTONES.includes(streak.count) ? streak.count : null;
        return { first: !existing.exists, streak, milestone };
    });
    if (out.first)
        await (0, xp_1.grantXp)(uid, exports.DAILY_PICK_XP, `daily_${day}`, "daily_pick").catch(() => { });
    await (0, achievements_1.checkAchievements)(uid).catch(() => []);
    return { ok: true, day, streak: out.streak.count, freezes: out.streak.freezes ?? 0, milestone: out.milestone };
});
/** Grades every Daily Pick on a game once it is final. Called from onGameFinal. */
async function settleDailyPicksForGame(gameId) {
    const game = await economy_1.db.collection("games").doc(gameId).get();
    if (!game.exists || game.get("status") !== "final")
        return 0;
    const home = game.get("homeScore");
    const away = game.get("awayScore");
    if (home === null || away === null)
        return 0;
    const winner = home === away ? null : home > away ? "home" : "away";
    const picks = await economy_1.db.collectionGroup("dailyPicks").where("gameId", "==", gameId).where("result", "==", null).limit(5000).get();
    let n = 0;
    for (let i = 0; i < picks.docs.length; i += 400) {
        const batch = economy_1.db.batch();
        for (const d of picks.docs.slice(i, i + 400)) {
            const result = winner === null ? "push" : d.get("side") === winner ? "won" : "lost";
            batch.update(d.ref, { result, settledAt: Date.now() });
            const uid = d.get("uid");
            if (uid && result !== "push")
                batch.update(economy_1.db.collection("users").doc(uid), { [`dailyRecord.${result === "won" ? "w" : "l"}`]: economy_1.FieldValue.increment(1) });
            n++;
        }
        await batch.commit();
    }
    return n;
}
/* ── Daily free bet ──────────────────────────────────────────────────────────
 * Every America/New_York day each player gets one free 100-credit bet: a
 * moneyline pick on any upcoming game (today's Daily Pick game is the
 * suggestion). Nothing is debited. A win pays the winnings (100 × odds − 100),
 * the free stake itself is never returned, like a sportsbook free bet.
 *
 * It's a normal bets/{id} document with stake 0, so settlement, voids,
 * notifications and stats need nothing special:
 *   stake 0, potentialPayout = winnings, freeBet true, freeStake 100, freeDay.
 *   users/{uid}/freeBets/{YYYY-MM-DD}   the day's token (exists = used)
 * Cancelling it before kickoff (cancelBet) deletes the token, so it can be
 * placed again.
 */
exports.FREE_BET_STAKE = 100;
const FreeBetInput = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]).optional(),
    /** Moneyline (default), spread or total, like a normal bet. */
    market: zod_1.z.enum(["ml", "spread", "total"]).optional(),
    selection: zod_1.z.enum(["home", "away", "over", "under"]).optional(),
    idempotencyKey: zod_1.z.string().min(8).max(64),
}).refine((v) => !!(v.side || v.selection), { message: "Pick a side." });
exports.placeFreeBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = FreeBetInput.parse(req.data);
    const now = Date.now();
    const day = (0, streak_1.nyDay)(now);
    const betId = `${uid}_${input.idempotencyKey}`;
    const betRef = economy_1.db.collection("bets").doc(betId);
    const userRef = economy_1.db.collection("users").doc(uid);
    const tokenRef = userRef.collection("freeBets").doc(day);
    const gameRef = economy_1.db.collection("games").doc(input.gameId);
    const featuredRef = economy_1.db.collection("dailyPick").doc(day);
    const pickRef = userRef.collection("dailyPicks").doc(day);
    const emptyDays = await (0, streakDays_1.recentEmptyDays)();
    const out = await economy_1.db.runTransaction(async (tx) => {
        const [existing, token, game, user, featured, pick] = await Promise.all([
            tx.get(betRef),
            tx.get(tokenRef),
            tx.get(gameRef),
            tx.get(userRef),
            tx.get(featuredRef),
            tx.get(pickRef),
        ]);
        if (existing.exists)
            return { duplicate: true, first: false, winnings: existing.get("potentialPayout"), streak: null, milestone: null };
        if (token.exists)
            throw new https_1.HttpsError("failed-precondition", "You've already used today's free bet. A new one is ready tomorrow.");
        if (!user.exists)
            throw new https_1.HttpsError("not-found", "Profile not found.");
        if (!game.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        const startsAt = game.get("startsAt") ?? 0;
        if (game.get("status") !== "upcoming" || (startsAt && startsAt <= now)) {
            throw new https_1.HttpsError("failed-precondition", "That game has already started. Pick another one.");
        }
        const limitUpdate = (0, playLimits_1.checkPlayLimits)(user, now);
        const priced = (0, pricing_1.requirePricedMarket)(game, { market: input.market ?? "ml", side: input.side, selection: input.selection });
        const winnings = Math.max(1, Math.round(exports.FREE_BET_STAKE * priced.odds) - exports.FREE_BET_STAKE);
        tx.set(betRef, {
            id: betId,
            uid,
            gameId: input.gameId,
            sport: game.get("sport"),
            market: priced.market,
            selection: priced.selection,
            side: priced.side,
            line: priced.line,
            label: priced.label,
            teamName: priced.teamName,
            teamAbbr: priced.teamAbbr,
            teamColor: priced.teamColor,
            opponentAbbr: priced.opponentAbbr,
            stake: 0,
            freeBet: true,
            freeStake: exports.FREE_BET_STAKE,
            freeDay: day,
            odds: priced.odds,
            potentialPayout: winnings,
            status: "pending",
            startsAt: startsAt || null,
            opponentUid: null,
            placedAt: economy_1.FieldValue.serverTimestamp(),
            settledAt: null,
        });
        tx.set(tokenRef, { day, betId, gameId: input.gameId, at: now });
        // It counts as the day's pick: streak, and the Daily Pick record when it's on the featured game.
        const prev = user.get("streak");
        const streak = (0, streak_1.advanceStreak)(prev, now, { emptyDays });
        if (!pick.exists && featured.exists && featured.get("gameId") === input.gameId && priced.market === "ml" && priced.side) {
            tx.set(pickRef, { day, gameId: input.gameId, side: priced.side, teamAbbr: priced.teamAbbr, result: null, at: now, uid });
        }
        tx.update(userRef, { "stats.betsPlaced": economy_1.FieldValue.increment(1), streak, ...limitUpdate });
        const milestone = (prev?.count ?? 0) !== streak.count && streak_1.STREAK_MILESTONES.includes(streak.count) ? streak.count : null;
        return { duplicate: false, first: true, winnings, streak, milestone };
    });
    if (out.first)
        await (0, xp_1.grantXp)(uid, exports.DAILY_PICK_XP, `daily_${day}`, "daily_pick").catch(() => { });
    if (out.first)
        await (0, achievements_1.checkAchievements)(uid).catch(() => []);
    return { ok: true, betId, day, winnings: out.winnings, duplicate: out.duplicate, streak: out.streak?.count ?? null, milestone: out.milestone };
});
//# sourceMappingURL=dailyPick.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelParlay = exports.placeParlay = exports.MAX_SLIP_ODDS = exports.MAX_SLIP_LEGS = exports.MIN_SLIP_LEGS = void 0;
exports.slipOdds = slipOdds;
exports.settleSlipParlaysForGame = settleSlipParlaysForGame;
exports.voidSlipParlayLegs = voidSlipParlayLegs;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const pricing_1 = require("../lib/pricing");
const playLimits_1 = require("../lib/playLimits");
const streak_1 = require("../lib/streak");
const streakDays_1 = require("../lib/streakDays");
const settlement_1 = require("../lib/settlement");
const gameState_1 = require("../lib/gameState");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
/**
 * Parlays on the main credits wallet, like a sportsbook bet slip: 2–10 legs on
 * different games (moneyline, spread or total each). Every leg has to win;
 * the prices multiply. A pushed or voided leg drops out (counts as 1.0x); if
 * every leg pushes, the stake comes back. One losing leg loses the ticket.
 *
 *   slipParlays/{uid}_{idempotencyKey}
 *     legs[]      gameId, market, selection, side, line, label, odds, status
 *     gameIds[]   for array-contains settlement queries
 *     stake, odds (combined at placement, capped), potentialPayout, status
 *
 * Settled leg by leg as games go final (onGameFinal → settleSlipParlaysForGame).
 */
exports.MIN_SLIP_LEGS = 2;
exports.MAX_SLIP_LEGS = 10;
/** Combined price cap, so a long ticket can't print the economy. */
exports.MAX_SLIP_ODDS = 250;
const MIN_STAKE = 10;
const MAX_STAKE = 100_000;
const round2 = (n) => Math.round(n * 100) / 100;
/** Product of live legs (pushes and voids count as 1.0x), capped. */
function slipOdds(legs) {
    let p = 1;
    for (const l of legs)
        if (l.status !== "push" && l.status !== "void")
            p *= l.odds;
    return round2(Math.min(exports.MAX_SLIP_ODDS, p));
}
const LegInput = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
    market: zod_1.z.enum(["ml", "spread", "total"]).default("ml"),
    selection: zod_1.z.enum(["home", "away", "over", "under"]),
});
const PlaceInput = zod_1.z.object({
    legs: zod_1.z.array(LegInput).min(exports.MIN_SLIP_LEGS).max(exports.MAX_SLIP_LEGS),
    stake: zod_1.z.number().int().min(MIN_STAKE).max(MAX_STAKE),
    idempotencyKey: zod_1.z.string().min(8).max(64),
});
exports.placeParlay = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = PlaceInput.parse(req.data);
    const ids = input.legs.map((l) => l.gameId);
    if (new Set(ids).size !== ids.length)
        throw new https_1.HttpsError("invalid-argument", "One leg per game: a parlay can't have two picks on the same game.");
    const ref = economy_1.db.collection("slipParlays").doc(`${uid}_${input.idempotencyKey}`);
    const userRef = economy_1.db.collection("users").doc(uid);
    const emptyDays = await (0, streakDays_1.recentEmptyDays)();
    return economy_1.db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists)
            return { ok: true, parlayId: ref.id, duplicate: true };
        const [user, ...games] = await Promise.all([tx.get(userRef), ...ids.map((id) => tx.get(economy_1.db.collection("games").doc(id)))]);
        const now = Date.now();
        const limitUpdate = (0, playLimits_1.checkPlayLimits)(user, now);
        const legs = input.legs.map((l, i) => {
            const g = games[i];
            if (!g.exists)
                throw new https_1.HttpsError("not-found", "One of those games is no longer available.");
            const startsAt = g.get("startsAt") ?? 0;
            if (g.get("status") !== "upcoming" || (startsAt && startsAt <= now)) {
                throw new https_1.HttpsError("failed-precondition", `${g.get("awayTeam.abbreviation") ?? "A"} @ ${g.get("homeTeam.abbreviation") ?? "game"} has already started. Take it off the slip.`);
            }
            const side = l.market === "total" ? undefined : l.selection;
            const p = (0, pricing_1.requirePricedMarket)(g, { market: l.market, selection: l.selection, side });
            return {
                gameId: l.gameId,
                sport: g.get("sport") ?? null,
                market: p.market,
                selection: p.selection,
                side: p.side,
                line: p.line,
                label: p.label,
                teamAbbr: p.teamAbbr,
                opponentAbbr: p.opponentAbbr,
                odds: p.odds,
                startsAt,
                status: "pending",
            };
        });
        const odds = slipOdds(legs);
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: -input.stake,
            type: "bet_stake",
            idempotencyKey: `parlay_stake_${input.idempotencyKey}`,
            ref: ref.id,
            note: `${legs.length}-leg parlay`,
        });
        tx.set(ref, {
            id: ref.id,
            uid,
            kind: "parlay",
            legs,
            gameIds: ids,
            stake: input.stake,
            odds,
            potentialPayout: Math.round(input.stake * odds),
            status: "pending",
            firstStartsAt: Math.min(...legs.map((l) => l.startsAt || Infinity)),
            placedAt: economy_1.FieldValue.serverTimestamp(),
            settledAt: null,
        });
        const streak = (0, streak_1.advanceStreak)(user.get("streak"), now, { emptyDays });
        tx.update(userRef, {
            "stats.betsPlaced": economy_1.FieldValue.increment(1),
            "stats.creditsStaked": economy_1.FieldValue.increment(input.stake),
            streak,
            ...limitUpdate,
        });
        return { ok: true, parlayId: ref.id, duplicate: false, odds, balance };
    });
});
/** Cancels a parlay before its first game starts, refunding the stake. */
exports.cancelParlay = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parlayId = zod_1.z.string().min(1).parse(req.data?.parlayId);
    const ref = economy_1.db.collection("slipParlays").doc(parlayId);
    return economy_1.db.runTransaction(async (tx) => {
        const p = await tx.get(ref);
        if (!p.exists)
            throw new https_1.HttpsError("not-found", "Parlay not found.");
        if (p.get("uid") !== uid)
            throw new https_1.HttpsError("permission-denied", "Not your parlay.");
        if (p.get("status") !== "pending")
            throw new https_1.HttpsError("failed-precondition", "That parlay is already settled.");
        const legs = p.get("legs");
        const games = await Promise.all(legs.map((l) => tx.get(economy_1.db.collection("games").doc(l.gameId))));
        const now = Date.now();
        if (games.some((g) => !g.exists || g.get("status") !== "upcoming" || (g.get("startsAt") ?? 0) <= now)) {
            throw new https_1.HttpsError("failed-precondition", "A game on this parlay has started — it's locked in.");
        }
        const stake = p.get("stake");
        const balance = await (0, economy_1.applyCredits)(tx, uid, { delta: stake, type: "bet_refund", idempotencyKey: `parlay_cancel_${parlayId}`, ref: parlayId, note: "Parlay cancelled before kickoff" });
        tx.update(ref, { status: "cancelled", settledAt: economy_1.FieldValue.serverTimestamp() });
        tx.update(economy_1.db.collection("users").doc(uid), { "stats.betsPlaced": economy_1.FieldValue.increment(-1), "stats.creditsStaked": economy_1.FieldValue.increment(-stake) });
        return { ok: true, balance };
    });
});
/**
 * Grades one parlay after a leg changed; pays it out, refunds it or loses it
 * once decided. Runs inside the caller's transaction.
 */
async function finish(tx, ref, legs, data) {
    const uid = data.uid;
    const stake = data.stake;
    const lost = legs.find((l) => l.status === "lost");
    const open = legs.some((l) => l.status === "pending");
    if (!lost && open) {
        tx.update(ref, { legs });
        return;
    }
    const now = Date.now();
    if (lost) {
        tx.update(ref, { legs, status: "lost", settledAt: economy_1.FieldValue.serverTimestamp(), bustedBy: lost.label });
        tx.update(economy_1.db.collection("users").doc(uid), { "stats.betsLost": economy_1.FieldValue.increment(1) });
        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({ id: `parlay_${ref.id}`, type: "bet_lost", title: `Parlay missed — ${lost.label}`, body: `${legs.length}-leg parlay · −${stake.toLocaleString("en-US")} credits`, delta: -stake, now, popup: true }));
        return;
    }
    const live = legs.filter((l) => l.status === "won");
    if (!live.length) {
        const balance = await (0, economy_1.applyCredits)(tx, uid, { delta: stake, type: "bet_refund", idempotencyKey: `parlay_settle_${ref.id}`, ref: ref.id, note: "Parlay push — stake returned" });
        tx.update(ref, { legs, status: "push", settledAt: economy_1.FieldValue.serverTimestamp() });
        (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({ id: `parlay_${ref.id}`, type: "bet_push", title: "Parlay push", body: "Every leg pushed or was called off — your stake is back.", delta: 0, balanceAfter: balance, now }));
        return;
    }
    const odds = slipOdds(legs);
    const payout = Math.round(stake * odds);
    const balance = await (0, economy_1.applyCredits)(tx, uid, { delta: payout, type: "bet_payout", idempotencyKey: `parlay_settle_${ref.id}`, ref: ref.id, note: `Won ${legs.length}-leg parlay` });
    tx.update(ref, { legs, status: "won", odds, potentialPayout: payout, settledAt: economy_1.FieldValue.serverTimestamp() });
    tx.update(economy_1.db.collection("users").doc(uid), { "stats.betsWon": economy_1.FieldValue.increment(1), "stats.creditsWon": economy_1.FieldValue.increment(payout - stake) });
    (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({ id: `parlay_${ref.id}`, type: "bet_won", title: `Parlay hit! +${(payout - stake).toLocaleString("en-US")}`, body: `${legs.length}-leg parlay at ${odds.toFixed(2)}x`, delta: payout - stake, balanceAfter: balance, now, popup: true }));
}
/** Grades the legs on a final game across every open parlay that has it. */
async function settleSlipParlaysForGame(gameId) {
    const game = await economy_1.db.collection("games").doc(gameId).get();
    if (!game.exists || game.get("status") !== "final")
        return 0;
    const home = game.get("homeScore");
    const away = game.get("awayScore");
    if (home === null || away === null)
        return 0;
    const open = await economy_1.db.collection("slipParlays").where("gameIds", "array-contains", gameId).where("status", "==", "pending").limit(500).get();
    let n = 0;
    for (const d of open.docs) {
        await economy_1.db.runTransaction(async (tx) => {
            const p = await tx.get(d.ref);
            if (!p.exists || p.get("status") !== "pending")
                return;
            const legs = p.get("legs").map((l) => l.gameId === gameId && l.status === "pending" ? { ...l, status: (0, settlement_1.decide)({ market: l.market, selection: l.selection, side: l.side, line: l.line }, home, away) } : l);
            await finish(tx, d.ref, legs, p.data());
            n++;
        });
    }
    return n;
}
/** Legs on cancelled / long-postponed games drop out (1.0x), so the rest of the ticket still counts. */
async function voidSlipParlayLegs(now = Date.now()) {
    const open = await economy_1.db.collection("slipParlays").where("status", "==", "pending").limit(500).get();
    const cache = new Map();
    let n = 0;
    for (const d of open.docs) {
        const legs = d.get("legs");
        let hit = false;
        for (const l of legs) {
            if (l.status !== "pending")
                continue;
            if (!cache.has(l.gameId)) {
                const g = await economy_1.db.collection("games").doc(l.gameId).get();
                cache.set(l.gameId, g.exists ? (0, gameState_1.voidReason)(g.data(), now) : "expired");
            }
            if (cache.get(l.gameId))
                hit = true;
        }
        if (!hit)
            continue;
        await economy_1.db.runTransaction(async (tx) => {
            const p = await tx.get(d.ref);
            if (!p.exists || p.get("status") !== "pending")
                return;
            const next = p.get("legs").map((l) => (l.status === "pending" && cache.get(l.gameId) ? { ...l, status: "void" } : l));
            await finish(tx, d.ref, next, p.data());
            n++;
        });
    }
    return n;
}
//# sourceMappingURL=slipParlays.js.map
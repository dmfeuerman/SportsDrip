"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldValue = exports.ratingsRef = void 0;
exports.applyResultToRatings = applyResultToRatings;
exports.rateRecentFinals = rateRecentFinals;
exports.modelPrices = modelPrices;
exports.withModelPrices = withModelPrices;
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return economy_1.FieldValue; } });
const oddsModel_1 = require("./oddsModel");
/**
 * ratings/{sport}: { teams: { [abbr]: TeamRating }, model, updatedAt }.
 * Written only here (rules: read-only to clients).
 */
const ratingsRef = (sport) => economy_1.db.collection("ratings").doc(sport);
exports.ratingsRef = ratingsRef;
const MODEL_SPORTS = new Set(["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"]);
const isModelSport = (s) => MODEL_SPORTS.has(s);
/**
 * Folds one final into both teams' Elo, exactly once (games/{id}.rated).
 * Starting Elo for a team we've never rated is its record prior, so the
 * first update doesn't drag a 10-2 team back to average.
 */
async function applyResultToRatings(gameId) {
    const gameRef = economy_1.db.collection("games").doc(gameId);
    return economy_1.db.runTransaction(async (tx) => {
        const game = await tx.get(gameRef);
        if (!game.exists || game.get("status") !== "final" || game.get("rated") === true)
            return false;
        const sport = game.get("sport");
        const hs = game.get("homeScore");
        const as = game.get("awayScore");
        if (!isModelSport(sport) || typeof hs !== "number" || typeof as !== "number" || game.get("disrupted"))
            return false;
        const home = game.get("homeTeam");
        const away = game.get("awayTeam");
        const ref = (0, exports.ratingsRef)(sport);
        const snap = await tx.get(ref);
        const teams = (snap.data()?.teams ?? {});
        const start = (t) => {
            const have = teams[t.abbreviation];
            if (have)
                return have;
            // The feed's record already includes this game; that's fine for a starting prior.
            return { elo: (0, oddsModel_1.recordRating)(sport, t)?.rating ?? oddsModel_1.BASE_ELO, games: 0, updatedAt: 0 };
        };
        const h = start(home);
        const a = start(away);
        const next = (0, oddsModel_1.eloUpdate)(sport, h.elo, a.elo, hs, as, Boolean(game.get("neutralSite")));
        const now = Date.now();
        tx.set(ref, {
            model: oddsModel_1.MODEL_VERSION,
            updatedAt: now,
            teams: {
                [home.abbreviation]: { elo: Math.round(next.home * 10) / 10, games: h.games + 1, updatedAt: now },
                [away.abbreviation]: { elo: Math.round(next.away * 10) / 10, games: a.games + 1, updatedAt: now },
            },
        }, { merge: true });
        tx.set(gameRef, { rated: true, ratedAt: now, eloDelta: Math.round(next.delta * 10) / 10 }, { merge: true });
        return true;
    });
}
/** Catches finals the trigger missed (cold deploys, dropped events). */
async function rateRecentFinals(now = Date.now()) {
    const snap = await economy_1.db
        .collection("games")
        .where("status", "==", "final")
        .where("startsAt", ">", now - 4 * 86_400_000)
        .limit(300)
        .get();
    let n = 0;
    for (const d of snap.docs) {
        if (d.get("rated") === true)
            continue;
        if (await applyResultToRatings(d.id).catch((err) => (firebase_functions_1.logger.warn("rating failed", { gameId: d.id, error: String(err) }), false)))
            n++;
    }
    return n;
}
/** Model prices for upcoming games the feed hasn't priced. One ratings read per sport. */
async function modelPrices(games) {
    const need = games.filter((g) => !g.priced && g.status === "upcoming" && !g.disrupted && isModelSport(g.sport));
    const out = new Map();
    if (!need.length)
        return out;
    const sports = [...new Set(need.map((g) => g.sport))];
    const docs = await Promise.all(sports.map((s) => (0, exports.ratingsRef)(s).get().then((d) => [s, d.data()?.teams ?? {}])));
    const bySport = new Map(docs);
    for (const g of need) {
        const sport = g.sport;
        const teams = bySport.get(sport) ?? {};
        const he = teams[g.homeTeam.abbreviation];
        const ae = teams[g.awayTeam.abbreviation];
        const hr = (0, oddsModel_1.blendedRating)(sport, he, g.homeTeam);
        const ar = (0, oddsModel_1.blendedRating)(sport, ae, g.awayTeam);
        const p = (0, oddsModel_1.homeWinProbability)(sport, hr, ar, g.neutralSite);
        const prices = (0, oddsModel_1.priceFromProbability)(p);
        const games = (t, e) => Math.max(e?.games ?? 0, (0, oddsModel_1.recordRating)(sport, t)?.games ?? 0);
        out.set(g.id, { ...prices, pHome: Math.round(p * 1000) / 1000, confidence: (0, oddsModel_1.modelConfidence)(sport, games(g.homeTeam, he), games(g.awayTeam, ae)) });
    }
    return out;
}
/**
 * Fills in model prices on unpriced games (in place) and tags every game with
 * where its price came from. Book prices are never touched.
 */
async function withModelPrices(games) {
    const prices = await modelPrices(games).catch((err) => {
        firebase_functions_1.logger.warn("model pricing failed", { error: String(err) });
        return new Map();
    });
    const priced = games.map((g) => {
        const m = prices.get(g.id);
        if (g.priced)
            return { ...g, oddsSource: "book", model: null };
        if (!m)
            return { ...g, oddsSource: null, model: null };
        return {
            ...g,
            homeTeam: { ...g.homeTeam, odds: m.home },
            awayTeam: { ...g.awayTeam, odds: m.away },
            priced: true,
            oddsProvider: "On The House Model",
            oddsSource: "model",
            model: { pHome: m.pHome, confidence: m.confidence, version: oddsModel_1.MODEL_VERSION, pricedAt: Date.now() },
        };
    });
    return withClosingLines(priced).catch((err) => {
        firebase_functions_1.logger.warn("closing lines failed", { error: String(err) });
        return priced;
    });
}
/**
 * ESPN drops a game's odds and spread/total once it starts. Without this the
 * next sync merges nulls over the pregame prices and live games read "No Line".
 * A started game keeps the last line it had before kickoff (its closing line).
 */
async function withClosingLines(games) {
    const need = games.filter((g) => g.status !== "upcoming" && (!g.priced || !g.line));
    if (!need.length)
        return games;
    const refs = need.map((g) => economy_1.db.collection("games").doc(g.id));
    const snaps = [];
    for (let i = 0; i < refs.length; i += 100)
        snaps.push(...(await economy_1.db.getAll(...refs.slice(i, i + 100))));
    const stored = new Map(snaps.filter((d) => d.exists).map((d) => [d.id, d.data()]));
    return games.map((g) => {
        const prev = stored.get(g.id);
        if (!prev || g.status === "upcoming")
            return g;
        let out = g;
        if (!g.priced && prev.priced && prev.homeTeam?.odds && prev.awayTeam?.odds) {
            out = {
                ...out,
                homeTeam: { ...out.homeTeam, odds: prev.homeTeam.odds },
                awayTeam: { ...out.awayTeam, odds: prev.awayTeam.odds },
                priced: true,
                oddsProvider: prev.oddsProvider ?? null,
                oddsSource: prev.oddsSource ?? null,
                model: prev.model ?? null,
            };
        }
        if (!g.line && prev.line)
            out = { ...out, line: prev.line };
        return out;
    });
}
//# sourceMappingURL=ratings.js.map
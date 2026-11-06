"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLiveGames = exports.pruneGames = exports.syncGames = void 0;
exports.sendClutchAlerts = sendClutchAlerts;
exports.writeChangedGames = writeChangedGames;
exports.liveGamesWithStakes = liveGamesWithStakes;
exports.refreshLiveGames = refreshLiveGames;
const node_crypto_1 = require("node:crypto");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const ratings_1 = require("../lib/ratings");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const gameState_1 = require("../lib/gameState");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const sportsProvider_1 = require("../lib/sportsProvider");
const sweat_1 = require("./sweat");
/**
 * Sends a one-time clutch alert to everyone with league stakes on a live game
 * that enters its final 5 minutes (or 9th inning) within one score.
 * Exported for unit tests.
 */
async function sendClutchAlerts(games, now = Date.now()) {
    const candidates = games ??
        (await economy_1.db.collection("games").where("status", "==", "live").limit(200).get()).docs.map((d) => ({
            id: d.id,
            ...d.data(),
        }));
    const clutchGames = candidates.filter((g) => (0, gameState_1.isClutch)(g));
    if (clutchGames.length === 0)
        return 0;
    let alertsSent = 0;
    for (const g of clutchGames) {
        const sidesGroup = await economy_1.db
            .collectionGroup("gameSides")
            .where("gameId", "==", g.id)
            .limit(200)
            .get();
        for (const sideDoc of sidesGroup.docs) {
            if (sideDoc.get("clutchAlerted") === true)
                continue;
            const entries = sideDoc.get("entries") ?? [];
            if (entries.length === 0)
                continue;
            const leagueId = sideDoc.get("leagueId");
            const did = await economy_1.db.runTransaction(async (tx) => {
                const [freshSide, league] = await Promise.all([
                    tx.get(sideDoc.ref),
                    tx.get(economy_1.db.collection("leagues").doc(leagueId)),
                ]);
                if (!freshSide.exists || freshSide.get("clutchAlerted") === true)
                    return 0;
                if (!league.exists || league.get("status") !== "active")
                    return 0;
                tx.update(sideDoc.ref, { clutchAlerted: true, clutchAlertedAt: now });
                const homeAbbr = g.homeTeam?.abbreviation ?? "HOME";
                const awayAbbr = g.awayTeam?.abbreviation ?? "AWAY";
                const hs = g.homeScore ?? 0;
                const as = g.awayScore ?? 0;
                const scoreLine = hs === as
                    ? `${awayAbbr} ${as}, ${homeAbbr} ${hs} tied`
                    : hs > as
                        ? `${homeAbbr} up ${hs - as}`
                        : `${awayAbbr} up ${as - hs}`;
                const clockPart = g.clock ? `, ${g.clock} left` : "";
                const byUid = new Map();
                for (const e of entries) {
                    byUid.set(e.uid, e.displayName ?? e.name ?? "Player");
                }
                const uids = [...byUid.keys()];
                const leagueName = league.get("name") ?? "League";
                for (const uid of uids) {
                    const others = uids.filter((u) => u !== uid).map((u) => byUid.get(u));
                    const who = others.length === 0
                        ? "You are sweating."
                        : others.length === 1
                            ? `You and ${others[0]} are sweating.`
                            : `You, ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are sweating.`;
                    (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                        id: `clutch_${leagueId}_${g.id}`,
                        type: "clutch_alert",
                        title: `${scoreLine}${clockPart}`,
                        body: `${who}`,
                        wallet: "league",
                        leagueId,
                        leagueName,
                        now,
                        popup: true,
                        data: { gameId: g.id, leagueId },
                    }));
                }
                return uids.length;
            });
            alertsSent += did;
        }
    }
    return alertsSent;
}
/**
 * Write-avoidance for the scoreboard. Every sync used to rewrite every game,
 * every minute: hundreds of writes a minute, and every one of them re-read by
 * every client listening to the board. Now each game's content (minus its
 * timestamps) is fingerprinted into meta/gameHashes and only games whose
 * content changed are written. Games close to kickoff are always written,
 * because pricing.ts rejects bets on a near-kickoff game whose updatedAt is
 * more than two minutes old.
 */
const HASHES = () => economy_1.db.collection("meta").doc("gameHashes");
const ALWAYS_WRITE_BEFORE_KICKOFF_MS = 35 * 60_000;
function gameHash(g) {
    const { updatedAt: _u, model, ...rest } = g;
    const stable = { ...rest, model: model ? { ...model, pricedAt: 0 } : model };
    return (0, node_crypto_1.createHash)("sha1").update(JSON.stringify(stable)).digest("base64").slice(0, 12);
}
/** Writes the games whose content changed; returns how many were written. `prune` drops fingerprints of games no longer in the feed. */
async function writeChangedGames(games, prune, now = Date.now()) {
    const snap = await HASHES().get();
    const known = (snap.get("h") ?? {});
    const changed = [];
    const nextHashes = {};
    for (const g of games) {
        const h = gameHash(g);
        const nearKickoff = g.status === "upcoming" && g.startsAt - now < ALWAYS_WRITE_BEFORE_KICKOFF_MS;
        if (known[g.id] !== h || nearKickoff) {
            changed.push(g);
            nextHashes[g.id] = h;
        }
    }
    for (let i = 0; i < changed.length; i += 400) {
        const batch = economy_1.db.batch();
        for (const g of changed.slice(i, i + 400))
            batch.set(economy_1.db.collection("games").doc(g.id), { ...g, expired: false }, { merge: true });
        await batch.commit();
    }
    const update = {};
    for (const [id, h] of Object.entries(nextHashes))
        if (known[id] !== h)
            update[`h.${id}`] = h;
    if (prune) {
        const seen = new Set(games.map((g) => g.id));
        for (const id of Object.keys(known))
            if (!seen.has(id))
                update[`h.${id}`] = economy_1.FieldValue.delete();
    }
    if (Object.keys(update).length) {
        if (snap.exists)
            await HASHES().update(update);
        else
            await HASHES().set({ h: nextHashes });
    }
    return changed.length;
}
/**
 * Pulls the scoreboard for every configured sport and writes it to games/{id}.
 * Tightened to a 1-minute schedule so games within 30 minutes of kickoff carry
 * fresh prices.
 */
exports.syncGames = (0, scheduler_1.onSchedule)({ schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 }, async () => {
    const fetched = await (0, sportsProvider_1.fetchGames)();
    const failures = fetched.failures;
    // Unpriced upcoming games get the shared model line (same for every user).
    const games = await (0, ratings_1.withModelPrices)(fetched.games);
    if (failures.length)
        firebase_functions_1.logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
        firebase_functions_1.logger.error("sportsProvider returned nothing — leaving previous cache in place");
        return;
    }
    const written = await writeChangedGames(games, true);
    const expired = await expireMissing(new Set(games.map((g) => g.id)));
    const clutch = await sendClutchAlerts(games, Date.now());
    const sweat = await (0, sweat_1.sendSweatAlerts)(games, Date.now()).catch((err) => {
        firebase_functions_1.logger.warn("sweat alerts failed", { error: String(err) });
        return 0;
    });
    await economy_1.db.collection("meta").doc("sportsSync").set({
        lastRunAt: economy_1.FieldValue.serverTimestamp(),
        gameCount: games.length,
        written,
        expired,
        clutch,
        sweat,
        failures,
    }, { merge: true });
    firebase_functions_1.logger.info("syncGames complete", { count: games.length, written, clutch });
});
async function expireMissing(seen) {
    const cutoff = Date.now() - 6 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "in", ["upcoming", "live"])
        .where("expired", "==", false)
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    const batch = economy_1.db.batch();
    let n = 0;
    for (const d of stale.docs) {
        if (seen.has(d.id) || d.get("expired") === true)
            continue;
        batch.set(d.ref, { expired: true, expiredAt: Date.now() }, { merge: true });
        n++;
    }
    if (n)
        await batch.commit();
    if (n)
        firebase_functions_1.logger.info("expired stale games", { count: n });
    return n;
}
/** Sweeps games that finished more than 48h ago. */
exports.pruneGames = (0, scheduler_1.onSchedule)({ schedule: "0 5 * * *", region: "us-central1", timeoutSeconds: 300 }, async () => {
    const cutoff = Date.now() - 48 * 3_600_000;
    const stale = await economy_1.db
        .collection("games")
        .where("status", "==", "final")
        .where("startsAt", "<", cutoff)
        .limit(400)
        .get();
    if (stale.empty)
        return;
    const batch = economy_1.db.batch();
    let deleted = 0;
    for (const d of stale.docs) {
        const pending = await economy_1.db
            .collection("bets")
            .where("gameId", "==", d.id)
            .where("status", "==", "pending")
            .limit(1)
            .get();
        if (!pending.empty) {
            firebase_functions_1.logger.warn("skipping prune, bets still pending", { gameId: d.id });
            continue;
        }
        batch.delete(d.ref);
        batch.delete(economy_1.db.collection("gameInsights").doc(d.id));
        deleted++;
    }
    if (deleted === 0)
        return;
    await batch.commit();
    firebase_functions_1.logger.info("pruneGames", { deleted });
});
/** Live games someone has money on: a sweat doc, a pending global bet, or a pending league bet. */
async function liveGamesWithStakes() {
    const live = await economy_1.db.collection("games").where("status", "==", "live").limit(200).get();
    const checks = await Promise.all(live.docs.map(async (g) => {
        const [sweat, bet, leagueBet] = await Promise.all([
            economy_1.db.collection("sweat").doc(g.id).get(),
            economy_1.db.collection("bets").where("gameId", "==", g.id).where("status", "==", "pending").limit(1).get(),
            economy_1.db.collectionGroup("leagueBets").where("gameId", "==", g.id).where("status", "==", "pending").limit(1).get(),
        ]);
        return sweat.exists || !bet.empty || !leagueBet.empty ? { id: g.id, sport: g.get("sport") } : null;
    }));
    return checks.filter((x) => !!x);
}
/** One live pass: re-fetch only the sports with staked live games and write just those games. */
async function refreshLiveGames() {
    const staked = await liveGamesWithStakes();
    if (!staked.length)
        return 0;
    const ids = new Set(staked.map((g) => g.id));
    const { games: raw } = await (0, sportsProvider_1.fetchGames)(new Set(staked.map((g) => g.sport)));
    const games = await (0, ratings_1.withModelPrices)(raw);
    const fresh = games.filter((g) => ids.has(g.id));
    if (!fresh.length)
        return 0;
    await writeChangedGames(fresh, false);
    const now = Date.now();
    await sendClutchAlerts(fresh, now).catch(() => 0);
    await (0, sweat_1.sendSweatAlerts)(fresh, now).catch(() => 0);
    return fresh.length;
}
/**
 * Sub-minute freshness for live games with open stakes: a 1-minute job that
 * refreshes twice, ~30 s apart (offset from syncGames' own pass). Cost scales
 * with staked live games, not users; a quiet slate does one cheap query.
 */
exports.syncLiveGames = (0, scheduler_1.onSchedule)({ schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 90, retryCount: 0 }, async () => {
    await new Promise((r) => setTimeout(r, 15_000));
    const a = await refreshLiveGames().catch((err) => (firebase_functions_1.logger.warn("live refresh failed", { error: String(err) }), 0));
    await new Promise((r) => setTimeout(r, 30_000));
    const b = await refreshLiveGames().catch((err) => (firebase_functions_1.logger.warn("live refresh failed", { error: String(err) }), 0));
    if (a || b)
        firebase_functions_1.logger.info("syncLiveGames", { first: a, second: b });
});
//# sourceMappingURL=syncGames.js.map
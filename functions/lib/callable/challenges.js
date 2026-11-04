"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelChallenge = exports.respondChallenge = exports.createChallenge = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const challengeMath_1 = require("../lib/challengeMath");
const challengeSettlement_1 = require("../lib/challengeSettlement");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
/**
 * Head-to-head challenges between two friends on one game.
 *
 * challenges/{creatorUid_idempotencyKey}
 *   gameId, sport, startsAt, home, away       fixture snapshot (team name/abbr/colour)
 *   mode "pot" | "odds", odds                 the challenger's price on their pick
 *   creatorUid, opponentUid, participants     participants drives the rules + listing
 *   creatorName, opponentName
 *   creatorSide                               the opponent has the other side
 *   creatorStake, opponentStake, pot          escrow amounts, fixed at creation
 *   message
 *   status  pending -> accepted -> settled
 *           pending -> declined | cancelled | expired
 *           accepted -> void (game never happened)
 *   outcome "creator" | "opponent" | "push", winnerUid, finalHomeScore, finalAwayScore
 *   createdAtMs, respondedAtMs, closedAtMs, settledAtMs
 *
 * Escrow: the challenger's stake leaves their balance the moment the
 * challenge is sent, and the friend's the moment they accept — both before
 * kickoff, both through the ledger. Neither can be spent elsewhere while the
 * game is on, and an accepted challenge can't be withdrawn by either side.
 */
const side = zod_1.z.enum(["home", "away"]);
const CreateInput = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
    opponentUid: zod_1.z.string().min(1),
    side,
    mode: zod_1.z.enum(["pot", "odds"]),
    stake: zod_1.z.number().int(),
    odds: zod_1.z.number().nullish(),
    message: zod_1.z.string().max(challengeMath_1.CHALLENGE_MAX_MESSAGE).nullish(),
    idempotencyKey: zod_1.z.string().min(8).max(64),
});
function parse(schema, data) {
    const r = schema.safeParse(data);
    if (!r.success)
        throw new https_1.HttpsError("invalid-argument", "Check the challenge details and try again.");
    return r.data;
}
function displayName(snap) {
    return (snap.get("displayName") || snap.get("username") || "A friend").trim();
}
function kickedOff(game, now) {
    const startsAt = game.get("startsAt") ?? 0;
    return !game.exists || game.get("status") !== "upcoming" || !startsAt || startsAt <= now;
}
exports.createChallenge = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = parse(CreateInput, req.data);
    if (input.opponentUid === uid)
        throw new https_1.HttpsError("invalid-argument", "Pick a friend to challenge.");
    const quote = (0, challengeMath_1.challengeTerms)(input.mode, input.stake, input.odds ?? undefined);
    if (!quote.ok)
        throw new https_1.HttpsError("invalid-argument", quote.reason);
    const terms = quote.terms;
    const id = `${uid}_${input.idempotencyKey}`;
    const ref = (0, challengeSettlement_1.CHALLENGES)().doc(id);
    const message = input.message?.trim() || null;
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, game, friendship, me, them] = await Promise.all([
            tx.get(ref),
            tx.get(economy_1.db.collection("games").doc(input.gameId)),
            tx.get(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(uid, input.opponentUid))),
            tx.get(economy_1.db.collection("users").doc(uid)),
            tx.get(economy_1.db.collection("users").doc(input.opponentUid)),
        ]);
        if (existing.exists)
            return { ok: true, challengeId: id, duplicate: true, balance: null };
        if (!friendship.exists)
            throw new https_1.HttpsError("permission-denied", "You can only challenge friends.");
        if (!them.exists)
            throw new https_1.HttpsError("not-found", "That player isn't around any more.");
        if (!game.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        if (kickedOff(game, Date.now()))
            throw new https_1.HttpsError("failed-precondition", "This game has already started.");
        const home = game.get("homeTeam");
        const away = game.get("awayTeam");
        const pick = input.side === "home" ? home : away;
        const other = input.side === "home" ? away : home;
        const creatorName = displayName(me);
        const opponentName = displayName(them);
        const now = Date.now();
        const balances = await (0, economy_1.applyCreditsMany)(tx, [
            {
                uid,
                delta: -terms.creatorStake,
                type: "challenge_escrow",
                idempotencyKey: `chesc_${id}_${uid}`,
                ref: id,
                note: `Challenge vs ${opponentName} · ${pick.abbreviation} vs ${other.abbreviation}`,
            },
        ]);
        tx.set(ref, {
            id,
            gameId: input.gameId,
            sport: game.get("sport") ?? null,
            startsAt: game.get("startsAt"),
            home: { name: home.name, abbreviation: home.abbreviation, color: home.color },
            away: { name: away.name, abbreviation: away.abbreviation, color: away.color },
            mode: terms.mode,
            odds: terms.odds,
            creatorUid: uid,
            opponentUid: input.opponentUid,
            participants: [uid, input.opponentUid],
            creatorName,
            opponentName,
            creatorSide: input.side,
            creatorStake: terms.creatorStake,
            opponentStake: terms.opponentStake,
            pot: terms.pot,
            message,
            status: "pending",
            outcome: null,
            winnerUid: null,
            finalHomeScore: null,
            finalAwayScore: null,
            createdAt: economy_1.FieldValue.serverTimestamp(),
            createdAtMs: now,
            respondedAtMs: null,
            closedAtMs: null,
            settledAtMs: null,
        });
        const offer = terms.mode === "pot"
            ? `${terms.opponentStake.toLocaleString("en-US")} each, winner takes ${terms.pot.toLocaleString("en-US")}`
            : `you'd put in ${terms.opponentStake.toLocaleString("en-US")} at ${(0, challengeMath_1.counterOdds)(terms).toFixed(2)}x for a ${terms.pot.toLocaleString("en-US")} pot`;
        (0, notify_1.writeNotification)(tx, input.opponentUid, (0, notifyModel_1.simpleNotification)({
            id: `chnew_${id}`,
            type: "challenge_received",
            title: `${creatorName} challenged you`,
            body: `${creatorName} has ${pick.abbreviation} over ${other.abbreviation} — you'd get ${other.abbreviation}. ${offer[0].toUpperCase()}${offer.slice(1)}.`,
            now,
            data: { challengeId: id, fromUid: uid },
        }));
        return { ok: true, challengeId: id, duplicate: false, balance: balances[uid] ?? null };
    });
});
const RespondInput = zod_1.z.object({ challengeId: zod_1.z.string().min(1), accept: zod_1.z.boolean() });
/**
 * The friend accepts (their stake goes into escrow) or declines (the
 * challenger's stake goes back). A challenge answered after kickoff expires
 * instead, refunding the challenger.
 */
exports.respondChallenge = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = parse(RespondInput, req.data);
    const ref = (0, challengeSettlement_1.CHALLENGES)().doc(input.challengeId);
    return economy_1.db.runTransaction(async (tx) => {
        const ch = await tx.get(ref);
        if (!ch.exists)
            throw new https_1.HttpsError("not-found", "Challenge not found.");
        if (ch.get("opponentUid") !== uid)
            throw new https_1.HttpsError("permission-denied", "This challenge isn't for you.");
        const status = ch.get("status");
        if (status === "accepted" && input.accept)
            return { ok: true, status: "accepted", balance: null };
        if (status !== "pending")
            throw new https_1.HttpsError("failed-precondition", `This challenge was already ${status}.`);
        const game = await tx.get(economy_1.db.collection("games").doc(ch.get("gameId")));
        const now = Date.now();
        if (kickedOff(game, now)) {
            await (0, challengeSettlement_1.releasePending)(tx, ch, "expired", now);
            return { ok: true, status: "expired", balance: null };
        }
        if (!input.accept) {
            await (0, challengeSettlement_1.releasePending)(tx, ch, "declined", now);
            return { ok: true, status: "declined", balance: null };
        }
        const stake = ch.get("opponentStake");
        const creator = ch.get("creatorUid");
        const creatorName = ch.get("creatorName") || "your friend";
        const opponentName = ch.get("opponentName") || "Your friend";
        let balances;
        try {
            balances = await (0, economy_1.applyCreditsMany)(tx, [
                {
                    uid,
                    delta: -stake,
                    type: "challenge_escrow",
                    idempotencyKey: `chesc_${ch.id}_${uid}`,
                    ref: ch.id,
                    note: `Challenge vs ${creatorName} · ${(0, challengeSettlement_1.gameLabel)(ch)}`,
                },
            ]);
        }
        catch (err) {
            if (err instanceof https_1.HttpsError && err.code === "failed-precondition") {
                throw new https_1.HttpsError("failed-precondition", `You need ${stake.toLocaleString("en-US")} credits to accept this one.`);
            }
            throw err;
        }
        tx.update(ref, { status: "accepted", respondedAtMs: now });
        (0, notify_1.writeNotification)(tx, creator, (0, notifyModel_1.simpleNotification)({
            id: `chacc_${ch.id}`,
            type: "challenge_accepted",
            title: `${opponentName} is in`,
            body: `${(0, challengeSettlement_1.gameLabel)(ch)} is on — ${ch.get("pot").toLocaleString("en-US")} credits locked in the pot.`,
            now,
            data: { challengeId: ch.id },
        }));
        return { ok: true, status: "accepted", balance: balances[uid] ?? null };
    });
});
/** The challenger withdraws an offer nobody has accepted yet. */
exports.cancelChallenge = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const challengeId = parse(zod_1.z.string().min(1), req.data?.challengeId);
    const ref = (0, challengeSettlement_1.CHALLENGES)().doc(challengeId);
    return economy_1.db.runTransaction(async (tx) => {
        const ch = await tx.get(ref);
        if (!ch.exists)
            throw new https_1.HttpsError("not-found", "Challenge not found.");
        if (ch.get("creatorUid") !== uid)
            throw new https_1.HttpsError("permission-denied", "Only the challenger can withdraw it.");
        const status = ch.get("status");
        if (status === "accepted") {
            throw new https_1.HttpsError("failed-precondition", "Your friend already accepted — the pot is locked until the game is final.");
        }
        if (status !== "pending")
            return { ok: true, status, balance: null };
        const balance = await (0, challengeSettlement_1.releasePending)(tx, ch, "cancelled", Date.now());
        return { ok: true, status: "cancelled", balance };
    });
});
//# sourceMappingURL=challenges.js.map
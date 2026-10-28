"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.peerLoanAction = exports.requestPeerLoan = exports.repayLoan = exports.takeBankLoan = exports.placeLeagueBet = exports.endLeague = exports.inviteToLeague = exports.updateLeagueSettings = exports.leaveLeague = exports.joinLeague = exports.createLeague = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const leagueConfig_1 = require("../lib/leagueConfig");
const loanMath_1 = require("../lib/loanMath");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const settlement_1 = require("../lib/settlement");
const leagueLifecycle_1 = require("../lib/leagueLifecycle");
/**
 * Leagues, behind the trusted boundary.
 *
 * Before this pass every league mutation was a client write: members set
 * their own `leagueTokens`, "approving" a peer loan minted tokens from
 * nowhere, bank interest only ever ran on the device (and compounded), and
 * there was no way to place a league bet at all. The rules now deny every
 * client write under leagues/*; these callables are the only way in.
 *
 * Data model
 *   leagues/{id}                    config, pot, members map, results
 *   leagues/{id}/leagueBets/{betId} league-wallet bets (settled by settleBets)
 *   leagues/{id}/loans/{loanId}     bank and peer loans, flat one-time interest
 *   leagues/{id}/activity/{id}      feed
 *   leagueInvites/{code}            code -> league lookup
 */
const leagueRef = (id) => economy_1.db.collection("leagues").doc(id);
const userRef = (uid) => economy_1.db.collection("users").doc(uid);
function member(league, uid) {
    const m = league.get(`members.${uid}`);
    return m ?? null;
}
function requireActiveLeague(league, now) {
    if (!league.exists)
        throw new https_1.HttpsError("not-found", "League not found.");
    if (league.get("status") !== "active")
        throw new https_1.HttpsError("failed-precondition", "That league has ended.");
    const endsAt = league.get("endsAt");
    if (endsAt && now >= endsAt)
        throw new https_1.HttpsError("failed-precondition", "That league's season is over.");
}
function requireMember(league, uid) {
    const m = member(league, uid);
    if (!m)
        throw new https_1.HttpsError("permission-denied", "You're not in this league.");
    return m;
}
function termsOf(d) {
    return {
        principal: d.get("principal"),
        principalOutstanding: d.get("principalOutstanding"),
        interestAccrued: d.get("interestAccrued") ?? 0,
        interestPaid: d.get("interestPaid") ?? 0,
        accruedThrough: d.get("accruedThrough"),
        ratePct: d.get("ratePct"),
        intervalHours: d.get("intervalHours"),
    };
}
function loanOf(d) {
    return {
        ...termsOf(d),
        kind: d.get("kind"),
        status: d.get("status"),
        borrowerId: d.get("borrowerId"),
        lenderId: d.get("lenderId") ?? null,
    };
}
function activity(tx, leagueId, id, entry) {
    tx.set(leagueRef(leagueId).collection("activity").doc(id), { amount: 0, ...entry, at: Date.now() });
}
async function profileName(tx, uid) {
    const p = await tx.get(userRef(uid));
    if (!p.exists)
        throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
    return p.get("displayName") || p.get("username") || "Player";
}
const Key = zod_1.z.string().min(8).max(64);
const Money = (min, max) => zod_1.z.number().int().min(min).max(max);
// ---------------------------------------------------------------------------
// Create / join / leave
// ---------------------------------------------------------------------------
const CreateInput = zod_1.z.object({
    idempotencyKey: Key,
    name: zod_1.z.string().trim().min(1).max(40),
    startingLeagueTokens: zod_1.z.number().int().refine((n) => leagueConfig_1.TOKEN_START_OPTIONS.includes(n)),
    duration: zod_1.z.enum(Object.keys(leagueConfig_1.DURATIONS)),
    sports: zod_1.z.array(zod_1.z.enum(leagueConfig_1.SPORTS)).min(1).max(leagueConfig_1.SPORTS.length),
    buyIn: zod_1.z.number().int().refine((n) => leagueConfig_1.BUY_IN_OPTIONS.includes(n)),
    prizePreset: zod_1.z.enum(["winner-all", "top-2", "top-3"]),
    bankLoanEnabled: zod_1.z.boolean(),
    bankInterestRate: zod_1.z.number().min(leagueConfig_1.BANK_RATE_MIN).max(leagueConfig_1.BANK_RATE_MAX),
    bankInterestIntervalHours: zod_1.z.number().int().min(leagueConfig_1.BANK_INTERVAL_MIN_H).max(leagueConfig_1.BANK_INTERVAL_MAX_H).default(24),
});
exports.createLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = CreateInput.parse(req.data);
    const leagueId = `lg_${uid.slice(0, 8)}_${input.idempotencyKey}`;
    const ref = leagueRef(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
            return { ok: true, leagueId, code: existing.get("code"), duplicate: true };
        }
        const name = await profileName(tx, uid);
        // Find an unused code. Reads all happen before any write.
        let code = null;
        for (let i = 0; i < 6 && !code; i++) {
            const candidate = (0, leagueConfig_1.randomCode)();
            const snap = await tx.get(economy_1.db.collection("leagueInvites").doc(candidate));
            if (!snap.exists)
                code = candidate;
        }
        if (!code)
            throw new https_1.HttpsError("unavailable", "Couldn't allocate an invite code. Try again.");
        if (input.buyIn > 0) {
            await (0, economy_1.applyCredits)(tx, uid, {
                delta: -input.buyIn,
                type: "league_buy_in",
                idempotencyKey: `league_buyin_${leagueId}_${uid}`,
                ref: leagueId,
                note: input.name,
            });
        }
        const now = Date.now();
        const shares = leagueConfig_1.PRIZE_PRESETS[input.prizePreset];
        const me = {
            uid,
            displayName: name,
            avatarColor: leagueConfig_1.MEMBER_COLORS[0],
            leagueTokens: input.startingLeagueTokens,
            startingLeagueTokens: input.startingLeagueTokens,
            joinedAt: now,
            betsWon: 0,
            betsLost: 0,
            betsPush: 0,
        };
        tx.set(ref, {
            schemaVersion: 2,
            id: leagueId,
            name: input.name,
            code,
            createdAt: now,
            endsAt: now + leagueConfig_1.DURATIONS[input.duration] * 86_400_000,
            status: "active",
            creatorId: uid,
            startingLeagueTokens: input.startingLeagueTokens,
            buyIn: input.buyIn,
            pot: input.buyIn,
            prizeDistribution: { preset: input.prizePreset, ...shares },
            allowedSports: input.sports,
            bankLoanEnabled: input.bankLoanEnabled,
            bankInterestRate: input.bankInterestRate,
            bankInterestIntervalHours: input.bankInterestIntervalHours,
            memberIds: [uid],
            formerMemberIds: [],
            members: { [uid]: me },
            lastActivityAt: now,
            payoutStatus: "none",
        });
        tx.set(economy_1.db.collection("leagueInvites").doc(code), {
            code,
            leagueId,
            leagueName: input.name,
            buyIn: input.buyIn,
            creatorId: uid,
            createdAt: now,
        });
        activity(tx, leagueId, "created", { type: "created", uid, name, text: `${name} started the league` });
        return { ok: true, leagueId, code, duplicate: false };
    });
});
exports.joinLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const code = zod_1.z.string().trim().toUpperCase().min(4).max(8).parse(req.data?.code);
    return economy_1.db.runTransaction(async (tx) => {
        const invite = await tx.get(economy_1.db.collection("leagueInvites").doc(code));
        if (!invite.exists)
            throw new https_1.HttpsError("not-found", "No league with that code. Check it and try again.");
        const leagueId = invite.get("leagueId");
        const league = await tx.get(leagueRef(leagueId));
        const now = Date.now();
        if (member(league, uid))
            return { ok: true, leagueId, duplicate: true };
        requireActiveLeague(league, now);
        const former = league.get("formerMemberIds") ?? [];
        if (former.includes(uid)) {
            throw new https_1.HttpsError("failed-precondition", "You left this league, so you can't rejoin it.");
        }
        const memberIds = league.get("memberIds") ?? [];
        if (memberIds.length >= leagueConfig_1.MAX_MEMBERS)
            throw new https_1.HttpsError("resource-exhausted", "That league is full.");
        const name = await profileName(tx, uid);
        const buyIn = league.get("buyIn") ?? 0;
        if (buyIn > 0) {
            await (0, economy_1.applyCredits)(tx, uid, {
                delta: -buyIn,
                type: "league_buy_in",
                idempotencyKey: `league_buyin_${leagueId}_${uid}`,
                ref: leagueId,
                note: league.get("name"),
            });
        }
        const used = new Set(Object.values(league.get("members") ?? {}).map((m) => m.avatarColor));
        const color = leagueConfig_1.MEMBER_COLORS.find((c) => !used.has(c)) ?? leagueConfig_1.MEMBER_COLORS[memberIds.length % leagueConfig_1.MEMBER_COLORS.length];
        const start = league.get("startingLeagueTokens");
        tx.update(leagueRef(leagueId), {
            [`members.${uid}`]: {
                uid,
                displayName: name,
                avatarColor: color,
                leagueTokens: start,
                startingLeagueTokens: start,
                joinedAt: now,
                betsWon: 0,
                betsLost: 0,
                betsPush: 0,
            },
            memberIds: economy_1.FieldValue.arrayUnion(uid),
            pot: economy_1.FieldValue.increment(buyIn),
            lastActivityAt: now,
        });
        activity(tx, leagueId, `join_${uid}`, { type: "joined", uid, name, text: `${name} joined` });
        return { ok: true, leagueId, duplicate: false };
    });
});
exports.leaveLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const leagueId = zod_1.z.string().min(1).parse(req.data?.leagueId);
    const ref = leagueRef(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        // Closed leagues are read-only: membership is frozen with the final standings.
        requireActiveLeague(league, Date.now());
        const me = requireMember(league, uid);
        const [loans, bets] = await Promise.all([
            tx.get(ref.collection("loans").where("status", "in", ["active", "requested", "countered"])),
            tx.get(ref.collection("leagueBets").where("uid", "==", uid).where("status", "==", "pending")),
        ]);
        const active = league.get("status") === "active";
        if (active) {
            const tied = loans.docs.filter((d) => d.get("status") === "active" && (d.get("borrowerId") === uid || d.get("lenderId") === uid));
            if (tied.length) {
                throw new https_1.HttpsError("failed-precondition", "Settle your loans before leaving — repay what you owe and collect what you're owed.");
            }
            if (!bets.empty) {
                throw new https_1.HttpsError("failed-precondition", "You have open league bets. Wait for them to settle first.");
            }
        }
        const memberIds = (league.get("memberIds") ?? []).filter((m) => m !== uid);
        if (active && memberIds.length === 0 && (league.get("pot") ?? 0) > 0) {
            throw new https_1.HttpsError("failed-precondition", "You're the last member and there's a pot — end the league instead so it pays out.");
        }
        // Open requests made by the leaver can't be funded any more.
        for (const d of loans.docs) {
            if (d.get("borrowerId") === uid && d.get("status") !== "active") {
                tx.update(d.ref, { status: "cancelled", updatedAt: Date.now() });
            }
        }
        const update = {
            [`members.${uid}`]: economy_1.FieldValue.delete(),
            memberIds: economy_1.FieldValue.arrayRemove(uid),
            formerMemberIds: economy_1.FieldValue.arrayUnion(uid),
            lastActivityAt: Date.now(),
        };
        if (league.get("creatorId") === uid && memberIds.length > 0) {
            const members = league.get("members") ?? {};
            const heir = memberIds
                .map((id) => members[id])
                .filter((m) => !!m)
                .sort((a, b) => a.joinedAt - b.joinedAt)[0];
            if (heir)
                update.creatorId = heir.uid;
        }
        if (memberIds.length === 0)
            update.status = "ended";
        tx.update(ref, update);
        activity(tx, leagueId, `leave_${uid}_${Date.now()}`, { type: "left", uid, name: me.displayName, text: `${me.displayName} left` });
        return { ok: true };
    });
});
// ---------------------------------------------------------------------------
// Settings, invites, ending
// ---------------------------------------------------------------------------
exports.updateLeagueSettings = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        bankLoanEnabled: zod_1.z.boolean(),
        bankInterestRate: zod_1.z.number().min(leagueConfig_1.BANK_RATE_MIN).max(leagueConfig_1.BANK_RATE_MAX),
        bankInterestIntervalHours: zod_1.z.number().int().min(leagueConfig_1.BANK_INTERVAL_MIN_H).max(leagueConfig_1.BANK_INTERVAL_MAX_H).default(24),
    })
        .parse(req.data);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(leagueRef(input.leagueId));
        requireActiveLeague(league, Date.now());
        if (league.get("creatorId") !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only the league creator can change the bank.");
        }
        // New terms apply to new loans. Existing loans keep the rate they were
        // taken at — a creator can't reprice everyone else's debt mid-season.
        tx.update(leagueRef(input.leagueId), {
            bankLoanEnabled: input.bankLoanEnabled,
            bankInterestRate: input.bankInterestRate,
            bankInterestIntervalHours: input.bankInterestIntervalHours,
        });
        const me = requireMember(league, uid);
        activity(tx, input.leagueId, `bank_${Date.now()}`, {
            type: "settings",
            uid,
            name: me.displayName,
            text: input.bankLoanEnabled
                ? `Bank terms: ${input.bankInterestRate}% flat on new loans`
                : "The bank is closed to new loans",
        });
        return { ok: true };
    });
});
exports.inviteToLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const { leagueId, friendUid } = zod_1.z
        .object({ leagueId: zod_1.z.string().min(1), friendUid: zod_1.z.string().min(1) })
        .parse(req.data);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, friendship] = await Promise.all([
            tx.get(leagueRef(leagueId)),
            tx.get(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(uid, friendUid))),
        ]);
        requireActiveLeague(league, Date.now());
        const me = requireMember(league, uid);
        if (!friendship.exists)
            throw new https_1.HttpsError("permission-denied", "You can only invite friends.");
        if (member(league, friendUid))
            return { ok: true, status: "already_member" };
        const name = league.get("name");
        (0, notify_1.writeNotification)(tx, friendUid, (0, notifyModel_1.simpleNotification)({
            id: `invite_${leagueId}_${uid}`,
            type: "league_invite",
            title: `${me.displayName} invited you to ${name}`,
            body: league.get("buyIn") > 0
                ? `Buy-in ${league.get("buyIn").toLocaleString("en-US")} credits. Code ${league.get("code")}.`
                : `Free to join. Code ${league.get("code")}.`,
            now: Date.now(),
            leagueId,
            leagueName: name,
            // Surfaced as an in-app banner (InviteToastHost), not only a feed row.
            popup: true,
            data: { code: league.get("code"), leagueId, fromUid: uid },
        }));
        return { ok: true, status: "sent" };
    });
});
exports.endLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const leagueId = zod_1.z.string().min(1).parse(req.data?.leagueId);
    const snap = await leagueRef(leagueId).get();
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", "League not found.");
    requireMember(snap, uid);
    const expired = Date.now() >= (snap.get("endsAt") ?? 0);
    if (snap.get("creatorId") !== uid && !expired) {
        throw new https_1.HttpsError("permission-denied", "Only the creator can end the league early.");
    }
    const results = await (0, leagueLifecycle_1.finalizeLeague)(leagueId, Date.now());
    await (0, leagueLifecycle_1.payoutLeague)(leagueId);
    return { ok: true, results };
});
// ---------------------------------------------------------------------------
// League bets
// ---------------------------------------------------------------------------
const LeagueBetInput = zod_1.z.object({
    leagueId: zod_1.z.string().min(1),
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]),
    stake: Money(leagueConfig_1.MIN_LEAGUE_STAKE, 10_000_000),
    idempotencyKey: Key,
    expectedOdds: zod_1.z.number().positive().max(100).optional(),
});
exports.placeLeagueBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = LeagueBetInput.parse(req.data);
    const ref = leagueRef(input.leagueId);
    const betId = `${uid}_${input.idempotencyKey}`;
    const betRef = ref.collection("leagueBets").doc(betId);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, league, game] = await Promise.all([
            tx.get(betRef),
            tx.get(ref),
            tx.get(economy_1.db.collection("games").doc(input.gameId)),
        ]);
        if (existing.exists)
            return { ok: true, betId, duplicate: true, leagueTokens: null };
        const now = Date.now();
        requireActiveLeague(league, now);
        const me = requireMember(league, uid);
        if (!game.exists)
            throw new https_1.HttpsError("not-found", "That game is no longer available.");
        if (game.get("status") !== "upcoming")
            throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
        const startsAt = game.get("startsAt") ?? 0;
        if (startsAt && startsAt < now)
            throw new https_1.HttpsError("failed-precondition", "This game has already started.");
        if (startsAt && startsAt >= league.get("endsAt")) {
            throw new https_1.HttpsError("failed-precondition", "That game starts after this league's season ends.");
        }
        const allowed = league.get("allowedSports") ?? [];
        if (!allowed.includes(game.get("sport"))) {
            throw new https_1.HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
        }
        if (input.stake > me.leagueTokens)
            throw new https_1.HttpsError("failed-precondition", "Not enough league tokens.");
        const team = game.get(input.side === "home" ? "homeTeam" : "awayTeam");
        const opp = game.get(input.side === "home" ? "awayTeam" : "homeTeam");
        if (input.expectedOdds && team.odds < input.expectedOdds * 0.95) {
            throw new https_1.HttpsError("aborted", `The price moved to ${team.odds.toFixed(2)}x. Tap again to take it.`);
        }
        const potentialPayout = (0, settlement_1.payoutFor)(input.stake, team.odds);
        tx.set(betRef, {
            id: betId,
            leagueId: input.leagueId,
            uid,
            displayName: me.displayName,
            gameId: input.gameId,
            sport: game.get("sport"),
            side: input.side,
            teamName: team.name,
            teamAbbr: team.abbreviation,
            teamColor: team.color,
            opponentAbbr: opp.abbreviation,
            stake: input.stake,
            odds: team.odds,
            potentialPayout,
            status: "pending",
            placedAt: now,
            settledAt: null,
        });
        tx.update(ref, {
            [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
            lastActivityAt: now,
        });
        activity(tx, input.leagueId, `bet_${betId}`, {
            type: "bet_placed",
            uid,
            name: me.displayName,
            amount: input.stake,
            text: `${me.displayName} put ${input.stake.toLocaleString("en-US")} on ${team.abbreviation} (${team.odds.toFixed(2)}x)`,
        });
        return { ok: true, betId, duplicate: false, leagueTokens: me.leagueTokens - input.stake };
    });
});
// ---------------------------------------------------------------------------
// Bank loans
// ---------------------------------------------------------------------------
exports.takeBankLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({ leagueId: zod_1.z.string().min(1), amount: Money(10, 10_000_000), idempotencyKey: Key })
        .parse(req.data);
    const ref = leagueRef(input.leagueId);
    const loanRef = ref.collection("loans").doc(`bank_${uid}_${input.idempotencyKey}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, league, mine] = await Promise.all([
            tx.get(loanRef),
            tx.get(ref),
            tx.get(ref.collection("loans").where("borrowerId", "==", uid).where("status", "==", "active")),
        ]);
        if (existing.exists)
            return { ok: true, loanId: loanRef.id, duplicate: true };
        const now = Date.now();
        requireActiveLeague(league, now);
        const me = requireMember(league, uid);
        if (!league.get("bankLoanEnabled"))
            throw new https_1.HttpsError("failed-precondition", "The league bank is closed.");
        const cap = Math.floor(league.get("startingLeagueTokens") * leagueConfig_1.BANK_PRINCIPAL_CAP_MULTIPLIER);
        const outstanding = mine.docs
            .filter((d) => d.get("kind") === "bank")
            .reduce((s, d) => s + (d.get("principalOutstanding") ?? 0), 0);
        if (outstanding + input.amount > cap) {
            throw new https_1.HttpsError("failed-precondition", `The bank lends up to ${cap.toLocaleString("en-US")} in principal. You can borrow ${Math.max(0, cap - outstanding).toLocaleString("en-US")} more.`);
        }
        const rate = league.get("bankInterestRate");
        const interval = league.get("bankInterestIntervalHours");
        tx.set(loanRef, {
            id: loanRef.id,
            leagueId: input.leagueId,
            kind: "bank",
            borrowerId: uid,
            borrowerName: me.displayName,
            lenderId: null,
            lenderName: "League Bank",
            status: "active",
            ...(0, loanMath_1.newLoanTerms)(input.amount, rate, interval, now),
            createdAt: now,
            fundedAt: now,
            updatedAt: now,
        });
        tx.update(ref, { [`members.${uid}.leagueTokens`]: me.leagueTokens + input.amount, lastActivityAt: now });
        activity(tx, input.leagueId, `loan_${loanRef.id}`, {
            type: "bank_loan",
            uid,
            name: me.displayName,
            amount: input.amount,
            text: `${me.displayName} borrowed ${input.amount.toLocaleString("en-US")} from the bank at ${rate}% flat`,
        });
        return { ok: true, loanId: loanRef.id, duplicate: false };
    });
});
/** Repays a bank or peer loan the caller owes. Interest first, then principal. */
exports.repayLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        loanId: zod_1.z.string().min(1),
        amount: Money(1, 100_000_000),
        idempotencyKey: Key,
    })
        .parse(req.data);
    const ref = leagueRef(input.leagueId);
    const loanRef = ref.collection("loans").doc(input.loanId);
    const receiptRef = ref.collection("activity").doc(`repay_${input.loanId}_${input.idempotencyKey}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [receipt, league, loan] = await Promise.all([tx.get(receiptRef), tx.get(ref), tx.get(loanRef)]);
        if (receipt.exists)
            return { ok: true, duplicate: true, applied: receipt.get("amount") };
        const wall = Date.now();
        requireActiveLeague(league, wall);
        const me = requireMember(league, uid);
        if (!loan.exists)
            throw new https_1.HttpsError("not-found", "Loan not found.");
        if (loan.get("borrowerId") !== uid)
            throw new https_1.HttpsError("permission-denied", "That isn't your loan.");
        if (loan.get("status") !== "active")
            throw new https_1.HttpsError("failed-precondition", "That loan is already settled.");
        const now = Math.min(wall, league.get("endsAt"));
        const pay = Math.min(input.amount, me.leagueTokens);
        if (pay <= 0)
            throw new https_1.HttpsError("failed-precondition", "You have no league tokens to repay with.");
        const res = (0, loanMath_1.applyRepayment)(termsOf(loan), pay, now);
        if (res.applied <= 0)
            throw new https_1.HttpsError("failed-precondition", "Nothing is owed on that loan.");
        const lenderId = loan.get("lenderId");
        const lender = lenderId ? member(league, lenderId) : null;
        tx.update(loanRef, {
            principalOutstanding: res.loan.principalOutstanding,
            interestAccrued: res.loan.interestAccrued,
            interestPaid: res.loan.interestPaid,
            accruedThrough: res.loan.accruedThrough,
            status: res.settled ? "repaid" : "active",
            repaidAt: res.settled ? wall : null,
            updatedAt: wall,
        });
        const update = {
            [`members.${uid}.leagueTokens`]: me.leagueTokens - res.applied,
            lastActivityAt: wall,
        };
        if (lender)
            update[`members.${lenderId}.leagueTokens`] = economy_1.FieldValue.increment(res.applied);
        tx.update(ref, update);
        tx.set(receiptRef, {
            type: "repayment",
            uid,
            name: me.displayName,
            amount: res.applied,
            toInterest: res.toInterest,
            toPrincipal: res.toPrincipal,
            loanId: input.loanId,
            text: `${me.displayName} repaid ${res.applied.toLocaleString("en-US")} to ${lender ? lender.displayName : "the bank"}${res.settled ? " — paid off" : ""}`,
            at: wall,
        });
        if (lender && lenderId) {
            (0, notify_1.writeNotification)(tx, lenderId, (0, notifyModel_1.simpleNotification)({
                id: `repay_${input.loanId}_${input.idempotencyKey}`,
                type: "loan_repaid",
                title: `${me.displayName} paid you back`,
                body: `+${res.applied.toLocaleString("en-US")} league tokens in ${league.get("name")}${res.settled ? ". Loan closed." : "."}`,
                delta: res.applied,
                balanceAfter: lender.leagueTokens + res.applied,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName: league.get("name"),
                now: wall,
            }));
        }
        return {
            ok: true,
            duplicate: false,
            applied: res.applied,
            toInterest: res.toInterest,
            toPrincipal: res.toPrincipal,
            settled: res.settled,
            remaining: (0, loanMath_1.loanSnapshot)(res.loan, now).totalOwed,
        };
    });
});
// ---------------------------------------------------------------------------
// Peer loans
// ---------------------------------------------------------------------------
exports.requestPeerLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        amount: Money(10, 10_000_000),
        rate: zod_1.z.number().gt(0).max(leagueConfig_1.PEER_RATE_MAX),
        message: zod_1.z.string().trim().max(80).optional(),
        idempotencyKey: Key,
    })
        .parse(req.data);
    if (!(0, leagueConfig_1.peerLoanRequestsEnabled)())
        throw new https_1.HttpsError("failed-precondition", "Loan requests are closed.");
    const ref = leagueRef(input.leagueId);
    const loanRef = ref.collection("loans").doc(`peer_${uid}_${input.idempotencyKey}`);
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, league, open] = await Promise.all([
            tx.get(loanRef),
            tx.get(ref),
            tx.get(ref.collection("loans").where("borrowerId", "==", uid).where("status", "in", ["requested", "countered"])),
        ]);
        if (existing.exists)
            return { ok: true, loanId: loanRef.id, duplicate: true };
        const now = Date.now();
        requireActiveLeague(league, now);
        const me = requireMember(league, uid);
        const max = Math.floor(league.get("startingLeagueTokens") * leagueConfig_1.PEER_LOAN_MAX_PCT);
        if (input.amount > max) {
            throw new https_1.HttpsError("failed-precondition", `Peer loans are capped at ${max.toLocaleString("en-US")}.`);
        }
        if (open.size >= leagueConfig_1.MAX_OPEN_REQUESTS) {
            throw new https_1.HttpsError("resource-exhausted", "You already have three open requests.");
        }
        if ((league.get("memberIds") ?? []).length < 2) {
            throw new https_1.HttpsError("failed-precondition", "Invite someone first — there's nobody to lend to you yet.");
        }
        const rate = Math.round(input.rate * 100) / 100;
        tx.set(loanRef, {
            id: loanRef.id,
            leagueId: input.leagueId,
            kind: "peer",
            borrowerId: uid,
            borrowerName: me.displayName,
            lenderId: null,
            lenderName: null,
            status: "requested",
            proposedRate: rate,
            counterRate: null,
            counterBy: null,
            counterByName: null,
            declinedBy: [],
            message: input.message ?? null,
            // Terms are provisional until funded; accrual starts at funding.
            ...(0, loanMath_1.newLoanTerms)(input.amount, rate, league.get("bankInterestIntervalHours"), now),
            createdAt: now,
            updatedAt: now,
        });
        activity(tx, input.leagueId, `req_${loanRef.id}`, {
            type: "loan_request",
            uid,
            name: me.displayName,
            amount: input.amount,
            text: `${me.displayName} is asking for ${input.amount.toLocaleString("en-US")} at ${rate}%`,
        });
        for (const other of league.get("memberIds").filter((m) => m !== uid)) {
            (0, notify_1.writeNotification)(tx, other, (0, notifyModel_1.simpleNotification)({
                id: `loanreq_${loanRef.id}`,
                type: "loan_request",
                title: `${me.displayName} wants a loan`,
                body: `${input.amount.toLocaleString("en-US")} league tokens at ${rate}% flat (repays ${(0, loanMath_1.totalRepayable)(input.amount, rate).toLocaleString("en-US")}) in ${league.get("name")}.`,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName: league.get("name"),
                now,
            }));
        }
        return { ok: true, loanId: loanRef.id, duplicate: false };
    });
});
const PeerAction = zod_1.z.object({
    leagueId: zod_1.z.string().min(1),
    loanId: zod_1.z.string().min(1),
    action: zod_1.z.enum(["fund", "counter", "decline", "cancel", "accept_counter", "reject_counter"]),
    rate: zod_1.z.number().gt(0).max(leagueConfig_1.PEER_RATE_MAX).optional(),
});
exports.peerLoanAction = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = PeerAction.parse(req.data);
    const ref = leagueRef(input.leagueId);
    const loanRef = ref.collection("loans").doc(input.loanId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, loan] = await Promise.all([tx.get(ref), tx.get(loanRef)]);
        const now = Date.now();
        requireActiveLeague(league, now);
        const me = requireMember(league, uid);
        if (!loan.exists || loan.get("kind") !== "peer")
            throw new https_1.HttpsError("not-found", "Loan request not found.");
        const status = loan.get("status");
        const borrowerId = loan.get("borrowerId");
        const borrower = member(league, borrowerId);
        const amount = loan.get("principal");
        const leagueName = league.get("name");
        const interval = loan.get("intervalHours");
        const isBorrower = uid === borrowerId;
        const fund = (lenderId, rate) => {
            const lender = member(league, lenderId);
            if (!lender)
                throw new https_1.HttpsError("failed-precondition", "The lender has left the league.");
            if (!borrower)
                throw new https_1.HttpsError("failed-precondition", "The borrower has left the league.");
            if (lender.leagueTokens < amount) {
                throw new https_1.HttpsError("failed-precondition", `${lenderId === uid ? "You don't" : `${lender.displayName} doesn't`} have ${amount.toLocaleString("en-US")} league tokens to lend.`);
            }
            tx.update(loanRef, {
                status: "active",
                lenderId,
                lenderName: lender.displayName,
                ...(0, loanMath_1.newLoanTerms)(amount, rate, interval, now),
                fundedAt: now,
                updatedAt: now,
            });
            tx.update(ref, {
                [`members.${lenderId}.leagueTokens`]: lender.leagueTokens - amount,
                [`members.${borrowerId}.leagueTokens`]: borrower.leagueTokens + amount,
                lastActivityAt: now,
            });
            activity(tx, input.leagueId, `fund_${loanRef.id}`, {
                type: "loan_funded",
                uid: lenderId,
                name: lender.displayName,
                amount,
                text: `${lender.displayName} lent ${borrower.displayName} ${amount.toLocaleString("en-US")} at ${rate}%`,
            });
            const target = lenderId === uid ? borrowerId : lenderId;
            (0, notify_1.writeNotification)(tx, target, (0, notifyModel_1.simpleNotification)({
                id: `funded_${loanRef.id}`,
                type: "loan_funded",
                title: lenderId === uid ? `${lender.displayName} funded your loan` : `${borrower.displayName} took your offer`,
                body: `${amount.toLocaleString("en-US")} league tokens at ${rate}% flat. Repays ${(0, loanMath_1.totalRepayable)(amount, rate).toLocaleString("en-US")} in total.`,
                delta: lenderId === uid ? amount : -amount,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName,
                now,
                popup: lenderId === uid,
            }));
        };
        switch (input.action) {
            case "fund": {
                if (isBorrower)
                    throw new https_1.HttpsError("invalid-argument", "You can't fund your own request.");
                if (status !== "requested")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                fund(uid, loan.get("proposedRate"));
                break;
            }
            case "counter": {
                if (isBorrower)
                    throw new https_1.HttpsError("invalid-argument", "You can't counter your own request.");
                if (status !== "requested")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                if (!input.rate)
                    throw new https_1.HttpsError("invalid-argument", "Counter with a rate.");
                const rate = Math.round(input.rate * 100) / 100;
                tx.update(loanRef, { status: "countered", counterRate: rate, counterBy: uid, counterByName: me.displayName, updatedAt: now });
                (0, notify_1.writeNotification)(tx, borrowerId, (0, notifyModel_1.simpleNotification)({
                    id: `counter_${loanRef.id}_${uid}`,
                    type: "loan_countered",
                    title: `${me.displayName} countered at ${rate}%`,
                    body: `For your ${amount.toLocaleString("en-US")} request in ${leagueName}. Accept or reject it in the league.`,
                    wallet: "league",
                    leagueId: input.leagueId,
                    leagueName,
                    now,
                }));
                break;
            }
            case "decline": {
                if (isBorrower)
                    throw new https_1.HttpsError("invalid-argument", "Cancel your own request instead.");
                if (status !== "requested")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                const declined = new Set([...(loan.get("declinedBy") ?? []), uid]);
                const others = (league.get("memberIds") ?? []).filter((m) => m !== borrowerId);
                const everyone = others.every((m) => declined.has(m));
                tx.update(loanRef, {
                    declinedBy: [...declined],
                    status: everyone ? "rejected" : "requested",
                    updatedAt: now,
                });
                break;
            }
            case "cancel": {
                if (!isBorrower)
                    throw new https_1.HttpsError("permission-denied", "Only the borrower can cancel.");
                if (status !== "requested" && status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "That request can't be cancelled.");
                tx.update(loanRef, { status: "cancelled", updatedAt: now });
                break;
            }
            case "accept_counter": {
                if (!isBorrower)
                    throw new https_1.HttpsError("permission-denied", "Only the borrower can accept.");
                if (status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "There's no counter-offer to accept.");
                fund(loan.get("counterBy"), loan.get("counterRate"));
                break;
            }
            case "reject_counter": {
                if (!isBorrower)
                    throw new https_1.HttpsError("permission-denied", "Only the borrower can reject.");
                if (status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "There's no counter-offer to reject.");
                // Back on the market at the original rate for everyone else.
                tx.update(loanRef, {
                    status: "requested",
                    counterRate: null,
                    counterBy: null,
                    counterByName: null,
                    declinedBy: economy_1.FieldValue.arrayUnion(loan.get("counterBy")),
                    updatedAt: now,
                });
                break;
            }
        }
        return { ok: true };
    });
});
//# sourceMappingURL=leagues.js.map
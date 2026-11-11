"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestReset = exports.RESET_SHARE = exports.leagueStimulus = exports.peerLoanAction = exports.requestPeerLoan = exports.repayLoan = exports.takeBankLoan = exports.LOAN_COOLDOWN_MS = exports.placeLeagueBet = exports.voidLeagueBet = exports.reportResult = exports.endLeague = exports.voteEndLeague = exports.inviteToLeague = exports.updateLeagueSettings = exports.leaveLeague = exports.joinLeague = exports.createLeague = void 0;
exports.loanOf = loanOf;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const leagueConfig_1 = require("../lib/leagueConfig");
const loanMath_1 = require("../lib/loanMath");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const settlement_1 = require("../lib/settlement");
const pricing_1 = require("../lib/pricing");
const leagueLifecycle_1 = require("../lib/leagueLifecycle");
const streak_1 = require("../lib/streak");
const streakDays_1 = require("../lib/streakDays");
const playLimits_1 = require("../lib/playLimits");
const weekly_1 = require("../lib/weekly");
/**
 * Leagues, behind the trusted boundary.
 *
 * Data model
 *   leagues/{id}                    config, pot, members map, results
 *   leagues/{id}/leagueBets/{betId} league-wallet bets (settled by settleBets)
 *   leagues/{id}/loans/{loanId}     bank and peer loans, flat one-time interest
 *   leagues/{id}/activity/{id}      feed
 *   leagues/{id}/messages/{id}      chat messages + bet cards + system rows
 *   leagues/{id}/gameSides/{gameId} per-game sweat aggregate
 *   leagues/{id}/audit/{id}         immutable commissioner audit log
 *   leagues/{id}/rivalries/{pairId} head-to-head rivalry records
 *   leagues/{id}/reports/{week}     Tuesday League Report story cards
 *   leagues/{id}/matchups/{week}    weekly head-to-head pairings
 *   leagues/{id}/picks/{pickId}     pick'em and survivor picks
 *   leagues/{id}/parlays/{parlayId} group parlays
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
/** Betting, loans, stimulus and resets open when the league starts. */
function requireStarted(league, now) {
    if (!(0, leagueConfig_1.leagueStarted)(league, now)) {
        if ((league.get("memberIds")?.length ?? 0) < leagueConfig_1.MIN_LEAGUE_PLAYERS) {
            throw new https_1.HttpsError("failed-precondition", "A league needs at least 2 players. Invite a friend — it starts as soon as they join.");
        }
        const at = new Date((0, leagueConfig_1.leagueStartsAt)(league)).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        throw new https_1.HttpsError("failed-precondition", `This league starts ${at} ET. Betting opens then.`);
    }
}
/** Full Season covers one sport's season. */
function requireOneSportForSeason(duration, sports) {
    if (duration === leagueConfig_1.FULL_SEASON && sports.length !== 1) {
        throw new https_1.HttpsError("invalid-argument", "A full-season league covers one sport. Pick a single sport.");
    }
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
    tx.set(leagueRef(leagueId).collection("activity").doc(id), {
        amount: 0,
        reactions: {},
        reactors: {},
        ...entry,
        at: Date.now(),
    });
}
function writeAudit(tx, leagueId, id, entry) {
    tx.set(leagueRef(leagueId).collection("audit").doc(id), {
        before: null,
        after: null,
        reason: null,
        betId: null,
        ...entry,
        at: entry.at ?? Date.now(),
    });
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
    duration: zod_1.z.enum(leagueConfig_1.DURATION_KEYS),
    sports: zod_1.z.array(zod_1.z.enum(leagueConfig_1.SPORTS)).min(1).max(leagueConfig_1.SPORTS.length),
    buyIn: zod_1.z.number().int().refine((n) => leagueConfig_1.BUY_IN_OPTIONS.includes(n)),
    prizePreset: zod_1.z.enum(["winner-all", "top-2", "top-3"]),
    bankLoanEnabled: zod_1.z.boolean(),
    bankInterestRate: zod_1.z.number().min(leagueConfig_1.BANK_RATE_MIN).max(leagueConfig_1.BANK_RATE_MAX),
    bankInterestIntervalHours: zod_1.z.number().int().min(leagueConfig_1.BANK_INTERVAL_MIN_H).max(leagueConfig_1.BANK_INTERVAL_MAX_H).default(24),
    mode: zod_1.z.enum(leagueConfig_1.LEAGUE_MODES).default("bankroll"),
    /** Bracket mode: bracketTemplates/{id} (live-ops content). */
    bracketTemplateId: zod_1.z.string().min(1).max(64).optional(),
    matchupsEnabled: zod_1.z.boolean().default(false),
    matchupCadence: zod_1.z.enum(leagueConfig_1.MATCHUP_CADENCES).default("weekly"),
    stimulusEnabled: zod_1.z.boolean().default(false),
    /** Start immediately (default, and for older clients) or at `startsAt`. */
    startNow: zod_1.z.boolean().default(true),
    startsAt: zod_1.z.number().int().optional(),
});
exports.createLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = CreateInput.parse(req.data);
    requireOneSportForSeason(input.duration, input.sports);
    const created = Date.now();
    if (!input.startNow) {
        const at = input.startsAt ?? 0;
        // A little slack for the time between picking and tapping Create.
        if (at < created + leagueConfig_1.MIN_START_LEAD_MS - 10 * 60_000) {
            throw new https_1.HttpsError("invalid-argument", "A scheduled league has to start at least a day from now, or choose Start Now.");
        }
        if (at > created + leagueConfig_1.MAX_START_LEAD_MS)
            throw new https_1.HttpsError("invalid-argument", "Pick a start date within the next 60 days.");
    }
    const leagueId = `lg_${uid.slice(0, 8)}_${input.idempotencyKey}`;
    const ref = leagueRef(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
            return { ok: true, leagueId, code: existing.get("code"), duplicate: true };
        }
        const name = await profileName(tx, uid);
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
            locksWon: 0,
            locksLost: 0,
            locksPush: 0,
            lastLockWeek: null,
            pickPoints: 0,
            eliminated: false,
            eliminatedAt: null,
            eliminatedWeek: null,
            usedTeams: [],
            h2h: { w: 0, l: 0, t: 0 },
        };
        const startsAt = input.startNow ? now : Math.max(input.startsAt ?? now, now);
        const endsAt = (0, leagueConfig_1.endsAtFor)(input.duration, input.sports, startsAt);
        tx.set(ref, {
            schemaVersion: 2,
            id: leagueId,
            name: input.name,
            code,
            mode: input.mode,
            bracketTemplateId: input.mode === "bracket" ? (input.bracketTemplateId ?? null) : null,
            // An H2H league is nothing but matchups.
            matchupsEnabled: input.mode === "matchups" || Boolean(input.matchupsEnabled),
            matchupCadence: input.matchupCadence,
            stimulusEnabled: input.stimulusEnabled,
            stimulus: null,
            createdAt: now,
            startsAt,
            // A picked start date: if nobody has joined by then, the league is cancelled (leagueSweep).
            // "Start now" leagues have no date to miss; they wait for the second player instead.
            scheduledStart: !input.startNow && startsAt > now,
            endsAt,
            duration: input.duration,
            durationWeeks: (0, leagueConfig_1.weeksBetween)(startsAt, endsAt),
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
            endVotes: [],
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
/** Moves a league's start to `now` and, for fixed-length leagues, its end with it (Full Season keeps the sport's end). */
function restartSeason(league, now) {
    const duration = league.get("duration");
    const update = { startsAt: now };
    if (duration && duration !== "Full Season") {
        const endsAt = (0, leagueConfig_1.endsAtFor)(duration, league.get("sports") ?? [], now);
        update.endsAt = endsAt;
        update.durationWeeks = (0, leagueConfig_1.weeksBetween)(now, endsAt);
    }
    return update;
}
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
        // The reply carries the league as it stands after this join, so the app can
        // show it at once instead of waiting for its listener to notice the membership.
        if (member(league, uid))
            return { ok: true, leagueId, duplicate: true, league: { ...league.data(), id: leagueId } };
        requireActiveLeague(league, now);
        if ((0, leagueConfig_1.leagueStarted)(league, now)) {
            throw new https_1.HttpsError("failed-precondition", "This league has already started, so new players can't join.");
        }
        if (league.get("scheduledStart") === true && (0, leagueConfig_1.leagueStartsAt)(league) <= now) {
            throw new https_1.HttpsError("failed-precondition", "This league was cancelled: nobody joined before its start date.");
        }
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
        const me = {
            uid,
            displayName: name,
            avatarColor: color,
            leagueTokens: start,
            startingLeagueTokens: start,
            joinedAt: now,
            betsWon: 0,
            betsLost: 0,
            betsPush: 0,
            locksWon: 0,
            locksLost: 0,
            locksPush: 0,
            lastLockWeek: null,
            pickPoints: 0,
            eliminated: false,
            eliminatedAt: null,
            eliminatedWeek: null,
            usedTeams: [],
            h2h: { w: 0, l: 0, t: 0 },
        };
        // The second player into a league whose start time has passed starts it now, with its full season.
        const restart = memberIds.length + 1 >= leagueConfig_1.MIN_LEAGUE_PLAYERS && (0, leagueConfig_1.leagueStartsAt)(league) <= now ? restartSeason(league, now) : {};
        tx.update(leagueRef(leagueId), {
            [`members.${uid}`]: me,
            memberIds: economy_1.FieldValue.arrayUnion(uid),
            pot: economy_1.FieldValue.increment(buyIn),
            lastActivityAt: now,
            ...restart,
        });
        const joined = {
            ...league.data(),
            ...restart,
            id: leagueId,
            members: { ...(league.get("members") ?? {}), [uid]: me },
            memberIds: [...memberIds, uid],
            pot: (league.get("pot") ?? 0) + buyIn,
            lastActivityAt: now,
        };
        activity(tx, leagueId, `join_${uid}`, { type: "joined", uid, name, text: `${name} joined` });
        return { ok: true, leagueId, duplicate: false, league: joined };
    });
});
exports.leaveLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const leagueId = zod_1.z.string().min(1).parse(req.data?.leagueId);
    const ref = leagueRef(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
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
        for (const d of loans.docs) {
            if (d.get("borrowerId") === uid && d.get("status") !== "active") {
                tx.update(d.ref, { status: "cancelled", updatedAt: Date.now() });
            }
        }
        const update = {
            [`members.${uid}`]: economy_1.FieldValue.delete(),
            memberIds: economy_1.FieldValue.arrayRemove(uid),
            formerMemberIds: economy_1.FieldValue.arrayUnion(uid),
            endVotes: economy_1.FieldValue.arrayRemove(uid),
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
// Settings, audit log, invites, early end voting, disputes & voids
// ---------------------------------------------------------------------------
const UpdateSettingsInput = zod_1.z.object({
    leagueId: zod_1.z.string().min(1),
    bankLoanEnabled: zod_1.z.boolean().optional(),
    bankInterestRate: zod_1.z.number().min(leagueConfig_1.BANK_RATE_MIN).max(leagueConfig_1.BANK_RATE_MAX).optional(),
    bankInterestIntervalHours: zod_1.z.number().int().min(leagueConfig_1.BANK_INTERVAL_MIN_H).max(leagueConfig_1.BANK_INTERVAL_MAX_H).optional(),
    name: zod_1.z.string().trim().min(1).max(40).optional(),
    sports: zod_1.z.array(zod_1.z.enum(leagueConfig_1.SPORTS)).min(1).max(leagueConfig_1.SPORTS.length).optional(),
    prizePreset: zod_1.z.enum(["winner-all", "top-2", "top-3"]).optional(),
    duration: zod_1.z.enum(leagueConfig_1.DURATION_KEYS).optional(),
    mode: zod_1.z.enum(leagueConfig_1.LEAGUE_MODES).optional(),
    matchupsEnabled: zod_1.z.boolean().optional(),
    matchupCadence: zod_1.z.enum(leagueConfig_1.MATCHUP_CADENCES).optional(),
    /** Not a locked rule: the creator can open or close stimulus votes any time. */
    stimulusEnabled: zod_1.z.boolean().optional(),
});
exports.updateLeagueSettings = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = UpdateSettingsInput.parse(req.data);
    const ref = leagueRef(input.leagueId);
    const touchingRules = input.name !== undefined ||
        input.sports !== undefined ||
        input.prizePreset !== undefined ||
        input.duration !== undefined ||
        input.mode !== undefined ||
        input.matchupsEnabled !== undefined ||
        input.matchupCadence !== undefined;
    return economy_1.db.runTransaction(async (tx) => {
        const [league, anyBets, anyPicks] = await Promise.all([
            tx.get(ref),
            touchingRules ? tx.get(ref.collection("leagueBets").limit(1)) : Promise.resolve(null),
            touchingRules ? tx.get(ref.collection("picks").limit(1)) : Promise.resolve(null),
        ]);
        const now = Date.now();
        requireActiveLeague(league, now);
        if (league.get("creatorId") !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only the league creator can change The House or rules.");
        }
        const me = requireMember(league, uid);
        if (touchingRules && ((anyBets && !anyBets.empty) || (anyPicks && !anyPicks.empty))) {
            throw new https_1.HttpsError("failed-precondition", "League rules are locked once the first bet has been placed.");
        }
        const before = {};
        const after = {};
        const update = { lastActivityAt: now };
        if (input.bankLoanEnabled !== undefined) {
            before.bankLoanEnabled = league.get("bankLoanEnabled");
            after.bankLoanEnabled = input.bankLoanEnabled;
            update.bankLoanEnabled = input.bankLoanEnabled;
        }
        if (input.bankInterestRate !== undefined) {
            before.bankInterestRate = league.get("bankInterestRate");
            after.bankInterestRate = input.bankInterestRate;
            update.bankInterestRate = input.bankInterestRate;
        }
        if (input.bankInterestIntervalHours !== undefined) {
            before.bankInterestIntervalHours = league.get("bankInterestIntervalHours");
            after.bankInterestIntervalHours = input.bankInterestIntervalHours;
            update.bankInterestIntervalHours = input.bankInterestIntervalHours;
        }
        if (input.name !== undefined) {
            before.name = league.get("name");
            after.name = input.name;
            update.name = input.name;
        }
        if (input.sports !== undefined) {
            before.allowedSports = league.get("allowedSports");
            after.allowedSports = input.sports;
            update.allowedSports = input.sports;
        }
        // A full-season league's end follows its sports.
        const nextDuration = input.duration ?? league.get("duration");
        if (input.duration !== undefined || (input.sports !== undefined && nextDuration === leagueConfig_1.FULL_SEASON)) {
            const d = (input.duration ?? nextDuration);
            const sports = input.sports ?? (league.get("allowedSports") ?? [...leagueConfig_1.SPORTS]);
            requireOneSportForSeason(d, sports);
            const startsAt = (0, leagueConfig_1.leagueStartsAt)(league) || now;
            before.duration = league.get("duration");
            after.duration = d;
            update.duration = d;
            update.endsAt = (0, leagueConfig_1.endsAtFor)(d, sports, startsAt);
            update.durationWeeks = (0, leagueConfig_1.weeksBetween)(startsAt, update.endsAt);
        }
        if (input.prizePreset !== undefined) {
            const shares = leagueConfig_1.PRIZE_PRESETS[input.prizePreset];
            before.prizePreset = league.get("prizeDistribution")?.preset ?? null;
            after.prizePreset = input.prizePreset;
            update.prizeDistribution = { preset: input.prizePreset, ...shares };
        }
        if (input.mode !== undefined) {
            before.mode = league.get("mode") ?? "bankroll";
            after.mode = input.mode;
            update.mode = input.mode;
        }
        if (input.matchupsEnabled !== undefined) {
            before.matchupsEnabled = Boolean(league.get("matchupsEnabled"));
            after.matchupsEnabled = input.matchupsEnabled;
            update.matchupsEnabled = input.matchupsEnabled;
        }
        if ((input.mode ?? league.get("mode")) === "matchups")
            update.matchupsEnabled = true;
        if (input.matchupCadence !== undefined) {
            before.matchupCadence = league.get("matchupCadence") ?? "weekly";
            after.matchupCadence = input.matchupCadence;
            update.matchupCadence = input.matchupCadence;
        }
        if (input.stimulusEnabled !== undefined) {
            before.stimulusEnabled = Boolean(league.get("stimulusEnabled"));
            after.stimulusEnabled = input.stimulusEnabled;
            update.stimulusEnabled = input.stimulusEnabled;
            // Closing it drops any request still waiting on votes.
            if (!input.stimulusEnabled)
                update.stimulus = null;
        }
        tx.update(ref, update);
        const docSuffix = `${now}_${Math.random().toString(36).slice(2, 8)}`;
        writeAudit(tx, input.leagueId, `settings_${docSuffix}`, {
            action: "settings",
            uid,
            name: me.displayName,
            before,
            after,
            at: now,
        });
        activity(tx, input.leagueId, `settings_${docSuffix}`, {
            type: "settings",
            uid,
            name: me.displayName,
            text: input.bankLoanEnabled !== undefined
                ? input.bankLoanEnabled
                    ? `The House terms: ${input.bankInterestRate ?? league.get("bankInterestRate")}% flat on new loans`
                    : "The bank is closed to new loans"
                : input.stimulusEnabled !== undefined && !touchingRules
                    ? input.stimulusEnabled
                        ? "Stimulus votes are open — anyone can ask The House to top everyone up"
                        : "Stimulus votes are closed"
                    : `${me.displayName} updated the league rules`,
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
        if ((0, leagueConfig_1.leagueStarted)(league, Date.now()))
            throw new https_1.HttpsError("failed-precondition", "This league has already started, so new players can't be added.");
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
            popup: true,
            data: { code: league.get("code"), leagueId, fromUid: uid },
        }));
        return { ok: true, status: "sent" };
    });
});
/**
 * Casts or withdraws a member's vote to end the league early.
 * Once a strict majority (`Math.floor(memberCount / 2) + 1`) votes yes, the
 * league is finalized and paid out immediately.
 */
exports.voteEndLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        vote: zod_1.z.boolean().default(true),
    })
        .parse(req.data);
    const ref = leagueRef(input.leagueId);
    const outcome = await economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        const now = Date.now();
        requireActiveLeague(league, now);
        const me = requireMember(league, uid);
        const memberIds = league.get("memberIds") ?? [];
        const currentVotes = new Set((league.get("endVotes") ?? []).filter((id) => memberIds.includes(id)));
        if (input.vote)
            currentVotes.add(uid);
        else
            currentVotes.delete(uid);
        const votes = [...currentVotes];
        const needed = Math.floor(memberIds.length / 2) + 1;
        const count = votes.length;
        tx.update(ref, { endVotes: votes, lastActivityAt: now });
        const suffix = `${now}_${uid}_${Math.random().toString(36).slice(2, 8)}`;
        writeAudit(tx, input.leagueId, `endvote_${suffix}`, {
            action: "end_vote",
            uid,
            name: me.displayName,
            vote: input.vote,
            votes: count,
            needed,
            at: now,
        });
        activity(tx, input.leagueId, `endvote_${suffix}`, {
            type: "end_vote",
            uid,
            name: me.displayName,
            text: input.vote
                ? `${me.displayName} voted to end the season early (${count}/${needed})`
                : `${me.displayName} withdrew their early-end vote (${count}/${needed})`,
        });
        return { shouldFinalize: count >= needed, votes: count, needed };
    });
    if (outcome.shouldFinalize) {
        const results = await (0, leagueLifecycle_1.finalizeLeague)(input.leagueId, Date.now());
        await (0, leagueLifecycle_1.payoutLeague)(input.leagueId);
        return { ok: true, ended: true, votes: outcome.votes, needed: outcome.needed, results };
    }
    return { ok: true, ended: false, votes: outcome.votes, needed: outcome.needed, results: null };
});
exports.endLeague = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const leagueId = zod_1.z.string().min(1).parse(req.data?.leagueId);
    const snap = await leagueRef(leagueId).get();
    if (!snap.exists)
        throw new https_1.HttpsError("not-found", "League not found.");
    requireMember(snap, uid);
    const now = Date.now();
    const expired = now >= (snap.get("endsAt") ?? 0);
    if (snap.get("creatorId") !== uid && !expired) {
        throw new https_1.HttpsError("permission-denied", "Only the creator can end the league early.");
    }
    if (!expired) {
        const memberIds = snap.get("memberIds") ?? [];
        if (memberIds.length > 1) {
            const currentVotes = new Set((snap.get("endVotes") ?? []).filter((id) => memberIds.includes(id)));
            currentVotes.add(uid);
            const needed = Math.floor(memberIds.length / 2) + 1;
            if (currentVotes.size < needed) {
                throw new https_1.HttpsError("failed-precondition", `Ending early requires a majority vote (${currentVotes.size}/${needed}). Have league members vote first.`);
            }
        }
    }
    const results = await (0, leagueLifecycle_1.finalizeLeague)(leagueId, now);
    await (0, leagueLifecycle_1.payoutLeague)(leagueId);
    return { ok: true, results };
});
/**
 * Flags a league bet result for commissioner review. Writes a dispute record on
 * the bet, logs it in `leagues/{id}/audit`, and notifies the commissioner.
 */
exports.reportResult = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        betId: zod_1.z.string().min(1),
        reason: zod_1.z.string().trim().min(3).max(240),
    })
        .parse(req.data);
    const ref = leagueRef(input.leagueId);
    const betRef = ref.collection("leagueBets").doc(input.betId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, bet] = await Promise.all([tx.get(ref), tx.get(betRef)]);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        const me = requireMember(league, uid);
        if (!bet.exists)
            throw new https_1.HttpsError("not-found", "Bet not found.");
        const now = Date.now();
        tx.update(betRef, {
            disputed: true,
            disputeReason: input.reason,
            disputedBy: uid,
            disputedByName: me.displayName,
            disputedAt: now,
        });
        const suffix = `${input.betId}_${uid}_${now}`;
        writeAudit(tx, input.leagueId, `dispute_${suffix}`, {
            action: "dispute_reported",
            uid,
            name: me.displayName,
            betId: input.betId,
            reason: input.reason,
            at: now,
        });
        activity(tx, input.leagueId, `dispute_${suffix}`, {
            type: "dispute_reported",
            uid,
            name: me.displayName,
            text: `${me.displayName} flagged a bet (${bet.get("label") ?? bet.get("teamAbbr")}): "${input.reason}"`,
        });
        const creatorId = league.get("creatorId");
        if (creatorId && creatorId !== uid) {
            (0, notify_1.writeNotification)(tx, creatorId, (0, notifyModel_1.simpleNotification)({
                id: `dispute_${input.leagueId}_${input.betId}`,
                type: "dispute_reported",
                title: `Result flagged in ${league.get("name")}`,
                body: `${me.displayName} flagged ${bet.get("displayName")}'s ${bet.get("label") ?? bet.get("teamAbbr")} bet: "${input.reason}"`,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName: league.get("name"),
                now,
            }));
        }
        return { ok: true };
    });
});
/**
 * Commissioner action to void a pending or settled league bet with a logged
 * reason, restoring the member's league tokens to their pre-bet state.
 */
exports.voidLeagueBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        betId: zod_1.z.string().min(1),
        reason: zod_1.z.string().trim().min(3).max(240),
    })
        .parse(req.data);
    const ref = leagueRef(input.leagueId);
    const betRef = ref.collection("leagueBets").doc(input.betId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, bet] = await Promise.all([tx.get(ref), tx.get(betRef)]);
        const now = Date.now();
        requireActiveLeague(league, now);
        if (league.get("creatorId") !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only the league commissioner can void a bet.");
        }
        const me = requireMember(league, uid);
        if (!bet.exists)
            throw new https_1.HttpsError("not-found", "Bet not found.");
        const status = bet.get("status");
        if (status === "cancelled" || status === "void") {
            throw new https_1.HttpsError("failed-precondition", "That bet has already been voided.");
        }
        const gameId = bet.get("gameId");
        const sidesRef = ref.collection("gameSides").doc(gameId);
        const sidesSnap = await tx.get(sidesRef);
        const betUid = bet.get("uid");
        const targetMember = member(league, betUid);
        const stake = bet.get("stake");
        const payout = bet.get("potentialPayout");
        // Restore token balance:
        //  - pending or lost: stake was debited and nothing returned -> +stake
        //  - won: stake was debited and payout credited -> +(stake - payout)
        //  - push: stake was already returned -> 0
        const tokenDelta = status === "pending" || status === "lost"
            ? stake
            : status === "won"
                ? stake - payout
                : 0;
        const leagueUpdate = { lastActivityAt: now };
        if (targetMember) {
            if (tokenDelta !== 0) {
                leagueUpdate[`members.${betUid}.leagueTokens`] = economy_1.FieldValue.increment(tokenDelta);
            }
            if (status === "won")
                leagueUpdate[`members.${betUid}.betsWon`] = economy_1.FieldValue.increment(-1);
            if (status === "lost")
                leagueUpdate[`members.${betUid}.betsLost`] = economy_1.FieldValue.increment(-1);
            if (status === "push")
                leagueUpdate[`members.${betUid}.betsPush`] = economy_1.FieldValue.increment(-1);
            if (bet.get("lock") === true && bet.get("lockWeek")) {
                leagueUpdate[`members.${betUid}.lastLockWeek`] = null;
            }
        }
        tx.update(ref, leagueUpdate);
        tx.update(betRef, {
            status: "cancelled",
            voidReason: input.reason,
            voidedBy: uid,
            voidedAt: now,
            disputed: false,
            settledAt: economy_1.FieldValue.serverTimestamp(),
        });
        if (sidesSnap.exists) {
            const entries = (sidesSnap.get("entries") ?? []).filter((e) => e.betId !== input.betId);
            tx.set(sidesRef, {
                entries,
                home: entries.filter((e) => e.side === "home"),
                away: entries.filter((e) => e.side === "away"),
                updatedAt: now,
            }, { merge: true });
        }
        writeAudit(tx, input.leagueId, `void_${input.betId}`, {
            action: "bet_voided",
            uid,
            name: me.displayName,
            betId: input.betId,
            reason: input.reason,
            before: { status, stake, payout },
            after: { status: "cancelled", voidReason: input.reason },
            at: now,
        });
        activity(tx, input.leagueId, `void_${input.betId}`, {
            type: "bet_voided",
            uid,
            name: me.displayName,
            amount: stake,
            text: `${me.displayName} voided ${bet.get("displayName")}'s ${bet.get("label") ?? bet.get("teamAbbr")} bet (${input.reason})`,
        });
        if (targetMember) {
            (0, notify_1.writeNotification)(tx, betUid, (0, notifyModel_1.simpleNotification)({
                id: `void_${input.leagueId}_${input.betId}`,
                type: "bet_voided",
                title: `Bet voided in ${league.get("name")}`,
                body: `${me.displayName} voided your ${bet.get("label") ?? bet.get("teamAbbr")} bet: "${input.reason}".`,
                delta: tokenDelta,
                balanceAfter: targetMember.leagueTokens + tokenDelta,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName: league.get("name"),
                now,
            }));
        }
        return { ok: true, tokenDelta };
    });
});
// ---------------------------------------------------------------------------
// League bets
// ---------------------------------------------------------------------------
const LeagueBetInput = zod_1.z
    .object({
    leagueId: zod_1.z.string().min(1),
    gameId: zod_1.z.string().min(1),
    side: zod_1.z.enum(["home", "away"]).optional(),
    market: zod_1.z.enum(["ml", "spread", "total"]).optional(),
    selection: zod_1.z.enum(["home", "away", "over", "under"]).optional(),
    stake: Money(leagueConfig_1.MIN_LEAGUE_STAKE, 10_000_000),
    idempotencyKey: Key,
    expectedOdds: zod_1.z.number().positive().max(100).optional(),
    expectedLine: zod_1.z.number().finite().optional(),
    /** Another member's pending bet in this league, copied on the same side. */
    tailOf: zod_1.z.string().min(1).max(200).optional(),
    /** Another member's pending bet in this league, opposed on the other side. */
    fadeOf: zod_1.z.string().min(1).max(200).optional(),
    /** One Lock of the Week per member per week. */
    lock: zod_1.z.boolean().optional(),
    /** Hide pick from chat and sweat tracker until kickoff. */
    hidden: zod_1.z.boolean().optional(),
})
    .refine((v) => !(v.tailOf && v.fadeOf), { message: "A bet can tail or fade, not both." })
    .refine((v) => !!(v.selection || v.side), { message: "Pick a side or selection." });
function oppositeSelection(sel) {
    if (sel === "home")
        return "away";
    if (sel === "away")
        return "home";
    if (sel === "over")
        return "under";
    return "over";
}
/**
 * Validates a tail/fade reference. The source must be another member's
 * still-pending bet in this same league, on this game, and the new bet must be
 * on the same selection (tail) or the opposite selection (fade).
 */
function followSource(source, kind, leagueId, gameId, priced, uid) {
    const verb = kind === "tail" ? "tail" : "fade";
    if (!source.exists || source.get("leagueId") !== leagueId) {
        throw new https_1.HttpsError("not-found", `That bet isn't in this league any more, so you can't ${verb} it.`);
    }
    if (source.get("status") !== "pending") {
        throw new https_1.HttpsError("failed-precondition", `That bet has already settled — too late to ${verb} it.`);
    }
    if (source.get("uid") === uid) {
        throw new https_1.HttpsError("failed-precondition", `You can't ${verb} your own bet.`);
    }
    if (source.get("gameId") !== gameId) {
        throw new https_1.HttpsError("invalid-argument", "That bet is on a different game.");
    }
    const sourceMarket = source.get("market") ?? "ml";
    const sourceSel = source.get("selection") ??
        source.get("side");
    if (priced.market !== sourceMarket) {
        throw new https_1.HttpsError("invalid-argument", `A ${verb} must be in the same market (${sourceMarket}).`);
    }
    if (kind === "tail" && priced.selection !== sourceSel) {
        throw new https_1.HttpsError("invalid-argument", "A tail backs the same side.");
    }
    if (kind === "fade" && priced.selection !== oppositeSelection(sourceSel)) {
        throw new https_1.HttpsError("invalid-argument", "A fade backs the other side.");
    }
    const followers = source.get("followers") ?? {};
    if (followers[uid]) {
        throw new https_1.HttpsError("already-exists", `You've already ${followers[uid] === "tail" ? "tailed" : "faded"} this bet.`);
    }
    return {
        kind,
        ref: source.ref,
        uid: source.get("uid"),
        name: source.get("displayName") || "Player",
        teamAbbr: source.get("label") || source.get("teamAbbr"),
    };
}
exports.placeLeagueBet = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = LeagueBetInput.parse(req.data);
    const ref = leagueRef(input.leagueId);
    const betId = `${uid}_${input.idempotencyKey}`;
    const betRef = ref.collection("leagueBets").doc(betId);
    const sidesRef = ref.collection("gameSides").doc(input.gameId);
    const followId = input.tailOf ?? input.fadeOf ?? null;
    const followKind = input.tailOf ? "tail" : input.fadeOf ? "fade" : null;
    const emptyDays = await (0, streakDays_1.recentEmptyDays)();
    return economy_1.db.runTransaction(async (tx) => {
        const [existing, league, game, sourceSnap, sidesSnap, uSnap] = await Promise.all([
            tx.get(betRef),
            tx.get(ref),
            tx.get(economy_1.db.collection("games").doc(input.gameId)),
            followId ? tx.get(ref.collection("leagueBets").doc(followId)) : Promise.resolve(null),
            tx.get(sidesRef),
            tx.get(userRef(uid)),
        ]);
        if (existing.exists)
            return { ok: true, betId, duplicate: true, leagueTokens: null };
        const now = Date.now();
        requireActiveLeague(league, now);
        requireStarted(league, now);
        const me = requireMember(league, uid);
        const limitUpdate = uSnap.exists ? (0, playLimits_1.checkPlayLimits)(uSnap, now) : {};
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
        const priced = (0, pricing_1.requirePricedMarket)(game, input);
        const follow = followKind && sourceSnap
            ? followSource(sourceSnap, followKind, input.leagueId, input.gameId, priced, uid)
            : null;
        const isLock = Boolean(input.lock);
        const wk = (0, weekly_1.weekKey)(startsAt || now);
        if (isLock && me.lastLockWeek === wk) {
            throw new https_1.HttpsError("failed-precondition", "You've already used your Lock of the Week.");
        }
        const isHidden = Boolean(input.hidden);
        const potentialPayout = (0, settlement_1.payoutFor)(input.stake, priced.odds);
        tx.set(betRef, {
            id: betId,
            leagueId: input.leagueId,
            uid,
            displayName: me.displayName,
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
            stake: input.stake,
            odds: priced.odds,
            potentialPayout,
            status: "pending",
            startsAt: startsAt || null,
            lock: isLock,
            lockWeek: isLock ? wk : null,
            hidden: isHidden,
            disputed: false,
            tails: 0,
            fades: 0,
            followers: {},
            reactions: {},
            reactors: {},
            tailOf: follow?.kind === "tail" ? followId : null,
            fadeOf: follow?.kind === "fade" ? followId : null,
            followOfUid: follow?.uid ?? null,
            followOfName: follow?.name ?? null,
            placedAt: now,
            settledAt: null,
        });
        const leagueUpdate = {
            [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
            lastActivityAt: now,
        };
        if (isLock) {
            leagueUpdate[`members.${uid}.lastLockWeek`] = wk;
        }
        tx.update(ref, leagueUpdate);
        if (uSnap.exists) {
            const prevStreak = uSnap.get("streak");
            tx.update(userRef(uid), { streak: (0, streak_1.advanceStreak)(prevStreak, now, { emptyDays }), ...limitUpdate });
        }
        // Update sweat tracker aggregate when not hidden before kickoff.
        if (!isHidden) {
            const prevEntries = (sidesSnap.exists ? sidesSnap.get("entries") : undefined) ?? [];
            const entry = {
                betId,
                uid,
                name: me.displayName,
                displayName: me.displayName,
                side: priced.side,
                market: priced.market,
                selection: priced.selection,
                line: priced.line,
                label: priced.label,
                teamAbbr: priced.teamAbbr,
                stake: input.stake,
                payout: potentialPayout,
                odds: priced.odds,
                lock: isLock,
            };
            const entries = [...prevEntries.filter((e) => e.betId !== betId), entry];
            tx.set(sidesRef, {
                gameId: input.gameId,
                leagueId: input.leagueId,
                sport: game.get("sport"),
                startsAt: startsAt || null,
                entries,
                home: entries.filter((e) => e.side === "home"),
                away: entries.filter((e) => e.side === "away"),
                updatedAt: now,
            }, { merge: true });
        }
        // Social copy never shows stake size (guardrail 3); hidden picks never reveal a side.
        const pickDisplay = priced.market === "ml" ? priced.teamAbbr : priced.label;
        const text = isHidden
            ? `${me.displayName} locked in a hidden pick (reveals at kickoff)`
            : !follow
                ? `${me.displayName} picked ${pickDisplay} (${priced.odds.toFixed(2)}x)${isLock ? " 🔒" : ""}`
                : follow.kind === "tail"
                    ? `${me.displayName} tailed ${follow.name} on ${pickDisplay} (${priced.odds.toFixed(2)}x)`
                    : `${me.displayName} faded ${follow.name} — on ${pickDisplay} (${priced.odds.toFixed(2)}x)`;
        activity(tx, input.leagueId, `bet_${betId}`, {
            type: follow ? (follow.kind === "tail" ? "bet_tailed" : "bet_faded") : "bet_placed",
            uid,
            name: me.displayName,
            amount: input.stake,
            text,
        });
        // Bet card in league chat. Hidden picks post a locked card with no side/pick fields.
        tx.set(ref.collection("messages").doc(`bet_${betId}`), isHidden
            ? {
                uid,
                name: me.displayName,
                kind: "bet",
                text,
                betId,
                gameId: input.gameId,
                sport: game.get("sport"),
                hidden: true,
                startsAt: startsAt || null,
                at: now,
                reactions: {},
                reactors: {},
            }
            : {
                uid,
                name: me.displayName,
                kind: "bet",
                text,
                betId,
                gameId: input.gameId,
                sport: game.get("sport"),
                market: priced.market,
                selection: priced.selection,
                side: priced.side,
                line: priced.line,
                label: priced.label,
                teamAbbr: priced.teamAbbr,
                teamColor: priced.teamColor,
                opponentAbbr: priced.opponentAbbr,
                odds: priced.odds,
                lock: isLock,
                startsAt: startsAt || null,
                at: now,
                reactions: {},
                reactors: {},
            });
        if (follow) {
            tx.update(follow.ref, {
                [follow.kind === "tail" ? "tails" : "fades"]: economy_1.FieldValue.increment(1),
                [`followers.${uid}`]: follow.kind,
            });
            (0, notify_1.writeNotification)(tx, follow.uid, (0, notifyModel_1.followNotification)({
                kind: follow.kind,
                followerBetId: betId,
                sourceBetId: followId,
                followerName: me.displayName,
                sourceTeamAbbr: follow.teamAbbr,
                followerTeamAbbr: pickDisplay,
                stake: input.stake,
                leagueId: input.leagueId,
                leagueName: league.get("name"),
                gameId: input.gameId,
                now,
            }));
        }
        // Organic fades: a moneyline bet on the other side of a league-mate's open
        // moneyline pick tells them, once per game per pair, with a challenge nudge.
        if (!isHidden && priced.market === "ml" && !(follow && follow.kind === "fade")) {
            const prevEntries = (sidesSnap.exists ? sidesSnap.get("entries") : undefined) ?? [];
            const opposed = new Map();
            for (const e of prevEntries) {
                if (e.uid !== uid && (e.market ?? "ml") === "ml" && e.side && e.side !== priced.side && !opposed.has(e.uid))
                    opposed.set(e.uid, e);
            }
            for (const e of [...opposed.values()].slice(0, 10)) {
                (0, notify_1.writeNotification)(tx, e.uid, (0, notifyModel_1.simpleNotification)({
                    id: `fade_${input.gameId}_${uid}_${e.uid}`,
                    type: "bet_faded",
                    title: `${me.displayName} is fading your ${e.teamAbbr} pick`,
                    body: `They took ${pickDisplay} in ${league.get("name")}. Settle it head to head?`,
                    now,
                    leagueId: input.leagueId,
                    leagueName: league.get("name"),
                    data: { gameId: input.gameId, friendUid: uid, friendName: me.displayName },
                }));
            }
        }
        return { ok: true, betId, duplicate: false, leagueTokens: me.leagueTokens - input.stake };
    });
});
// ---------------------------------------------------------------------------
// Bank loans
// ---------------------------------------------------------------------------
/**
 * Guardrail against loss-chasing: no self-serve bank loan for an hour after a
 * loss. Peer loans still work (a friend has to choose to fund them).
 */
exports.LOAN_COOLDOWN_MS = 60 * 60_000;
function requireNoLossCooldown(league, uid, now) {
    const lastLoss = league.get(`members.${uid}.lastLossAt`);
    if (lastLoss && now - lastLoss < exports.LOAN_COOLDOWN_MS) {
        const mins = Math.ceil((exports.LOAN_COOLDOWN_MS - (now - lastLoss)) / 60_000);
        throw new https_1.HttpsError("failed-precondition", `Loans cool down for an hour after a loss. Try again in ${mins} min.`);
    }
}
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
        requireStarted(league, now);
        const me = requireMember(league, uid);
        if (!league.get("bankLoanEnabled"))
            throw new https_1.HttpsError("failed-precondition", "The House is closed in this league.");
        requireNoLossCooldown(league, uid, now);
        const cap = Math.floor(league.get("startingLeagueTokens") * leagueConfig_1.BANK_PRINCIPAL_CAP_MULTIPLIER);
        const outstanding = mine.docs
            .filter((d) => d.get("kind") === "bank")
            .reduce((s, d) => s + (d.get("principalOutstanding") ?? 0), 0);
        if (outstanding + input.amount > cap) {
            throw new https_1.HttpsError("failed-precondition", `The House lends up to ${cap.toLocaleString("en-US")} in principal. You can borrow ${Math.max(0, cap - outstanding).toLocaleString("en-US")} more.`);
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
            lenderName: "The House",
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
            text: `${me.displayName} borrowed ${input.amount.toLocaleString("en-US")} from The House at ${rate}% flat`,
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
            reactions: {},
            reactors: {},
            text: `${me.displayName} repaid ${res.applied.toLocaleString("en-US")} to ${lender ? lender.displayName : "The House"}${res.settled ? " — paid off" : ""}`,
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
        requireStarted(league, now);
        const me = requireMember(league, uid);
        const max = Math.floor(league.get("startingLeagueTokens") * leagueConfig_1.PEER_LOAN_MAX_PCT);
        if (input.amount > max) {
            throw new https_1.HttpsError("failed-precondition", `Peer loan requests are capped at ${max.toLocaleString("en-US")} (50% of starting tokens).`);
        }
        if (open.size >= leagueConfig_1.MAX_OPEN_REQUESTS) {
            throw new https_1.HttpsError("resource-exhausted", `You already have ${leagueConfig_1.MAX_OPEN_REQUESTS} open loan requests.`);
        }
        const rate = Math.round(input.rate * 100) / 100;
        const interval = league.get("bankInterestIntervalHours") ?? 24;
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
            message: input.message || null,
            ...(0, loanMath_1.newLoanTerms)(input.amount, rate, interval, now),
            createdAt: now,
            fundedAt: null,
            updatedAt: now,
        });
        activity(tx, input.leagueId, `req_${loanRef.id}`, {
            type: "loan_request",
            uid,
            name: me.displayName,
            amount: input.amount,
            text: `${me.displayName} asked to borrow ${input.amount.toLocaleString("en-US")} at ${rate}%`,
        });
        tx.set(ref.collection("messages").doc(`loan_${loanRef.id}`), {
            uid,
            name: me.displayName,
            kind: "loan",
            loanId: loanRef.id,
            amount: input.amount,
            rate,
            text: `${me.displayName} asked to borrow ${input.amount.toLocaleString("en-US")} at ${rate}% flat${input.message ? `: "${input.message}"` : ""}`,
            at: now,
            reactions: {},
            reactors: {},
        });
        const leagueName = league.get("name");
        for (const memberId of league.get("memberIds") ?? []) {
            if (memberId === uid)
                continue;
            (0, notify_1.writeNotification)(tx, memberId, (0, notifyModel_1.simpleNotification)({
                id: `loanreq_${loanRef.id}`,
                type: "loan_request",
                title: `${me.displayName} wants a loan in ${leagueName}`,
                body: `${input.amount.toLocaleString("en-US")} league tokens at ${rate}% flat${input.message ? ` — "${input.message}"` : ""}.`,
                wallet: "league",
                leagueId: input.leagueId,
                leagueName,
                now,
            }));
        }
        return { ok: true, loanId: loanRef.id, duplicate: false };
    });
});
exports.peerLoanAction = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1),
        loanId: zod_1.z.string().min(1),
        action: zod_1.z.enum(["fund", "counter", "decline", "cancel", "accept_counter", "reject_counter", "edit"]),
        rate: zod_1.z.number().gt(0).max(leagueConfig_1.PEER_RATE_MAX).optional(),
        amount: Money(10, 10_000_000).optional(),
        message: zod_1.z.string().trim().max(80).optional(),
    })
        .parse(req.data);
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
        const isBorrower = borrowerId === uid;
        const amount = loan.get("principal");
        const interval = league.get("bankInterestIntervalHours") ?? 24;
        const leagueName = league.get("name");
        const maxAllowed = Math.floor(league.get("startingLeagueTokens") * leagueConfig_1.PEER_LOAN_MAX_PCT);
        const fund = (lenderId, rate, fundAmount = amount) => {
            const lender = member(league, lenderId);
            if (!lender)
                throw new https_1.HttpsError("failed-precondition", "The lender has left the league.");
            if (!borrower)
                throw new https_1.HttpsError("failed-precondition", "The borrower has left the league.");
            if (lender.leagueTokens < fundAmount) {
                throw new https_1.HttpsError("failed-precondition", `${lenderId === uid ? "You don't" : `${lender.displayName} doesn't`} have ${fundAmount.toLocaleString("en-US")} league tokens to lend.`);
            }
            const isBailout = borrower.leagueTokens < 100;
            tx.update(loanRef, {
                status: "active",
                lenderId,
                lenderName: lender.displayName,
                bailout: isBailout,
                ...(0, loanMath_1.newLoanTerms)(fundAmount, rate, interval, now),
                fundedAt: now,
                updatedAt: now,
            });
            tx.update(ref, {
                [`members.${lenderId}.leagueTokens`]: lender.leagueTokens - fundAmount,
                [`members.${borrowerId}.leagueTokens`]: borrower.leagueTokens + fundAmount,
                lastActivityAt: now,
            });
            activity(tx, input.leagueId, `fund_${loanRef.id}`, {
                type: isBailout ? "bailout" : "loan_funded",
                uid: lenderId,
                name: lender.displayName,
                amount: fundAmount,
                text: isBailout
                    ? `${lender.displayName} bailed out ${borrower.displayName} with ${fundAmount.toLocaleString("en-US")} at ${rate}%`
                    : `${lender.displayName} lent ${borrower.displayName} ${fundAmount.toLocaleString("en-US")} at ${rate}%`,
            });
            const target = lenderId === uid ? borrowerId : lenderId;
            (0, notify_1.writeNotification)(tx, target, (0, notifyModel_1.simpleNotification)({
                id: `funded_${loanRef.id}`,
                type: "loan_funded",
                title: lenderId === uid ? `${lender.displayName} funded your loan` : `${borrower.displayName} took your offer`,
                body: `${fundAmount.toLocaleString("en-US")} league tokens at ${rate}% flat. Repays ${(0, loanMath_1.totalRepayable)(fundAmount, rate).toLocaleString("en-US")} in total.`,
                delta: lenderId === uid ? fundAmount : -fundAmount,
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
                if (status !== "requested" && status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                const rateToFund = (status === "countered" && loan.get("counterRate") ? loan.get("counterRate") : loan.get("proposedRate"));
                fund(uid, rateToFund, amount);
                break;
            }
            case "counter": {
                if (isBorrower)
                    throw new https_1.HttpsError("invalid-argument", "You can't counter your own request.");
                if (status !== "requested" && status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                const rate = Math.round((input.rate ?? loan.get("proposedRate")) * 100) / 100;
                const nextAmount = input.amount ? Math.min(input.amount, maxAllowed) : amount;
                const nextMsg = input.message !== undefined ? input.message || null : loan.get("message") ?? null;
                tx.update(loanRef, {
                    status: "countered",
                    counterRate: rate,
                    counterBy: uid,
                    counterByName: me.displayName,
                    ...(nextAmount !== amount ? (0, loanMath_1.newLoanTerms)(nextAmount, rate, interval, now) : {}),
                    ...(input.message !== undefined ? { message: nextMsg } : {}),
                    updatedAt: now,
                });
                activity(tx, input.leagueId, `counter_${loanRef.id}_${now}`, {
                    type: "loan_request",
                    uid,
                    name: me.displayName,
                    amount: nextAmount,
                    text: `${me.displayName} countered ${borrower?.displayName ?? "loan"}: ${nextAmount.toLocaleString("en-US")} at ${rate}% flat`,
                });
                (0, notify_1.writeNotification)(tx, borrowerId, (0, notifyModel_1.simpleNotification)({
                    id: `counter_${loanRef.id}_${uid}`,
                    type: "loan_countered",
                    title: `${me.displayName} countered at ${rate}%`,
                    body: `For ${nextAmount.toLocaleString("en-US")} tokens in ${leagueName}. Accept or counter in chat.`,
                    wallet: "league",
                    leagueId: input.leagueId,
                    leagueName,
                    now,
                }));
                break;
            }
            case "edit": {
                if (!isBorrower)
                    throw new https_1.HttpsError("permission-denied", "Only the borrower can edit their request.");
                if (status !== "requested" && status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                const nextAmount = input.amount ? Math.min(input.amount, maxAllowed) : amount;
                const nextRate = Math.round((input.rate ?? loan.get("proposedRate")) * 100) / 100;
                const nextMsg = input.message !== undefined ? input.message || null : loan.get("message") ?? null;
                tx.update(loanRef, {
                    status: "requested",
                    proposedRate: nextRate,
                    counterRate: null,
                    counterBy: null,
                    counterByName: null,
                    message: nextMsg,
                    ...(0, loanMath_1.newLoanTerms)(nextAmount, nextRate, interval, now),
                    updatedAt: now,
                });
                activity(tx, input.leagueId, `edit_${loanRef.id}_${now}`, {
                    type: "loan_request",
                    uid,
                    name: me.displayName,
                    amount: nextAmount,
                    text: `${me.displayName} updated loan request: ${nextAmount.toLocaleString("en-US")} at ${nextRate}% flat${nextMsg ? ` ("${nextMsg}")` : ""}`,
                });
                break;
            }
            case "decline": {
                if (isBorrower)
                    throw new https_1.HttpsError("invalid-argument", "Cancel your own request instead.");
                if (status !== "requested" && status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "That request isn't open.");
                const declined = new Set([...(loan.get("declinedBy") ?? []), uid]);
                const others = (league.get("memberIds") ?? []).filter((m) => m !== borrowerId);
                const everyone = others.every((m) => declined.has(m));
                tx.update(loanRef, {
                    declinedBy: [...declined],
                    status: everyone ? "rejected" : status,
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
                fund(loan.get("counterBy"), loan.get("counterRate"), amount);
                break;
            }
            case "reject_counter": {
                if (!isBorrower)
                    throw new https_1.HttpsError("permission-denied", "Only the borrower can reject.");
                if (status !== "countered")
                    throw new https_1.HttpsError("failed-precondition", "There's no counter-offer to reject.");
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
const StimulusInput = zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({ leagueId: zod_1.z.string().min(1), action: zod_1.z.literal("request"), pct: zod_1.z.number().int().refine((n) => leagueConfig_1.STIMULUS_PCTS.includes(n)) }),
    zod_1.z.object({ leagueId: zod_1.z.string().min(1), action: zod_1.z.literal("vote"), requestId: zod_1.z.string().min(1), approve: zod_1.z.boolean() }),
    zod_1.z.object({ leagueId: zod_1.z.string().min(1), action: zod_1.z.literal("cancel"), requestId: zod_1.z.string().min(1) }),
]);
exports.leagueStimulus = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = StimulusInput.parse(req.data);
    const ref = leagueRef(input.leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        const now = Date.now();
        requireActiveLeague(league, now);
        requireStarted(league, now);
        const me = requireMember(league, uid);
        if (!league.get("stimulusEnabled"))
            throw new https_1.HttpsError("failed-precondition", "Stimulus votes are turned off in this league.");
        const memberIds = league.get("memberIds") ?? [];
        const needed = Math.floor(memberIds.length / 2) + 1;
        const leagueName = league.get("name") ?? "League";
        const open = league.get("stimulus");
        const live = open && open.expiresAt > now ? open : null;
        const pay = (r) => {
            const update = { stimulus: null, lastStimulusAt: now, lastActivityAt: now, stimulusTotal: economy_1.FieldValue.increment(r.amount) };
            for (const id of memberIds) {
                update[`members.${id}.leagueTokens`] = economy_1.FieldValue.increment(r.amount);
                update[`members.${id}.stimulusReceived`] = economy_1.FieldValue.increment(r.amount);
            }
            tx.update(ref, update);
            activity(tx, input.leagueId, `stimulus_paid_${r.id}`, {
                type: "stimulus",
                uid: r.uid,
                name: r.name,
                text: `Stimulus approved: The House gave everyone ${r.amount.toLocaleString("en-US")} tokens`,
                amount: r.amount,
            });
            for (const id of memberIds) {
                (0, notify_1.writeNotification)(tx, id, (0, notifyModel_1.simpleNotification)({
                    id: `stimulus_ok_${r.id}_${id}`,
                    type: "stimulus_approved",
                    title: `+${r.amount.toLocaleString("en-US")} tokens in ${leagueName}`,
                    body: "The stimulus vote passed — The House topped up every member.",
                    now,
                    delta: r.amount,
                    wallet: "league",
                    leagueId: input.leagueId,
                    leagueName,
                }));
            }
        };
        if (input.action === "request") {
            if (live)
                throw new https_1.HttpsError("failed-precondition", "There's already a stimulus vote open.");
            const last = league.get("lastStimulusAt") ?? 0;
            if (now - last < leagueConfig_1.STIMULUS_COOLDOWN_MS) {
                const days = Math.ceil((last + leagueConfig_1.STIMULUS_COOLDOWN_MS - now) / 86_400_000);
                throw new https_1.HttpsError("failed-precondition", `The last stimulus was recent — try again in ${days} day${days === 1 ? "" : "s"}.`);
            }
            const starting = league.get("startingLeagueTokens") ?? 0;
            const r = {
                id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                uid,
                name: me.displayName,
                pct: input.pct,
                amount: Math.max(1, Math.round((starting * input.pct) / 100)),
                votes: [uid],
                createdAt: now,
                expiresAt: now + leagueConfig_1.STIMULUS_TTL_MS,
            };
            if (r.votes.length >= needed) {
                pay(r);
                return { ok: true, status: "paid", amount: r.amount };
            }
            tx.update(ref, { stimulus: r, lastActivityAt: now });
            activity(tx, input.leagueId, `stimulus_req_${r.id}`, {
                type: "stimulus",
                uid,
                name: me.displayName,
                text: `${me.displayName} asked The House for a ${r.pct}% stimulus (${r.amount.toLocaleString("en-US")} tokens each) — vote in the Loans tab`,
                amount: r.amount,
            });
            for (const id of memberIds) {
                if (id === uid)
                    continue;
                (0, notify_1.writeNotification)(tx, id, (0, notifyModel_1.simpleNotification)({
                    id: `stimulus_req_${r.id}_${id}`,
                    type: "stimulus_request",
                    title: `Stimulus vote in ${leagueName}`,
                    body: `${me.displayName} wants The House to give everyone ${r.amount.toLocaleString("en-US")} tokens. ${needed} yes votes needed.`,
                    now,
                    popup: false,
                    wallet: "league",
                    leagueId: input.leagueId,
                    leagueName,
                }));
            }
            return { ok: true, status: "open", amount: r.amount };
        }
        if (!live || live.id !== input.requestId)
            throw new https_1.HttpsError("failed-precondition", "That stimulus vote is closed.");
        if (input.action === "cancel") {
            if (live.uid !== uid && league.get("creatorId") !== uid) {
                throw new https_1.HttpsError("permission-denied", "Only whoever asked (or the league creator) can withdraw it.");
            }
            tx.update(ref, { stimulus: null, lastActivityAt: now });
            return { ok: true, status: "cancelled", amount: live.amount };
        }
        const votes = input.approve ? [...new Set([...live.votes, uid])] : live.votes.filter((v) => v !== uid);
        const next = { ...live, votes };
        if (votes.length >= needed) {
            pay(next);
            return { ok: true, status: "paid", amount: live.amount };
        }
        tx.update(ref, { stimulus: next, lastActivityAt: now });
        return { ok: true, status: "open", amount: live.amount };
    });
});
/** Share of starting tokens a broke member gets back (once per league season, no debt). */
exports.RESET_SHARE = 0.25;
/**
 * Bankrupt reset: a member at 0 tokens, with no active/open loans and nothing
 * still riding, can reset to 25% of the starting stack once per league.
 * Not a loan — no debt, no repayment — and logged to the feed.
 */
exports.requestReset = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z.object({ leagueId: zod_1.z.string().min(1) }).parse(req.data);
    const ref = leagueRef(input.leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, loans, open] = await Promise.all([
            tx.get(ref),
            tx.get(ref.collection("loans").where("borrowerId", "==", uid).where("status", "in", ["active", "requested", "countered"])),
            tx.get(ref.collection("leagueBets").where("uid", "==", uid).where("status", "==", "pending").limit(1)),
        ]);
        const now = Date.now();
        requireActiveLeague(league, now);
        requireStarted(league, now);
        const me = requireMember(league, uid);
        if (league.get(`members.${uid}.resetUsed`) === true) {
            // Idempotent replay of an already-applied reset returns ok; otherwise refuse.
            return { ok: true, duplicate: true, leagueTokens: me.leagueTokens };
        }
        if (me.leagueTokens > 0)
            throw new https_1.HttpsError("failed-precondition", "Resets are only for an empty wallet.");
        if (!loans.empty)
            throw new https_1.HttpsError("failed-precondition", "Settle your loans first.");
        if (!open.empty)
            throw new https_1.HttpsError("failed-precondition", "Wait for your open picks to settle.");
        const amount = Math.max(1, Math.floor(league.get("startingLeagueTokens") * exports.RESET_SHARE));
        tx.update(ref, {
            [`members.${uid}.leagueTokens`]: amount,
            [`members.${uid}.resetUsed`]: true,
            [`members.${uid}.resetAt`]: now,
            lastActivityAt: now,
        });
        activity(tx, input.leagueId, `reset_${uid}`, {
            type: "reset",
            uid,
            name: me.displayName,
            text: `${me.displayName} took a fresh start`,
        });
        return { ok: true, leagueTokens: amount };
    });
});
//# sourceMappingURL=leagues.js.map
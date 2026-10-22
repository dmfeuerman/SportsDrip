import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, pairId, requireAuth, type Tx } from "../lib/economy";
import {
  BANK_INTERVAL_MAX_H,
  BANK_INTERVAL_MIN_H,
  BANK_PRINCIPAL_CAP_MULTIPLIER,
  BANK_RATE_MAX,
  BANK_RATE_MIN,
  BUY_IN_OPTIONS,
  DURATIONS,
  MAX_MEMBERS,
  MAX_OPEN_REQUESTS,
  MEMBER_COLORS,
  MIN_LEAGUE_STAKE,
  PEER_LOAN_MAX_PCT,
  PEER_RATE_MAX,
  PRIZE_PRESETS,
  SPORTS,
  TOKEN_START_OPTIONS,
  randomCode,
} from "../lib/leagueConfig";
import {
  applyRepayment,
  loanSnapshot,
  newLoanTerms,
  type LeagueLoanLike,
  type LoanTerms,
} from "../lib/loanMath";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { payoutFor } from "../lib/settlement";
import { finalizeLeague, payoutLeague } from "../lib/leagueLifecycle";

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
 *   leagues/{id}/loans/{loanId}     bank and peer loans, simple interest
 *   leagues/{id}/activity/{id}      feed
 *   leagueInvites/{code}            code -> league lookup
 */

const leagueRef = (id: string) => db.collection("leagues").doc(id);
const userRef = (uid: string) => db.collection("users").doc(uid);

interface MemberDoc {
  uid: string;
  displayName: string;
  avatarColor: string;
  leagueTokens: number;
  startingLeagueTokens: number;
  joinedAt: number;
  betsWon: number;
  betsLost: number;
  betsPush: number;
}

function member(league: FirebaseFirestore.DocumentSnapshot, uid: string): MemberDoc | null {
  const m = league.get(`members.${uid}`) as MemberDoc | undefined;
  return m ?? null;
}

function requireActiveLeague(league: FirebaseFirestore.DocumentSnapshot, now: number) {
  if (!league.exists) throw new HttpsError("not-found", "League not found.");
  if (league.get("status") !== "active") throw new HttpsError("failed-precondition", "That league has ended.");
  const endsAt = league.get("endsAt") as number;
  if (endsAt && now >= endsAt) throw new HttpsError("failed-precondition", "That league's season is over.");
}

function requireMember(league: FirebaseFirestore.DocumentSnapshot, uid: string): MemberDoc {
  const m = member(league, uid);
  if (!m) throw new HttpsError("permission-denied", "You're not in this league.");
  return m;
}

function termsOf(d: FirebaseFirestore.DocumentSnapshot): LoanTerms {
  return {
    principal: d.get("principal") as number,
    principalOutstanding: d.get("principalOutstanding") as number,
    interestAccrued: (d.get("interestAccrued") as number) ?? 0,
    interestPaid: (d.get("interestPaid") as number) ?? 0,
    accruedThrough: d.get("accruedThrough") as number,
    ratePct: d.get("ratePct") as number,
    intervalHours: d.get("intervalHours") as number,
  };
}

function loanOf(d: FirebaseFirestore.DocumentSnapshot): LeagueLoanLike {
  return {
    ...termsOf(d),
    kind: d.get("kind"),
    status: d.get("status"),
    borrowerId: d.get("borrowerId"),
    lenderId: d.get("lenderId") ?? null,
  };
}

function activity(
  tx: Tx,
  leagueId: string,
  id: string,
  entry: { type: string; uid: string; name: string; text: string; amount?: number }
) {
  tx.set(leagueRef(leagueId).collection("activity").doc(id), { amount: 0, ...entry, at: Date.now() });
}

async function profileName(tx: Tx, uid: string): Promise<string> {
  const p = await tx.get(userRef(uid));
  if (!p.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
  return (p.get("displayName") as string) || (p.get("username") as string) || "Player";
}

const Key = z.string().min(8).max(64);
const Money = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------------------------------------------------------------------------
// Create / join / leave
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  idempotencyKey: Key,
  name: z.string().trim().min(1).max(40),
  startingLeagueTokens: z.number().int().refine((n) => (TOKEN_START_OPTIONS as readonly number[]).includes(n)),
  duration: z.enum(Object.keys(DURATIONS) as [keyof typeof DURATIONS, ...(keyof typeof DURATIONS)[]]),
  sports: z.array(z.enum(SPORTS)).min(1).max(SPORTS.length),
  buyIn: z.number().int().refine((n) => (BUY_IN_OPTIONS as readonly number[]).includes(n)),
  prizePreset: z.enum(["winner-all", "top-2", "top-3"]),
  bankLoanEnabled: z.boolean(),
  bankInterestRate: z.number().min(BANK_RATE_MIN).max(BANK_RATE_MAX),
  bankInterestIntervalHours: z.number().int().min(BANK_INTERVAL_MIN_H).max(BANK_INTERVAL_MAX_H),
});

export const createLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = CreateInput.parse(req.data);
  const leagueId = `lg_${uid.slice(0, 8)}_${input.idempotencyKey}`;
  const ref = leagueRef(leagueId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      return { ok: true, leagueId, code: existing.get("code") as string, duplicate: true };
    }
    const name = await profileName(tx, uid);

    // Find an unused code. Reads all happen before any write.
    let code: string | null = null;
    for (let i = 0; i < 6 && !code; i++) {
      const candidate = randomCode();
      const snap = await tx.get(db.collection("leagueInvites").doc(candidate));
      if (!snap.exists) code = candidate;
    }
    if (!code) throw new HttpsError("unavailable", "Couldn't allocate an invite code. Try again.");

    if (input.buyIn > 0) {
      await applyCredits(tx, uid, {
        delta: -input.buyIn,
        type: "league_buy_in",
        idempotencyKey: `league_buyin_${leagueId}_${uid}`,
        ref: leagueId,
        note: input.name,
      });
    }

    const now = Date.now();
    const shares = PRIZE_PRESETS[input.prizePreset];
    const me: MemberDoc = {
      uid,
      displayName: name,
      avatarColor: MEMBER_COLORS[0]!,
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
      endsAt: now + DURATIONS[input.duration] * 86_400_000,
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
    tx.set(db.collection("leagueInvites").doc(code), {
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

export const joinLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const code = z.string().trim().toUpperCase().min(4).max(8).parse(req.data?.code);

  return db.runTransaction(async (tx) => {
    const invite = await tx.get(db.collection("leagueInvites").doc(code));
    if (!invite.exists) throw new HttpsError("not-found", "No league with that code. Check it and try again.");
    const leagueId = invite.get("leagueId") as string;
    const league = await tx.get(leagueRef(leagueId));
    const now = Date.now();

    if (member(league, uid)) return { ok: true, leagueId, duplicate: true };
    requireActiveLeague(league, now);

    const former = (league.get("formerMemberIds") as string[] | undefined) ?? [];
    if (former.includes(uid)) {
      throw new HttpsError("failed-precondition", "You left this league, so you can't rejoin it.");
    }
    const memberIds = (league.get("memberIds") as string[]) ?? [];
    if (memberIds.length >= MAX_MEMBERS) throw new HttpsError("resource-exhausted", "That league is full.");

    const name = await profileName(tx, uid);
    const buyIn = (league.get("buyIn") as number) ?? 0;
    if (buyIn > 0) {
      await applyCredits(tx, uid, {
        delta: -buyIn,
        type: "league_buy_in",
        idempotencyKey: `league_buyin_${leagueId}_${uid}`,
        ref: leagueId,
        note: league.get("name") as string,
      });
    }

    const used = new Set(
      Object.values((league.get("members") as Record<string, MemberDoc>) ?? {}).map((m) => m.avatarColor)
    );
    const color = MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[memberIds.length % MEMBER_COLORS.length]!;
    const start = league.get("startingLeagueTokens") as number;

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
      } satisfies MemberDoc,
      memberIds: FieldValue.arrayUnion(uid),
      pot: FieldValue.increment(buyIn),
      lastActivityAt: now,
    });
    activity(tx, leagueId, `join_${uid}`, { type: "joined", uid, name, text: `${name} joined` });
    return { ok: true, leagueId, duplicate: false };
  });
});

export const leaveLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const leagueId = z.string().min(1).parse(req.data?.leagueId);
  const ref = leagueRef(leagueId);

  return db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    const me = requireMember(league, uid);

    const [loans, bets] = await Promise.all([
      tx.get(ref.collection("loans").where("status", "in", ["active", "requested", "countered"])),
      tx.get(ref.collection("leagueBets").where("uid", "==", uid).where("status", "==", "pending")),
    ]);

    const active = league.get("status") === "active";
    if (active) {
      const tied = loans.docs.filter(
        (d) => d.get("status") === "active" && (d.get("borrowerId") === uid || d.get("lenderId") === uid)
      );
      if (tied.length) {
        throw new HttpsError("failed-precondition", "Settle your loans before leaving — repay what you owe and collect what you're owed.");
      }
      if (!bets.empty) {
        throw new HttpsError("failed-precondition", "You have open league bets. Wait for them to settle first.");
      }
    }

    const memberIds = ((league.get("memberIds") as string[]) ?? []).filter((m) => m !== uid);
    if (active && memberIds.length === 0 && ((league.get("pot") as number) ?? 0) > 0) {
      throw new HttpsError("failed-precondition", "You're the last member and there's a pot — end the league instead so it pays out.");
    }

    // Open requests made by the leaver can't be funded any more.
    for (const d of loans.docs) {
      if (d.get("borrowerId") === uid && d.get("status") !== "active") {
        tx.update(d.ref, { status: "cancelled", updatedAt: Date.now() });
      }
    }

    const update: Record<string, unknown> = {
      [`members.${uid}`]: FieldValue.delete(),
      memberIds: FieldValue.arrayRemove(uid),
      formerMemberIds: FieldValue.arrayUnion(uid),
      lastActivityAt: Date.now(),
    };
    if (league.get("creatorId") === uid && memberIds.length > 0) {
      const members = (league.get("members") as Record<string, MemberDoc>) ?? {};
      const heir = memberIds
        .map((id) => members[id])
        .filter((m): m is MemberDoc => !!m)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (heir) update.creatorId = heir.uid;
    }
    if (memberIds.length === 0) update.status = "ended";
    tx.update(ref, update);
    activity(tx, leagueId, `leave_${uid}_${Date.now()}`, { type: "left", uid, name: me.displayName, text: `${me.displayName} left` });
    return { ok: true };
  });
});

// ---------------------------------------------------------------------------
// Settings, invites, ending
// ---------------------------------------------------------------------------

export const updateLeagueSettings = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      bankLoanEnabled: z.boolean(),
      bankInterestRate: z.number().min(BANK_RATE_MIN).max(BANK_RATE_MAX),
      bankInterestIntervalHours: z.number().int().min(BANK_INTERVAL_MIN_H).max(BANK_INTERVAL_MAX_H),
    })
    .parse(req.data);

  return db.runTransaction(async (tx) => {
    const league = await tx.get(leagueRef(input.leagueId));
    requireActiveLeague(league, Date.now());
    if (league.get("creatorId") !== uid) {
      throw new HttpsError("permission-denied", "Only the league creator can change the bank.");
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
        ? `Bank terms: ${input.bankInterestRate}% simple per ${input.bankInterestIntervalHours}h on new loans`
        : "The bank is closed to new loans",
    });
    return { ok: true };
  });
});

export const inviteToLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { leagueId, friendUid } = z
    .object({ leagueId: z.string().min(1), friendUid: z.string().min(1) })
    .parse(req.data);

  return db.runTransaction(async (tx) => {
    const [league, friendship] = await Promise.all([
      tx.get(leagueRef(leagueId)),
      tx.get(db.collection("friendships").doc(pairId(uid, friendUid))),
    ]);
    requireActiveLeague(league, Date.now());
    const me = requireMember(league, uid);
    if (!friendship.exists) throw new HttpsError("permission-denied", "You can only invite friends.");
    if (member(league, friendUid)) return { ok: true, status: "already_member" as const };

    const name = league.get("name") as string;
    writeNotification(
      tx,
      friendUid,
      simpleNotification({
        id: `invite_${leagueId}_${uid}`,
        type: "league_invite",
        title: `${me.displayName} invited you to ${name}`,
        body: (league.get("buyIn") as number) > 0
          ? `Buy-in ${(league.get("buyIn") as number).toLocaleString("en-US")} credits. Code ${league.get("code")}.`
          : `Free to join. Code ${league.get("code")}.`,
        now: Date.now(),
        leagueId,
        leagueName: name,
        data: { code: league.get("code") as string, leagueId },
      })
    );
    return { ok: true, status: "sent" as const };
  });
});

export const endLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const leagueId = z.string().min(1).parse(req.data?.leagueId);
  const snap = await leagueRef(leagueId).get();
  if (!snap.exists) throw new HttpsError("not-found", "League not found.");
  requireMember(snap, uid);
  const expired = Date.now() >= ((snap.get("endsAt") as number) ?? 0);
  if (snap.get("creatorId") !== uid && !expired) {
    throw new HttpsError("permission-denied", "Only the creator can end the league early.");
  }
  const results = await finalizeLeague(leagueId, Date.now());
  await payoutLeague(leagueId);
  return { ok: true, results };
});

// ---------------------------------------------------------------------------
// League bets
// ---------------------------------------------------------------------------

const LeagueBetInput = z.object({
  leagueId: z.string().min(1),
  gameId: z.string().min(1),
  side: z.enum(["home", "away"]),
  stake: Money(MIN_LEAGUE_STAKE, 10_000_000),
  idempotencyKey: Key,
  expectedOdds: z.number().positive().max(100).optional(),
});

export const placeLeagueBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = LeagueBetInput.parse(req.data);
  const ref = leagueRef(input.leagueId);
  const betId = `${uid}_${input.idempotencyKey}`;
  const betRef = ref.collection("leagueBets").doc(betId);

  return db.runTransaction(async (tx) => {
    const [existing, league, game] = await Promise.all([
      tx.get(betRef),
      tx.get(ref),
      tx.get(db.collection("games").doc(input.gameId)),
    ]);
    if (existing.exists) return { ok: true, betId, duplicate: true, leagueTokens: null };

    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);

    if (!game.exists) throw new HttpsError("not-found", "That game is no longer available.");
    if (game.get("status") !== "upcoming") throw new HttpsError("failed-precondition", "Betting is closed for this game.");
    const startsAt = (game.get("startsAt") as number) ?? 0;
    if (startsAt && startsAt < now) throw new HttpsError("failed-precondition", "This game has already started.");
    if (startsAt && startsAt >= (league.get("endsAt") as number)) {
      throw new HttpsError("failed-precondition", "That game starts after this league's season ends.");
    }
    const allowed = (league.get("allowedSports") as string[]) ?? [];
    if (!allowed.includes(game.get("sport") as string)) {
      throw new HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
    }
    if (input.stake > me.leagueTokens) throw new HttpsError("failed-precondition", "Not enough league tokens.");

    const team = game.get(input.side === "home" ? "homeTeam" : "awayTeam") as {
      name: string;
      abbreviation: string;
      color: string;
      odds: number;
    };
    const opp = game.get(input.side === "home" ? "awayTeam" : "homeTeam") as { abbreviation: string };
    if (input.expectedOdds && team.odds < input.expectedOdds * 0.95) {
      throw new HttpsError("aborted", `The price moved to ${team.odds.toFixed(2)}x. Tap again to take it.`);
    }

    const potentialPayout = payoutFor(input.stake, team.odds);
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

export const takeBankLoan = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({ leagueId: z.string().min(1), amount: Money(10, 10_000_000), idempotencyKey: Key })
    .parse(req.data);
  const ref = leagueRef(input.leagueId);
  const loanRef = ref.collection("loans").doc(`bank_${uid}_${input.idempotencyKey}`);

  return db.runTransaction(async (tx) => {
    const [existing, league, mine] = await Promise.all([
      tx.get(loanRef),
      tx.get(ref),
      tx.get(ref.collection("loans").where("borrowerId", "==", uid).where("status", "==", "active")),
    ]);
    if (existing.exists) return { ok: true, loanId: loanRef.id, duplicate: true };

    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);
    if (!league.get("bankLoanEnabled")) throw new HttpsError("failed-precondition", "The league bank is closed.");

    const cap = Math.floor((league.get("startingLeagueTokens") as number) * BANK_PRINCIPAL_CAP_MULTIPLIER);
    const outstanding = mine.docs
      .filter((d) => d.get("kind") === "bank")
      .reduce((s, d) => s + ((d.get("principalOutstanding") as number) ?? 0), 0);
    if (outstanding + input.amount > cap) {
      throw new HttpsError(
        "failed-precondition",
        `The bank lends up to ${cap.toLocaleString("en-US")} in principal. You can borrow ${Math.max(0, cap - outstanding).toLocaleString("en-US")} more.`
      );
    }

    const rate = league.get("bankInterestRate") as number;
    const interval = league.get("bankInterestIntervalHours") as number;
    tx.set(loanRef, {
      id: loanRef.id,
      leagueId: input.leagueId,
      kind: "bank",
      borrowerId: uid,
      borrowerName: me.displayName,
      lenderId: null,
      lenderName: "League Bank",
      status: "active",
      ...newLoanTerms(input.amount, rate, interval, now),
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
      text: `${me.displayName} borrowed ${input.amount.toLocaleString("en-US")} from the bank at ${rate}% per ${interval}h`,
    });
    return { ok: true, loanId: loanRef.id, duplicate: false };
  });
});

/** Repays a bank or peer loan the caller owes. Interest first, then principal. */
export const repayLoan = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      loanId: z.string().min(1),
      amount: Money(1, 100_000_000),
      idempotencyKey: Key,
    })
    .parse(req.data);
  const ref = leagueRef(input.leagueId);
  const loanRef = ref.collection("loans").doc(input.loanId);
  const receiptRef = ref.collection("activity").doc(`repay_${input.loanId}_${input.idempotencyKey}`);

  return db.runTransaction(async (tx) => {
    const [receipt, league, loan] = await Promise.all([tx.get(receiptRef), tx.get(ref), tx.get(loanRef)]);
    if (receipt.exists) return { ok: true, duplicate: true, applied: receipt.get("amount") as number };

    const wall = Date.now();
    requireActiveLeague(league, wall);
    const me = requireMember(league, uid);
    if (!loan.exists) throw new HttpsError("not-found", "Loan not found.");
    if (loan.get("borrowerId") !== uid) throw new HttpsError("permission-denied", "That isn't your loan.");
    if (loan.get("status") !== "active") throw new HttpsError("failed-precondition", "That loan is already settled.");

    const now = Math.min(wall, league.get("endsAt") as number);
    const pay = Math.min(input.amount, me.leagueTokens);
    if (pay <= 0) throw new HttpsError("failed-precondition", "You have no league tokens to repay with.");
    const res = applyRepayment(termsOf(loan), pay, now);
    if (res.applied <= 0) throw new HttpsError("failed-precondition", "Nothing is owed on that loan.");

    const lenderId = loan.get("lenderId") as string | null;
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
    const update: Record<string, unknown> = {
      [`members.${uid}.leagueTokens`]: me.leagueTokens - res.applied,
      lastActivityAt: wall,
    };
    if (lender) update[`members.${lenderId}.leagueTokens`] = FieldValue.increment(res.applied);
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
      writeNotification(
        tx,
        lenderId,
        simpleNotification({
          id: `repay_${input.loanId}_${input.idempotencyKey}`,
          type: "loan_repaid",
          title: `${me.displayName} paid you back`,
          body: `+${res.applied.toLocaleString("en-US")} league tokens in ${league.get("name")}${res.settled ? ". Loan closed." : "."}`,
          delta: res.applied,
          balanceAfter: lender.leagueTokens + res.applied,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName: league.get("name") as string,
          now: wall,
        })
      );
    }

    return {
      ok: true,
      duplicate: false,
      applied: res.applied,
      toInterest: res.toInterest,
      toPrincipal: res.toPrincipal,
      settled: res.settled,
      remaining: loanSnapshot(res.loan, now).totalOwed,
    };
  });
});

// ---------------------------------------------------------------------------
// Peer loans
// ---------------------------------------------------------------------------

export const requestPeerLoan = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      amount: Money(10, 10_000_000),
      rate: z.number().gt(0).max(PEER_RATE_MAX),
      message: z.string().trim().max(80).optional(),
      idempotencyKey: Key,
    })
    .parse(req.data);
  const ref = leagueRef(input.leagueId);
  const loanRef = ref.collection("loans").doc(`peer_${uid}_${input.idempotencyKey}`);

  return db.runTransaction(async (tx) => {
    const [existing, league, open] = await Promise.all([
      tx.get(loanRef),
      tx.get(ref),
      tx.get(ref.collection("loans").where("borrowerId", "==", uid).where("status", "in", ["requested", "countered"])),
    ]);
    if (existing.exists) return { ok: true, loanId: loanRef.id, duplicate: true };

    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);
    const max = Math.floor((league.get("startingLeagueTokens") as number) * PEER_LOAN_MAX_PCT);
    if (input.amount > max) {
      throw new HttpsError("failed-precondition", `Peer loans are capped at ${max.toLocaleString("en-US")}.`);
    }
    if (open.size >= MAX_OPEN_REQUESTS) {
      throw new HttpsError("resource-exhausted", "You already have three open requests.");
    }
    if (((league.get("memberIds") as string[]) ?? []).length < 2) {
      throw new HttpsError("failed-precondition", "Invite someone first — there's nobody to lend to you yet.");
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
      ...newLoanTerms(input.amount, rate, league.get("bankInterestIntervalHours") as number, now),
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
    for (const other of (league.get("memberIds") as string[]).filter((m) => m !== uid)) {
      writeNotification(
        tx,
        other,
        simpleNotification({
          id: `loanreq_${loanRef.id}`,
          type: "loan_request",
          title: `${me.displayName} wants a loan`,
          body: `${input.amount.toLocaleString("en-US")} league tokens at ${rate}% per ${league.get("bankInterestIntervalHours")}h in ${league.get("name")}.`,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName: league.get("name") as string,
          now,
        })
      );
    }
    return { ok: true, loanId: loanRef.id, duplicate: false };
  });
});

const PeerAction = z.object({
  leagueId: z.string().min(1),
  loanId: z.string().min(1),
  action: z.enum(["fund", "counter", "decline", "cancel", "accept_counter", "reject_counter"]),
  rate: z.number().gt(0).max(PEER_RATE_MAX).optional(),
});

export const peerLoanAction = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = PeerAction.parse(req.data);
  const ref = leagueRef(input.leagueId);
  const loanRef = ref.collection("loans").doc(input.loanId);

  return db.runTransaction(async (tx) => {
    const [league, loan] = await Promise.all([tx.get(ref), tx.get(loanRef)]);
    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);
    if (!loan.exists || loan.get("kind") !== "peer") throw new HttpsError("not-found", "Loan request not found.");

    const status = loan.get("status") as string;
    const borrowerId = loan.get("borrowerId") as string;
    const borrower = member(league, borrowerId);
    const amount = loan.get("principal") as number;
    const leagueName = league.get("name") as string;
    const interval = loan.get("intervalHours") as number;
    const isBorrower = uid === borrowerId;

    const fund = (lenderId: string, rate: number) => {
      const lender = member(league, lenderId);
      if (!lender) throw new HttpsError("failed-precondition", "The lender has left the league.");
      if (!borrower) throw new HttpsError("failed-precondition", "The borrower has left the league.");
      if (lender.leagueTokens < amount) {
        throw new HttpsError("failed-precondition", `${lenderId === uid ? "You don't" : `${lender.displayName} doesn't`} have ${amount.toLocaleString("en-US")} league tokens to lend.`);
      }
      tx.update(loanRef, {
        status: "active",
        lenderId,
        lenderName: lender.displayName,
        ...newLoanTerms(amount, rate, interval, now),
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
      writeNotification(
        tx,
        target,
        simpleNotification({
          id: `funded_${loanRef.id}`,
          type: "loan_funded",
          title: lenderId === uid ? `${lender.displayName} funded your loan` : `${borrower.displayName} took your offer`,
          body: `${amount.toLocaleString("en-US")} league tokens at ${rate}% per ${interval}h, simple interest.`,
          delta: lenderId === uid ? amount : -amount,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName,
          now,
          popup: lenderId === uid,
        })
      );
    };

    switch (input.action) {
      case "fund": {
        if (isBorrower) throw new HttpsError("invalid-argument", "You can't fund your own request.");
        if (status !== "requested") throw new HttpsError("failed-precondition", "That request isn't open.");
        fund(uid, loan.get("proposedRate") as number);
        break;
      }
      case "counter": {
        if (isBorrower) throw new HttpsError("invalid-argument", "You can't counter your own request.");
        if (status !== "requested") throw new HttpsError("failed-precondition", "That request isn't open.");
        if (!input.rate) throw new HttpsError("invalid-argument", "Counter with a rate.");
        const rate = Math.round(input.rate * 100) / 100;
        tx.update(loanRef, { status: "countered", counterRate: rate, counterBy: uid, counterByName: me.displayName, updatedAt: now });
        writeNotification(
          tx,
          borrowerId,
          simpleNotification({
            id: `counter_${loanRef.id}_${uid}`,
            type: "loan_countered",
            title: `${me.displayName} countered at ${rate}%`,
            body: `For your ${amount.toLocaleString("en-US")} request in ${leagueName}. Accept or reject it in the league.`,
            wallet: "league",
            leagueId: input.leagueId,
            leagueName,
            now,
          })
        );
        break;
      }
      case "decline": {
        if (isBorrower) throw new HttpsError("invalid-argument", "Cancel your own request instead.");
        if (status !== "requested") throw new HttpsError("failed-precondition", "That request isn't open.");
        const declined = new Set<string>([...((loan.get("declinedBy") as string[]) ?? []), uid]);
        const others = ((league.get("memberIds") as string[]) ?? []).filter((m) => m !== borrowerId);
        const everyone = others.every((m) => declined.has(m));
        tx.update(loanRef, {
          declinedBy: [...declined],
          status: everyone ? "rejected" : "requested",
          updatedAt: now,
        });
        break;
      }
      case "cancel": {
        if (!isBorrower) throw new HttpsError("permission-denied", "Only the borrower can cancel.");
        if (status !== "requested" && status !== "countered") throw new HttpsError("failed-precondition", "That request can't be cancelled.");
        tx.update(loanRef, { status: "cancelled", updatedAt: now });
        break;
      }
      case "accept_counter": {
        if (!isBorrower) throw new HttpsError("permission-denied", "Only the borrower can accept.");
        if (status !== "countered") throw new HttpsError("failed-precondition", "There's no counter-offer to accept.");
        fund(loan.get("counterBy") as string, loan.get("counterRate") as number);
        break;
      }
      case "reject_counter": {
        if (!isBorrower) throw new HttpsError("permission-denied", "Only the borrower can reject.");
        if (status !== "countered") throw new HttpsError("failed-precondition", "There's no counter-offer to reject.");
        // Back on the market at the original rate for everyone else.
        tx.update(loanRef, {
          status: "requested",
          counterRate: null,
          counterBy: null,
          counterByName: null,
          declinedBy: FieldValue.arrayUnion(loan.get("counterBy") as string),
          updatedAt: now,
        });
        break;
      }
    }
    return { ok: true };
  });
});


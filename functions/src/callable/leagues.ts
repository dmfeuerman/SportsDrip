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
  DURATION_KEYS,
  endsAtFor,
  FULL_SEASON,
  LEAGUE_MODES,
  MATCHUP_CADENCES,
  MAX_MEMBERS,
  MAX_OPEN_REQUESTS,
  MEMBER_COLORS,
  MIN_LEAGUE_STAKE,
  PEER_LOAN_MAX_PCT,
  peerLoanRequestsEnabled,
  PEER_RATE_MAX,
  PRIZE_PRESETS,
  SPORTS,
  STIMULUS_COOLDOWN_MS,
  STIMULUS_PCTS,
  STIMULUS_TTL_MS,
  TOKEN_START_OPTIONS,
  randomCode,
  weeksBetween,
  type LeagueMode,
} from "../lib/leagueConfig";
import {
  applyRepayment,
  loanSnapshot,
  newLoanTerms,
  totalRepayable,
  type LeagueLoanLike,
  type LoanTerms,
} from "../lib/loanMath";
import { writeNotification } from "../lib/notify";
import { followNotification, simpleNotification } from "../lib/notifyModel";
import { payoutFor, type Market, type Selection } from "../lib/settlement";
import { requirePricedMarket, type PricedMarketSelection } from "../lib/pricing";
import { finalizeLeague, payoutLeague } from "../lib/leagueLifecycle";
import { advanceStreak, type StreakState } from "../lib/streak";
import { checkPlayLimits } from "../lib/playLimits";
import { weekKey } from "../lib/weekly";

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

const leagueRef = (id: string) => db.collection("leagues").doc(id);
const userRef = (uid: string) => db.collection("users").doc(uid);

export interface MemberDoc {
  uid: string;
  displayName: string;
  avatarColor: string;
  leagueTokens: number;
  startingLeagueTokens: number;
  joinedAt: number;
  betsWon: number;
  betsLost: number;
  betsPush: number;
  locksWon?: number;
  locksLost?: number;
  locksPush?: number;
  lastLockWeek?: string | null;
  pickPoints?: number;
  eliminated?: boolean;
  eliminatedAt?: number | null;
  eliminatedWeek?: string | null;
  usedTeams?: string[];
  h2h?: { w: number; l: number; t: number };
}

export interface GameSideEntry {
  betId: string;
  uid: string;
  name: string;
  displayName: string;
  side: "home" | "away" | null;
  market: Market;
  selection: Selection;
  line: number | null;
  label: string;
  teamAbbr: string;
  stake: number;
  payout: number;
  odds: number;
  lock: boolean;
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

export function loanOf(d: FirebaseFirestore.DocumentSnapshot): LeagueLoanLike {
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
  tx.set(leagueRef(leagueId).collection("activity").doc(id), {
    amount: 0,
    reactions: {},
    reactors: {},
    ...entry,
    at: Date.now(),
  });
}

function writeAudit(
  tx: Tx,
  leagueId: string,
  id: string,
  entry: {
    action: string;
    uid: string;
    name: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
    betId?: string | null;
    vote?: boolean;
    votes?: number;
    needed?: number;
    at?: number;
  }
) {
  tx.set(leagueRef(leagueId).collection("audit").doc(id), {
    before: null,
    after: null,
    reason: null,
    betId: null,
    ...entry,
    at: entry.at ?? Date.now(),
  });
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
  duration: z.enum(DURATION_KEYS),
  sports: z.array(z.enum(SPORTS)).min(1).max(SPORTS.length),
  buyIn: z.number().int().refine((n) => (BUY_IN_OPTIONS as readonly number[]).includes(n)),
  prizePreset: z.enum(["winner-all", "top-2", "top-3"]),
  bankLoanEnabled: z.boolean(),
  bankInterestRate: z.number().min(BANK_RATE_MIN).max(BANK_RATE_MAX),
  bankInterestIntervalHours: z.number().int().min(BANK_INTERVAL_MIN_H).max(BANK_INTERVAL_MAX_H).default(24),
  mode: z.enum(LEAGUE_MODES).default("bankroll"),
  matchupsEnabled: z.boolean().default(false),
  matchupCadence: z.enum(MATCHUP_CADENCES).default("weekly"),
  stimulusEnabled: z.boolean().default(false),
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

    const endsAt = endsAtFor(input.duration, input.sports, now);
    tx.set(ref, {
      schemaVersion: 2,
      id: leagueId,
      name: input.name,
      code,
      mode: input.mode as LeagueMode,
      // An H2H league is nothing but matchups.
      matchupsEnabled: input.mode === "matchups" || Boolean(input.matchupsEnabled),
      matchupCadence: input.matchupCadence,
      stimulusEnabled: input.stimulusEnabled,
      stimulus: null,
      createdAt: now,
      endsAt,
      duration: input.duration,
      durationWeeks: weeksBetween(now, endsAt),
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
    requireActiveLeague(league, Date.now());
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

    for (const d of loans.docs) {
      if (d.get("borrowerId") === uid && d.get("status") !== "active") {
        tx.update(d.ref, { status: "cancelled", updatedAt: Date.now() });
      }
    }

    const update: Record<string, unknown> = {
      [`members.${uid}`]: FieldValue.delete(),
      memberIds: FieldValue.arrayRemove(uid),
      formerMemberIds: FieldValue.arrayUnion(uid),
      endVotes: FieldValue.arrayRemove(uid),
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
// Settings, audit log, invites, early end voting, disputes & voids
// ---------------------------------------------------------------------------

const UpdateSettingsInput = z.object({
  leagueId: z.string().min(1),
  bankLoanEnabled: z.boolean().optional(),
  bankInterestRate: z.number().min(BANK_RATE_MIN).max(BANK_RATE_MAX).optional(),
  bankInterestIntervalHours: z.number().int().min(BANK_INTERVAL_MIN_H).max(BANK_INTERVAL_MAX_H).optional(),
  name: z.string().trim().min(1).max(40).optional(),
  sports: z.array(z.enum(SPORTS)).min(1).max(SPORTS.length).optional(),
  prizePreset: z.enum(["winner-all", "top-2", "top-3"]).optional(),
  duration: z.enum(DURATION_KEYS).optional(),
  mode: z.enum(LEAGUE_MODES).optional(),
  matchupsEnabled: z.boolean().optional(),
  matchupCadence: z.enum(MATCHUP_CADENCES).optional(),
  /** Not a locked rule: the creator can open or close stimulus votes any time. */
  stimulusEnabled: z.boolean().optional(),
});

export const updateLeagueSettings = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = UpdateSettingsInput.parse(req.data);
  const ref = leagueRef(input.leagueId);

  const touchingRules =
    input.name !== undefined ||
    input.sports !== undefined ||
    input.prizePreset !== undefined ||
    input.duration !== undefined ||
    input.mode !== undefined ||
    input.matchupsEnabled !== undefined ||
    input.matchupCadence !== undefined;

  return db.runTransaction(async (tx) => {
    const [league, anyBets, anyPicks] = await Promise.all([
      tx.get(ref),
      touchingRules ? tx.get(ref.collection("leagueBets").limit(1)) : Promise.resolve(null),
      touchingRules ? tx.get(ref.collection("picks").limit(1)) : Promise.resolve(null),
    ]);
    const now = Date.now();
    requireActiveLeague(league, now);
    if (league.get("creatorId") !== uid) {
      throw new HttpsError("permission-denied", "Only the league creator can change the bank or rules.");
    }
    const me = requireMember(league, uid);

    if (touchingRules && ((anyBets && !anyBets.empty) || (anyPicks && !anyPicks.empty))) {
      throw new HttpsError(
        "failed-precondition",
        "League rules are locked once the first bet has been placed."
      );
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const update: Record<string, unknown> = { lastActivityAt: now };

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
    const nextDuration = input.duration ?? (league.get("duration") as string | undefined);
    if (input.duration !== undefined || (input.sports !== undefined && nextDuration === FULL_SEASON)) {
      const d = (input.duration ?? nextDuration) as (typeof DURATION_KEYS)[number];
      const sports = input.sports ?? ((league.get("allowedSports") as (typeof SPORTS)[number][] | undefined) ?? [...SPORTS]);
      const createdAt = (league.get("createdAt") as number | undefined) ?? now;
      before.duration = league.get("duration");
      after.duration = d;
      update.duration = d;
      update.endsAt = endsAtFor(d, sports, createdAt);
      update.durationWeeks = weeksBetween(createdAt, update.endsAt as number);
    }
    if (input.prizePreset !== undefined) {
      const shares = PRIZE_PRESETS[input.prizePreset];
      before.prizePreset = (league.get("prizeDistribution") as { preset?: string } | undefined)?.preset ?? null;
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
    if ((input.mode ?? league.get("mode")) === "matchups") update.matchupsEnabled = true;
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
      if (!input.stimulusEnabled) update.stimulus = null;
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
      text:
        input.bankLoanEnabled !== undefined
          ? input.bankLoanEnabled
            ? `Bank terms: ${input.bankInterestRate ?? league.get("bankInterestRate")}% flat on new loans`
            : "The bank is closed to new loans"
          : input.stimulusEnabled !== undefined && !touchingRules
            ? input.stimulusEnabled
              ? "Stimulus votes are open — anyone can ask the bank to top everyone up"
              : "Stimulus votes are closed"
            : `${me.displayName} updated the league rules`,
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
        popup: true,
        data: { code: league.get("code") as string, leagueId, fromUid: uid },
      })
    );
    return { ok: true, status: "sent" as const };
  });
});

/**
 * Casts or withdraws a member's vote to end the league early.
 * Once a strict majority (`Math.floor(memberCount / 2) + 1`) votes yes, the
 * league is finalized and paid out immediately.
 */
export const voteEndLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      vote: z.boolean().default(true),
    })
    .parse(req.data);
  const ref = leagueRef(input.leagueId);

  const outcome = await db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);

    const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
    const currentVotes = new Set<string>(
      ((league.get("endVotes") as string[] | undefined) ?? []).filter((id) => memberIds.includes(id))
    );
    if (input.vote) currentVotes.add(uid);
    else currentVotes.delete(uid);

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
    const results = await finalizeLeague(input.leagueId, Date.now());
    await payoutLeague(input.leagueId);
    return { ok: true, ended: true, votes: outcome.votes, needed: outcome.needed, results };
  }
  return { ok: true, ended: false, votes: outcome.votes, needed: outcome.needed, results: null };
});

export const endLeague = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const leagueId = z.string().min(1).parse(req.data?.leagueId);
  const snap = await leagueRef(leagueId).get();
  if (!snap.exists) throw new HttpsError("not-found", "League not found.");
  requireMember(snap, uid);

  const now = Date.now();
  const expired = now >= ((snap.get("endsAt") as number) ?? 0);
  if (snap.get("creatorId") !== uid && !expired) {
    throw new HttpsError("permission-denied", "Only the creator can end the league early.");
  }

  if (!expired) {
    const memberIds = (snap.get("memberIds") as string[] | undefined) ?? [];
    if (memberIds.length > 1) {
      const currentVotes = new Set<string>(
        ((snap.get("endVotes") as string[] | undefined) ?? []).filter((id) => memberIds.includes(id))
      );
      currentVotes.add(uid);
      const needed = Math.floor(memberIds.length / 2) + 1;
      if (currentVotes.size < needed) {
        throw new HttpsError(
          "failed-precondition",
          `Ending early requires a majority vote (${currentVotes.size}/${needed}). Have league members vote first.`
        );
      }
    }
  }

  const results = await finalizeLeague(leagueId, now);
  await payoutLeague(leagueId);
  return { ok: true, results };
});

/**
 * Flags a league bet result for commissioner review. Writes a dispute record on
 * the bet, logs it in `leagues/{id}/audit`, and notifies the commissioner.
 */
export const reportResult = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      betId: z.string().min(1),
      reason: z.string().trim().min(3).max(240),
    })
    .parse(req.data);

  const ref = leagueRef(input.leagueId);
  const betRef = ref.collection("leagueBets").doc(input.betId);

  return db.runTransaction(async (tx) => {
    const [league, bet] = await Promise.all([tx.get(ref), tx.get(betRef)]);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    const me = requireMember(league, uid);
    if (!bet.exists) throw new HttpsError("not-found", "Bet not found.");

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

    const creatorId = league.get("creatorId") as string;
    if (creatorId && creatorId !== uid) {
      writeNotification(
        tx,
        creatorId,
        simpleNotification({
          id: `dispute_${input.leagueId}_${input.betId}`,
          type: "dispute_reported",
          title: `Result flagged in ${league.get("name")}`,
          body: `${me.displayName} flagged ${bet.get("displayName")}'s ${bet.get("label") ?? bet.get("teamAbbr")} bet: "${input.reason}"`,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName: league.get("name") as string,
          now,
        })
      );
    }

    return { ok: true };
  });
});

/**
 * Commissioner action to void a pending or settled league bet with a logged
 * reason, restoring the member's league tokens to their pre-bet state.
 */
export const voidLeagueBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      betId: z.string().min(1),
      reason: z.string().trim().min(3).max(240),
    })
    .parse(req.data);

  const ref = leagueRef(input.leagueId);
  const betRef = ref.collection("leagueBets").doc(input.betId);

  return db.runTransaction(async (tx) => {
    const [league, bet] = await Promise.all([tx.get(ref), tx.get(betRef)]);
    const now = Date.now();
    requireActiveLeague(league, now);
    if (league.get("creatorId") !== uid) {
      throw new HttpsError("permission-denied", "Only the league commissioner can void a bet.");
    }
    const me = requireMember(league, uid);
    if (!bet.exists) throw new HttpsError("not-found", "Bet not found.");

    const status = bet.get("status") as string;
    if (status === "cancelled" || status === "void") {
      throw new HttpsError("failed-precondition", "That bet has already been voided.");
    }

    const gameId = bet.get("gameId") as string;
    const sidesRef = ref.collection("gameSides").doc(gameId);
    const sidesSnap = await tx.get(sidesRef);

    const betUid = bet.get("uid") as string;
    const targetMember = member(league, betUid);
    const stake = bet.get("stake") as number;
    const payout = bet.get("potentialPayout") as number;

    // Restore token balance:
    //  - pending or lost: stake was debited and nothing returned -> +stake
    //  - won: stake was debited and payout credited -> +(stake - payout)
    //  - push: stake was already returned -> 0
    const tokenDelta =
      status === "pending" || status === "lost"
        ? stake
        : status === "won"
          ? stake - payout
          : 0;

    const leagueUpdate: Record<string, unknown> = { lastActivityAt: now };
    if (targetMember) {
      if (tokenDelta !== 0) {
        leagueUpdate[`members.${betUid}.leagueTokens`] = FieldValue.increment(tokenDelta);
      }
      if (status === "won") leagueUpdate[`members.${betUid}.betsWon`] = FieldValue.increment(-1);
      if (status === "lost") leagueUpdate[`members.${betUid}.betsLost`] = FieldValue.increment(-1);
      if (status === "push") leagueUpdate[`members.${betUid}.betsPush`] = FieldValue.increment(-1);
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
      settledAt: FieldValue.serverTimestamp(),
    });

    if (sidesSnap.exists) {
      const entries = ((sidesSnap.get("entries") as GameSideEntry[] | undefined) ?? []).filter(
        (e) => e.betId !== input.betId
      );
      tx.set(
        sidesRef,
        {
          entries,
          home: entries.filter((e) => e.side === "home"),
          away: entries.filter((e) => e.side === "away"),
          updatedAt: now,
        },
        { merge: true }
      );
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
      writeNotification(
        tx,
        betUid,
        simpleNotification({
          id: `void_${input.leagueId}_${input.betId}`,
          type: "bet_voided",
          title: `Bet voided in ${league.get("name")}`,
          body: `${me.displayName} voided your ${bet.get("label") ?? bet.get("teamAbbr")} bet: "${input.reason}".`,
          delta: tokenDelta,
          balanceAfter: targetMember.leagueTokens + tokenDelta,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName: league.get("name") as string,
          now,
        })
      );
    }

    return { ok: true, tokenDelta };
  });
});

// ---------------------------------------------------------------------------
// League bets
// ---------------------------------------------------------------------------

const LeagueBetInput = z
  .object({
    leagueId: z.string().min(1),
    gameId: z.string().min(1),
    side: z.enum(["home", "away"]).optional(),
    market: z.enum(["ml", "spread", "total"]).optional(),
    selection: z.enum(["home", "away", "over", "under"]).optional(),
    stake: Money(MIN_LEAGUE_STAKE, 10_000_000),
    idempotencyKey: Key,
    expectedOdds: z.number().positive().max(100).optional(),
    expectedLine: z.number().finite().optional(),
    /** Another member's pending bet in this league, copied on the same side. */
    tailOf: z.string().min(1).max(200).optional(),
    /** Another member's pending bet in this league, opposed on the other side. */
    fadeOf: z.string().min(1).max(200).optional(),
    /** One Lock of the Week per member per week. */
    lock: z.boolean().optional(),
    /** Hide pick from chat and sweat tracker until kickoff. */
    hidden: z.boolean().optional(),
  })
  .refine((v) => !(v.tailOf && v.fadeOf), { message: "A bet can tail or fade, not both." })
  .refine((v) => !!(v.selection || v.side), { message: "Pick a side or selection." });

interface FollowSource {
  kind: "tail" | "fade";
  ref: FirebaseFirestore.DocumentReference;
  uid: string;
  name: string;
  teamAbbr: string;
}

function oppositeSelection(sel: Selection): Selection {
  if (sel === "home") return "away";
  if (sel === "away") return "home";
  if (sel === "over") return "under";
  return "over";
}

/**
 * Validates a tail/fade reference. The source must be another member's
 * still-pending bet in this same league, on this game, and the new bet must be
 * on the same selection (tail) or the opposite selection (fade).
 */
function followSource(
  source: FirebaseFirestore.DocumentSnapshot,
  kind: "tail" | "fade",
  leagueId: string,
  gameId: string,
  priced: PricedMarketSelection,
  uid: string
): FollowSource {
  const verb = kind === "tail" ? "tail" : "fade";
  if (!source.exists || source.get("leagueId") !== leagueId) {
    throw new HttpsError("not-found", `That bet isn't in this league any more, so you can't ${verb} it.`);
  }
  if (source.get("status") !== "pending") {
    throw new HttpsError("failed-precondition", `That bet has already settled — too late to ${verb} it.`);
  }
  if (source.get("uid") === uid) {
    throw new HttpsError("failed-precondition", `You can't ${verb} your own bet.`);
  }
  if (source.get("gameId") !== gameId) {
    throw new HttpsError("invalid-argument", "That bet is on a different game.");
  }
  const sourceMarket = (source.get("market") as Market | undefined) ?? "ml";
  const sourceSel =
    (source.get("selection") as Selection | undefined) ??
    (source.get("side") as "home" | "away");
  if (priced.market !== sourceMarket) {
    throw new HttpsError("invalid-argument", `A ${verb} must be in the same market (${sourceMarket}).`);
  }
  if (kind === "tail" && priced.selection !== sourceSel) {
    throw new HttpsError("invalid-argument", "A tail backs the same side.");
  }
  if (kind === "fade" && priced.selection !== oppositeSelection(sourceSel)) {
    throw new HttpsError("invalid-argument", "A fade backs the other side.");
  }
  const followers = (source.get("followers") as Record<string, string> | undefined) ?? {};
  if (followers[uid]) {
    throw new HttpsError("already-exists", `You've already ${followers[uid] === "tail" ? "tailed" : "faded"} this bet.`);
  }
  return {
    kind,
    ref: source.ref,
    uid: source.get("uid") as string,
    name: (source.get("displayName") as string) || "Player",
    teamAbbr: (source.get("label") as string) || (source.get("teamAbbr") as string),
  };
}

export const placeLeagueBet = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = LeagueBetInput.parse(req.data);
  const ref = leagueRef(input.leagueId);
  const betId = `${uid}_${input.idempotencyKey}`;
  const betRef = ref.collection("leagueBets").doc(betId);
  const sidesRef = ref.collection("gameSides").doc(input.gameId);

  const followId = input.tailOf ?? input.fadeOf ?? null;
  const followKind: "tail" | "fade" | null = input.tailOf ? "tail" : input.fadeOf ? "fade" : null;

  return db.runTransaction(async (tx) => {
    const [existing, league, game, sourceSnap, sidesSnap, uSnap] = await Promise.all([
      tx.get(betRef),
      tx.get(ref),
      tx.get(db.collection("games").doc(input.gameId)),
      followId ? tx.get(ref.collection("leagueBets").doc(followId)) : Promise.resolve(null),
      tx.get(sidesRef),
      tx.get(userRef(uid)),
    ]);
    if (existing.exists) return { ok: true, betId, duplicate: true, leagueTokens: null };

    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);
    const limitUpdate = uSnap.exists ? checkPlayLimits(uSnap, now) : {};

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

    const priced = requirePricedMarket(game, input);
    const follow =
      followKind && sourceSnap
        ? followSource(sourceSnap, followKind, input.leagueId, input.gameId, priced, uid)
        : null;

    const isLock = Boolean(input.lock);
    const wk = weekKey(startsAt || now);
    if (isLock && me.lastLockWeek === wk) {
      throw new HttpsError("failed-precondition", "You've already used your Lock of the Week.");
    }

    const isHidden = Boolean(input.hidden);
    const potentialPayout = payoutFor(input.stake, priced.odds);
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

    const leagueUpdate: Record<string, unknown> = {
      [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
      lastActivityAt: now,
    };
    if (isLock) {
      leagueUpdate[`members.${uid}.lastLockWeek`] = wk;
    }
    tx.update(ref, leagueUpdate);

    if (uSnap.exists) {
      const prevStreak = uSnap.get("streak") as Partial<StreakState> | undefined;
      tx.update(userRef(uid), { streak: advanceStreak(prevStreak, now), ...limitUpdate });
    }

    // Update sweat tracker aggregate when not hidden before kickoff.
    if (!isHidden) {
      const prevEntries = (sidesSnap.exists ? (sidesSnap.get("entries") as GameSideEntry[] | undefined) : undefined) ?? [];
      const entry: GameSideEntry = {
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
      tx.set(
        sidesRef,
        {
          gameId: input.gameId,
          leagueId: input.leagueId,
          sport: game.get("sport"),
          startsAt: startsAt || null,
          entries,
          home: entries.filter((e) => e.side === "home"),
          away: entries.filter((e) => e.side === "away"),
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const amount = input.stake.toLocaleString("en-US");
    const pickDisplay = priced.market === "ml" ? priced.teamAbbr : priced.label;
    const text = isHidden
      ? `${me.displayName} locked in a hidden pick (${amount} staked — reveals at kickoff)`
      : !follow
        ? `${me.displayName} put ${amount} on ${pickDisplay} (${priced.odds.toFixed(2)}x)${isLock ? " 🔒" : ""}`
        : follow.kind === "tail"
          ? `${me.displayName} tailed ${follow.name} on ${pickDisplay} with ${amount} (${priced.odds.toFixed(2)}x)`
          : `${me.displayName} faded ${follow.name} — ${amount} on ${pickDisplay} (${priced.odds.toFixed(2)}x)`;

    activity(tx, input.leagueId, `bet_${betId}`, {
      type: follow ? (follow.kind === "tail" ? "bet_tailed" : "bet_faded") : "bet_placed",
      uid,
      name: me.displayName,
      amount: input.stake,
      text,
    });

    // Auto-post bet card into league chat unless the bettor opted to hide until lock.
    if (!isHidden) {
      tx.set(ref.collection("messages").doc(`bet_${betId}`), {
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
        stake: input.stake,
        odds: priced.odds,
        potentialPayout,
        lock: isLock,
        at: now,
        reactions: {},
        reactors: {},
      });
    }

    if (follow) {
      tx.update(follow.ref, {
        [follow.kind === "tail" ? "tails" : "fades"]: FieldValue.increment(1),
        [`followers.${uid}`]: follow.kind,
      });
      writeNotification(
        tx,
        follow.uid,
        followNotification({
          kind: follow.kind,
          followerBetId: betId,
          sourceBetId: followId!,
          followerName: me.displayName,
          sourceTeamAbbr: follow.teamAbbr,
          followerTeamAbbr: pickDisplay,
          stake: input.stake,
          leagueId: input.leagueId,
          leagueName: league.get("name") as string,
          gameId: input.gameId,
          now,
        })
      );
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
export const LOAN_COOLDOWN_MS = 60 * 60_000;
function requireNoLossCooldown(league: FirebaseFirestore.DocumentSnapshot, uid: string, now: number) {
  const lastLoss = league.get(`members.${uid}.lastLossAt`) as number | undefined;
  if (lastLoss && now - lastLoss < LOAN_COOLDOWN_MS) {
    const mins = Math.ceil((LOAN_COOLDOWN_MS - (now - lastLoss)) / 60_000);
    throw new HttpsError("failed-precondition", `Loans cool down for an hour after a loss. Try again in ${mins} min.`);
  }
}

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
    requireNoLossCooldown(league, uid, now);

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
      text: `${me.displayName} borrowed ${input.amount.toLocaleString("en-US")} from the bank at ${rate}% flat`,
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
      reactions: {},
      reactors: {},
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
  if (!peerLoanRequestsEnabled()) throw new HttpsError("failed-precondition", "Loan requests are closed.");
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
      throw new HttpsError("failed-precondition", `Peer loan requests are capped at ${max.toLocaleString("en-US")} (50% of starting tokens).`);
    }
    if (open.size >= MAX_OPEN_REQUESTS) {
      throw new HttpsError("resource-exhausted", `You already have ${MAX_OPEN_REQUESTS} open loan requests.`);
    }

    const rate = Math.round(input.rate * 100) / 100;
    const interval = (league.get("bankInterestIntervalHours") as number) ?? 24;
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
      ...newLoanTerms(input.amount, rate, interval, now),
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

    const leagueName = league.get("name") as string;
    for (const memberId of (league.get("memberIds") as string[]) ?? []) {
      if (memberId === uid) continue;
      writeNotification(
        tx,
        memberId,
        simpleNotification({
          id: `loanreq_${loanRef.id}`,
          type: "loan_request",
          title: `${me.displayName} wants a loan in ${leagueName}`,
          body: `${input.amount.toLocaleString("en-US")} league tokens at ${rate}% flat${input.message ? ` — "${input.message}"` : ""}.`,
          wallet: "league",
          leagueId: input.leagueId,
          leagueName,
          now,
        })
      );
    }
    return { ok: true, loanId: loanRef.id, duplicate: false };
  });
});

export const peerLoanAction = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      loanId: z.string().min(1),
      action: z.enum(["fund", "counter", "decline", "cancel", "accept_counter", "reject_counter"]),
      rate: z.number().gt(0).max(PEER_RATE_MAX).optional(),
    })
    .parse(req.data);
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
    const isBorrower = borrowerId === uid;
    const amount = loan.get("principal") as number;
    const interval = (league.get("bankInterestIntervalHours") as number) ?? 24;
    const leagueName = league.get("name") as string;

    const fund = (lenderId: string, rate: number) => {
      const lender = member(league, lenderId);
      if (!lender) throw new HttpsError("failed-precondition", "The lender has left the league.");
      if (!borrower) throw new HttpsError("failed-precondition", "The borrower has left the league.");
      if (lender.leagueTokens < amount) {
        throw new HttpsError("failed-precondition", `${lenderId === uid ? "You don't" : `${lender.displayName} doesn't`} have ${amount.toLocaleString("en-US")} league tokens to lend.`);
      }
      const isBailout = borrower.leagueTokens < 100;
      tx.update(loanRef, {
        status: "active",
        lenderId,
        lenderName: lender.displayName,
        bailout: isBailout,
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
        type: isBailout ? "bailout" : "loan_funded",
        uid: lenderId,
        name: lender.displayName,
        amount,
        text: isBailout
          ? `${lender.displayName} bailed out ${borrower.displayName} with ${amount.toLocaleString("en-US")} at ${rate}%`
          : `${lender.displayName} lent ${borrower.displayName} ${amount.toLocaleString("en-US")} at ${rate}%`,
      });
      const target = lenderId === uid ? borrowerId : lenderId;
      writeNotification(
        tx,
        target,
        simpleNotification({
          id: `funded_${loanRef.id}`,
          type: "loan_funded",
          title: lenderId === uid ? `${lender.displayName} funded your loan` : `${borrower.displayName} took your offer`,
          body: `${amount.toLocaleString("en-US")} league tokens at ${rate}% flat. Repays ${totalRepayable(amount, rate).toLocaleString("en-US")} in total.`,
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

// ---------------------------------------------------------------------------
// Bank stimulus: a member asks the bank to top up every member's stack; it
// pays out once a majority votes yes. The creator turns this on or off
// (stimulusEnabled). The tokens are new money from the bank — nobody owes
// them back — and everyone gets the same amount, so the standings order holds.
// ---------------------------------------------------------------------------

export interface StimulusRequest {
  id: string;
  uid: string;
  name: string;
  pct: number;
  amount: number;
  votes: string[];
  createdAt: number;
  expiresAt: number;
}

const StimulusInput = z.discriminatedUnion("action", [
  z.object({ leagueId: z.string().min(1), action: z.literal("request"), pct: z.number().int().refine((n) => (STIMULUS_PCTS as readonly number[]).includes(n)) }),
  z.object({ leagueId: z.string().min(1), action: z.literal("vote"), requestId: z.string().min(1), approve: z.boolean() }),
  z.object({ leagueId: z.string().min(1), action: z.literal("cancel"), requestId: z.string().min(1) }),
]);

export const leagueStimulus = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = StimulusInput.parse(req.data);
  const ref = leagueRef(input.leagueId);

  return db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    const now = Date.now();
    requireActiveLeague(league, now);
    const me = requireMember(league, uid);
    if (!league.get("stimulusEnabled")) throw new HttpsError("failed-precondition", "Stimulus votes are turned off in this league.");

    const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
    const needed = Math.floor(memberIds.length / 2) + 1;
    const leagueName = (league.get("name") as string) ?? "League";
    const open = league.get("stimulus") as StimulusRequest | null | undefined;
    const live = open && open.expiresAt > now ? open : null;

    const pay = (r: StimulusRequest) => {
      const update: Record<string, unknown> = { stimulus: null, lastStimulusAt: now, lastActivityAt: now, stimulusTotal: FieldValue.increment(r.amount) };
      for (const id of memberIds) {
        update[`members.${id}.leagueTokens`] = FieldValue.increment(r.amount);
        update[`members.${id}.stimulusReceived`] = FieldValue.increment(r.amount);
      }
      tx.update(ref, update);
      activity(tx, input.leagueId, `stimulus_paid_${r.id}`, {
        type: "stimulus",
        uid: r.uid,
        name: r.name,
        text: `Stimulus approved: the bank gave everyone ${r.amount.toLocaleString("en-US")} tokens`,
        amount: r.amount,
      });
      for (const id of memberIds) {
        writeNotification(
          tx,
          id,
          simpleNotification({
            id: `stimulus_ok_${r.id}_${id}`,
            type: "stimulus_approved",
            title: `+${r.amount.toLocaleString("en-US")} tokens in ${leagueName}`,
            body: "The stimulus vote passed — the bank topped up every member.",
            now,
            delta: r.amount,
            wallet: "league",
            leagueId: input.leagueId,
            leagueName,
          })
        );
      }
    };

    if (input.action === "request") {
      if (live) throw new HttpsError("failed-precondition", "There's already a stimulus vote open.");
      const last = (league.get("lastStimulusAt") as number | undefined) ?? 0;
      if (now - last < STIMULUS_COOLDOWN_MS) {
        const days = Math.ceil((last + STIMULUS_COOLDOWN_MS - now) / 86_400_000);
        throw new HttpsError("failed-precondition", `The last stimulus was recent — try again in ${days} day${days === 1 ? "" : "s"}.`);
      }
      const starting = (league.get("startingLeagueTokens") as number) ?? 0;
      const r: StimulusRequest = {
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        uid,
        name: me.displayName,
        pct: input.pct,
        amount: Math.max(1, Math.round((starting * input.pct) / 100)),
        votes: [uid],
        createdAt: now,
        expiresAt: now + STIMULUS_TTL_MS,
      };
      if (r.votes.length >= needed) {
        pay(r);
        return { ok: true, status: "paid" as const, amount: r.amount };
      }
      tx.update(ref, { stimulus: r, lastActivityAt: now });
      activity(tx, input.leagueId, `stimulus_req_${r.id}`, {
        type: "stimulus",
        uid,
        name: me.displayName,
        text: `${me.displayName} asked the bank for a ${r.pct}% stimulus (${r.amount.toLocaleString("en-US")} tokens each) — vote in the Bank tab`,
        amount: r.amount,
      });
      for (const id of memberIds) {
        if (id === uid) continue;
        writeNotification(
          tx,
          id,
          simpleNotification({
            id: `stimulus_req_${r.id}_${id}`,
            type: "stimulus_request",
            title: `Stimulus vote in ${leagueName}`,
            body: `${me.displayName} wants the bank to give everyone ${r.amount.toLocaleString("en-US")} tokens. ${needed} yes votes needed.`,
            now,
            popup: false,
            wallet: "league",
            leagueId: input.leagueId,
            leagueName,
          })
        );
      }
      return { ok: true, status: "open" as const, amount: r.amount };
    }

    if (!live || live.id !== input.requestId) throw new HttpsError("failed-precondition", "That stimulus vote is closed.");

    if (input.action === "cancel") {
      if (live.uid !== uid && league.get("creatorId") !== uid) {
        throw new HttpsError("permission-denied", "Only whoever asked (or the league creator) can withdraw it.");
      }
      tx.update(ref, { stimulus: null, lastActivityAt: now });
      return { ok: true, status: "cancelled" as const, amount: live.amount };
    }

    const votes = input.approve ? [...new Set([...live.votes, uid])] : live.votes.filter((v) => v !== uid);
    const next = { ...live, votes };
    if (votes.length >= needed) {
      pay(next);
      return { ok: true, status: "paid" as const, amount: live.amount };
    }
    tx.update(ref, { stimulus: next, lastActivityAt: now });
    return { ok: true, status: "open" as const, amount: live.amount };
  });
});

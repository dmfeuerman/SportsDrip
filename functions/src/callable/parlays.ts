import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, FieldValue, requireAuth } from "../lib/economy";
import { voidReason } from "../lib/gameState";
import { leagueStarted, MIN_LEAGUE_STAKE } from "../lib/leagueConfig";
import {
  combinedParlayOdds,
  gradeParlayLegs,
  MAX_PARLAY_LEGS,
  MAX_PARLAY_SHARE,
  parlayStakeCap,
  MIN_PARLAY_LEGS,
  type ParlayLeg,
} from "../lib/parlay";
import { requirePricedMarket } from "../lib/pricing";
import { decide } from "../lib/settlement";

/**
 * Group Parlays (`leagues/{leagueId}/parlays/{parlayId}`).
 *
 *  - `createGroupParlay`: starts a shared parlay ticket in a league (with an
 *    optional first leg and creator stake).
 *  - `addParlayLeg`: a member adds one leg (up to 4 legs total, one leg per
 *    game, combined price capped at 20x).
 *  - `rideParlay`: a member joins the ticket at their own stake in league tokens.
 *  - `lockParlay`: locks the ticket once it has 2–4 legs.
 *  - `gradeParlays`: grades finished games; if any leg loses, records `bustedBy`
 *    and posts a chat/feed row calling out whose leg killed the parlay.
 */

const Key = z.string().min(8).max(64);

const LegSpecSchema = z.object({
  gameId: z.string().min(1),
  side: z.enum(["home", "away"]).optional(),
  market: z.enum(["ml", "spread", "total"]).optional(),
  selection: z.enum(["home", "away", "over", "under"]).optional(),
  expectedOdds: z.number().positive().max(100).optional(),
  expectedLine: z.number().finite().optional(),
});

const CreateParlayInput = z.object({
  leagueId: z.string().min(1),
  idempotencyKey: Key,
  stake: z.number().int().min(MIN_LEAGUE_STAKE).max(10_000_000).optional(),
  leg: LegSpecSchema.optional(),
});

interface RiderEntry {
  uid: string;
  name: string;
  stake: number;
}

function buildLegFromGame(
  uid: string,
  name: string,
  game: FirebaseFirestore.DocumentSnapshot,
  spec: z.infer<typeof LegSpecSchema>,
  league: FirebaseFirestore.DocumentSnapshot,
  now: number
): ParlayLeg {
  if (!game.exists) throw new HttpsError("not-found", "That game is no longer available.");
  if (game.get("status") !== "upcoming") {
    throw new HttpsError("failed-precondition", "Betting is closed for this game.");
  }
  const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
  if (startsAt && startsAt <= now) {
    throw new HttpsError("failed-precondition", "This game has already started.");
  }
  if (startsAt && startsAt >= ((league.get("endsAt") as number | undefined) ?? Infinity)) {
    throw new HttpsError("failed-precondition", "That game starts after this league's season ends.");
  }
  const allowed = (league.get("allowedSports") as string[] | undefined) ?? [];
  if (!allowed.includes(game.get("sport") as string)) {
    throw new HttpsError("failed-precondition", `${game.get("sport")} isn't part of this league.`);
  }
  const priced = requirePricedMarket(game, spec);
  return {
    uid,
    name,
    gameId: spec.gameId,
    sport: game.get("sport") as string,
    market: priced.market,
    selection: priced.selection,
    side: priced.side,
    line: priced.line,
    label: priced.label,
    teamAbbr: priced.teamAbbr,
    opponentAbbr: priced.opponentAbbr,
    odds: priced.odds,
    startsAt,
    status: "pending",
  };
}

export const createGroupParlay = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = CreateParlayInput.parse(req.data);
  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const parlayId = `parlay_${uid.slice(0, 8)}_${input.idempotencyKey}`;
  const parlayRef = leagueRef.collection("parlays").doc(parlayId);

  return db.runTransaction(async (tx) => {
    const [existing, league, game] = await Promise.all([
      tx.get(parlayRef),
      tx.get(leagueRef),
      input.leg ? tx.get(db.collection("games").doc(input.leg.gameId)) : Promise.resolve(null),
    ]);
    if (existing.exists) return { ok: true, parlayId, duplicate: true };

    const now = Date.now();
    if (!league.exists || league.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "That league is not active.");
    }
    if (!leagueStarted(league, now)) throw new HttpsError("failed-precondition", "This league hasn't started yet.");
    const me = league.get(`members.${uid}`) as { displayName: string; leagueTokens: number } | undefined;
    if (!me) throw new HttpsError("permission-denied", "You're not in this league.");

    const legs: ParlayLeg[] = [];
    if (input.leg && game) {
      legs.push(buildLegFromGame(uid, me.displayName, game, input.leg, league, now));
    }

    const riders: Record<string, RiderEntry> = {};
    if (input.stake !== undefined) {
      if (input.stake > parlayStakeCap(me.leagueTokens)) {
        throw new HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(MAX_PARLAY_SHARE * 100)}% of your wallet (${parlayStakeCap(me.leagueTokens).toLocaleString("en-US")} tokens).`);
      }
      if (input.stake > me.leagueTokens) {
        throw new HttpsError("failed-precondition", "Not enough league tokens.");
      }
      riders[uid] = { uid, name: me.displayName, stake: input.stake };
      tx.update(leagueRef, {
        [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
        lastActivityAt: now,
      });
    }

    const combinedOdds = combinedParlayOdds(legs);
    tx.set(parlayRef, {
      id: parlayId,
      leagueId: input.leagueId,
      creatorUid: uid,
      creatorName: me.displayName,
      status: "open",
      legs,
      riders,
      combinedOdds,
      bustedBy: null,
      bustedByName: null,
      bustedLeg: null,
      createdAt: now,
      settledAt: null,
    });

    tx.set(leagueRef.collection("activity").doc(`parlay_open_${parlayId}`), {
      type: "parlay_opened",
      uid,
      name: me.displayName,
      amount: input.stake ?? 0,
      text: `${me.displayName} started a Group Parlay`,
      at: now,
    });

    return { ok: true, parlayId, duplicate: false, combinedOdds };
  });
});

export const addParlayLeg = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      parlayId: z.string().min(1),
      gameId: z.string().min(1),
      side: z.enum(["home", "away"]).optional(),
      market: z.enum(["ml", "spread", "total"]).optional(),
      selection: z.enum(["home", "away", "over", "under"]).optional(),
      expectedOdds: z.number().positive().max(100).optional(),
      expectedLine: z.number().finite().optional(),
      stake: z.number().int().min(MIN_LEAGUE_STAKE).max(10_000_000).optional(),
    })
    .parse(req.data);

  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);
  const gameRef = db.collection("games").doc(input.gameId);

  return db.runTransaction(async (tx) => {
    const [league, parlay, game] = await Promise.all([
      tx.get(leagueRef),
      tx.get(parlayRef),
      tx.get(gameRef),
    ]);
    const now = Date.now();
    if (!league.exists || league.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "That league is not active.");
    }
    if (!leagueStarted(league, now)) throw new HttpsError("failed-precondition", "This league hasn't started yet.");
    const me = league.get(`members.${uid}`) as { displayName: string; leagueTokens: number } | undefined;
    if (!me) throw new HttpsError("permission-denied", "You're not in this league.");
    if (!parlay.exists) throw new HttpsError("not-found", "Parlay not found.");
    if (parlay.get("status") !== "open") {
      throw new HttpsError("failed-precondition", "That parlay is already locked.");
    }

    const legs = [...((parlay.get("legs") as ParlayLeg[] | undefined) ?? [])];
    if (legs.length >= MAX_PARLAY_LEGS) {
      throw new HttpsError("failed-precondition", `Group parlays cap at ${MAX_PARLAY_LEGS} legs.`);
    }
    if (legs.some((l) => l.uid === uid)) {
      throw new HttpsError("already-exists", "You already added a leg to this parlay.");
    }
    if (legs.some((l) => l.gameId === input.gameId)) {
      throw new HttpsError("already-exists", "That game is already on this parlay.");
    }

    const newLeg = buildLegFromGame(uid, me.displayName, game, input, league, now);
    legs.push(newLeg);
    const combinedOdds = combinedParlayOdds(legs);

    const riders = { ...((parlay.get("riders") as Record<string, RiderEntry> | undefined) ?? {}) };
    if (input.stake !== undefined && !riders[uid]) {
      if (input.stake > parlayStakeCap(me.leagueTokens)) {
        throw new HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(MAX_PARLAY_SHARE * 100)}% of your wallet (${parlayStakeCap(me.leagueTokens).toLocaleString("en-US")} tokens).`);
      }
      if (input.stake > me.leagueTokens) {
        throw new HttpsError("failed-precondition", "Not enough league tokens.");
      }
      riders[uid] = { uid, name: me.displayName, stake: input.stake };
      tx.update(leagueRef, {
        [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
        lastActivityAt: now,
      });
    }

    tx.update(parlayRef, { legs, riders, combinedOdds });
    return { ok: true, combinedOdds, legCount: legs.length };
  });
});

export const rideParlay = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      parlayId: z.string().min(1),
      stake: z.number().int().min(MIN_LEAGUE_STAKE).max(10_000_000),
    })
    .parse(req.data);

  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);

  return db.runTransaction(async (tx) => {
    const [league, parlay] = await Promise.all([tx.get(leagueRef), tx.get(parlayRef)]);
    const now = Date.now();
    if (!league.exists || league.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "That league is not active.");
    }
    if (!leagueStarted(league, now)) throw new HttpsError("failed-precondition", "This league hasn't started yet.");
    const me = league.get(`members.${uid}`) as { displayName: string; leagueTokens: number } | undefined;
    if (!me) throw new HttpsError("permission-denied", "You're not in this league.");
    if (!parlay.exists) throw new HttpsError("not-found", "Parlay not found.");
    const status = parlay.get("status") as string;
    if (status !== "open" && status !== "locked") {
      throw new HttpsError("failed-precondition", "That parlay is already settled.");
    }

    const legs = (parlay.get("legs") as ParlayLeg[] | undefined) ?? [];
    if (legs.some((l) => l.startsAt > 0 && l.startsAt <= now)) {
      throw new HttpsError("failed-precondition", "A leg on this parlay has already kicked off.");
    }

    const riders = { ...((parlay.get("riders") as Record<string, RiderEntry> | undefined) ?? {}) };
    if (riders[uid]) {
      throw new HttpsError("already-exists", "You're already riding this parlay.");
    }
    if (input.stake > parlayStakeCap(me.leagueTokens)) {
      throw new HttpsError("failed-precondition", `Parlay stakes are capped at ${Math.round(MAX_PARLAY_SHARE * 100)}% of your wallet (${parlayStakeCap(me.leagueTokens).toLocaleString("en-US")} tokens).`);
    }
    if (input.stake > me.leagueTokens) {
      throw new HttpsError("failed-precondition", "Not enough league tokens.");
    }

    riders[uid] = { uid, name: me.displayName, stake: input.stake };
    tx.update(leagueRef, {
      [`members.${uid}.leagueTokens`]: me.leagueTokens - input.stake,
      lastActivityAt: now,
    });
    tx.update(parlayRef, { riders });
    return { ok: true, leagueTokens: me.leagueTokens - input.stake };
  });
});

export const lockParlay = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1),
      parlayId: z.string().min(1),
    })
    .parse(req.data);

  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const parlayRef = leagueRef.collection("parlays").doc(input.parlayId);

  return db.runTransaction(async (tx) => {
    const [league, parlay] = await Promise.all([tx.get(leagueRef), tx.get(parlayRef)]);
    const now = Date.now();
    if (!league.exists || league.get("status") !== "active") {
      throw new HttpsError("failed-precondition", "That league is not active.");
    }
    if (!leagueStarted(league, now)) throw new HttpsError("failed-precondition", "This league hasn't started yet.");
    requireAuth(req.auth);
    if (!league.get(`members.${uid}`)) {
      throw new HttpsError("permission-denied", "You're not in this league.");
    }
    if (!parlay.exists) throw new HttpsError("not-found", "Parlay not found.");
    if (parlay.get("status") === "locked") return { ok: true, combinedOdds: parlay.get("combinedOdds") as number };
    if (parlay.get("status") !== "open") {
      throw new HttpsError("failed-precondition", "That parlay is already settled.");
    }

    const legs = (parlay.get("legs") as ParlayLeg[] | undefined) ?? [];
    if (legs.length < MIN_PARLAY_LEGS || legs.length > MAX_PARLAY_LEGS) {
      throw new HttpsError("failed-precondition", `A group parlay needs ${MIN_PARLAY_LEGS} to ${MAX_PARLAY_LEGS} legs.`);
    }
    if (legs.some((l) => l.startsAt > 0 && l.startsAt <= now)) {
      throw new HttpsError("failed-precondition", "One of the legs has already started.");
    }

    const combinedOdds = combinedParlayOdds(legs);
    tx.update(parlayRef, { status: "locked", combinedOdds, lockedAt: now });
    return { ok: true, combinedOdds };
  });
});

/** Grades any open/locked group parlays carrying a leg on `gameId`. */
export async function gradeParlays(gameId: string): Promise<number> {
  const gameSnap = await db.collection("games").doc(gameId).get();
  if (!gameSnap.exists || gameSnap.get("status") !== "final") return 0;
  const homeScore = gameSnap.get("homeScore") as number | null;
  const awayScore = gameSnap.get("awayScore") as number | null;
  if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) {
    return 0;
  }

  const all = await db.collectionGroup("parlays").where("status", "in", ["open", "locked"]).limit(500).get();
  let graded = 0;

  for (const doc of all.docs) {
    const legs = (doc.get("legs") as ParlayLeg[] | undefined) ?? [];
    if (!legs.some((l) => l.gameId === gameId && l.status === "pending")) continue;

    try {
      const did = await db.runTransaction(async (tx) => {
        const parlay = await tx.get(doc.ref);
        const curStatus = parlay.get("status") as string;
        if (!parlay.exists || (curStatus !== "open" && curStatus !== "locked")) return false;

        const leagueId = parlay.get("leagueId") as string;
        const leagueRef = db.collection("leagues").doc(leagueId);
        const league = await tx.get(leagueRef);
        if (!league.exists || league.get("status") !== "active") return false;

        const curLegs = (parlay.get("legs") as ParlayLeg[] | undefined) ?? [];
        const updatedLegs = curLegs.map((leg) => {
          if (leg.gameId !== gameId || leg.status !== "pending") return leg;
          const outcome = decide(
            { market: leg.market, selection: leg.selection, side: leg.side, line: leg.line },
            homeScore,
            awayScore
          );
          return { ...leg, status: outcome };
        });

        const grade = gradeParlayLegs(updatedLegs);
        const now = Date.now();

        if (grade.status === "pending") {
          tx.update(doc.ref, {
            status: "locked",
            legs: updatedLegs,
            combinedOdds: grade.effectiveOdds,
          });
          return true;
        }

        const riders = (parlay.get("riders") as Record<string, RiderEntry> | undefined) ?? {};
        const leagueUpdate: Record<string, unknown> = { lastActivityAt: now };

        if (grade.status === "won") {
          for (const [uid, r] of Object.entries(riders)) {
            if (!league.get(`members.${uid}`)) continue;
            const payout = Math.round(r.stake * grade.effectiveOdds);
            leagueUpdate[`members.${uid}.leagueTokens`] = FieldValue.increment(payout);
            leagueUpdate[`members.${uid}.betsWon`] = FieldValue.increment(1);
          }
          tx.set(leagueRef.collection("activity").doc(`parlay_win_${doc.id}`), {
            type: "parlay_won",
            uid: parlay.get("creatorUid") as string,
            name: parlay.get("creatorName") as string,
            amount: 0,
            text: `Group Parlay cashed at ${grade.effectiveOdds.toFixed(2)}x!`,
            at: now,
          });
        } else if (grade.status === "push") {
          for (const [uid, r] of Object.entries(riders)) {
            if (!league.get(`members.${uid}`)) continue;
            leagueUpdate[`members.${uid}.leagueTokens`] = FieldValue.increment(r.stake);
            leagueUpdate[`members.${uid}.betsPush`] = FieldValue.increment(1);
          }
        } else if (grade.status === "lost") {
          for (const [uid] of Object.entries(riders)) {
            if (!league.get(`members.${uid}`)) continue;
            leagueUpdate[`members.${uid}.betsLost`] = FieldValue.increment(1);
          }
          const bustText = `Group Parlay busted — ${grade.bustedByName}'s leg (${grade.bustedLeg}) missed`;
          tx.set(leagueRef.collection("activity").doc(`parlay_bust_${doc.id}`), {
            type: "parlay_busted",
            uid: grade.bustedBy ?? "",
            name: grade.bustedByName ?? "Member",
            amount: 0,
            text: bustText,
            at: now,
          });
          tx.set(leagueRef.collection("messages").doc(`parlay_bust_${doc.id}`), {
            uid: grade.bustedBy ?? "",
            name: grade.bustedByName ?? "Member",
            kind: "system",
            text: bustText,
            at: now,
            reactions: {},
            reactors: {},
          });
        }

        tx.update(leagueRef, leagueUpdate);
        tx.update(doc.ref, {
          status: grade.status,
          legs: updatedLegs,
          combinedOdds: grade.effectiveOdds,
          bustedBy: grade.bustedBy,
          bustedByName: grade.bustedByName,
          bustedLeg: grade.bustedLeg,
          settledAt: now,
        });
        return true;
      });
      if (did) graded++;
    } catch (err) {
      logger.error("failed to grade parlay", { parlayId: doc.id, err });
    }
  }
  return graded;
}

/** Marks parlay legs on disrupted (cancelled/postponed >24h) games as void and settles if all legs are done. */
export async function voidDisruptedParlayLegs(now = Date.now()): Promise<number> {
  const all = await db.collectionGroup("parlays").where("status", "in", ["open", "locked"]).limit(500).get();
  let touched = 0;

  for (const doc of all.docs) {
    const legs = (doc.get("legs") as ParlayLeg[] | undefined) ?? [];
    const pendingGameIds = [...new Set(legs.filter((l) => l.status === "pending").map((l) => l.gameId))];
    if (!pendingGameIds.length) continue;

    const voidGames = new Set<string>();
    for (const gid of pendingGameIds) {
      const g = await db.collection("games").doc(gid).get();
      if (!g.exists || voidReason(g.data() as never, now)) {
        voidGames.add(gid);
      }
    }
    if (!voidGames.size) continue;

    const did = await db.runTransaction(async (tx) => {
      const parlay = await tx.get(doc.ref);
      const curStatus = parlay.get("status") as string;
      if (!parlay.exists || (curStatus !== "open" && curStatus !== "locked")) return false;
      const leagueId = parlay.get("leagueId") as string;
      const leagueRef = db.collection("leagues").doc(leagueId);
      const league = await tx.get(leagueRef);
      if (!league.exists || league.get("status") !== "active") return false;

      const curLegs = (parlay.get("legs") as ParlayLeg[] | undefined) ?? [];
      const updatedLegs = curLegs.map((l) =>
        l.status === "pending" && voidGames.has(l.gameId) ? { ...l, status: "void" as const } : l
      );
      const grade = gradeParlayLegs(updatedLegs);

      if (grade.status === "pending") {
        tx.update(doc.ref, { legs: updatedLegs, combinedOdds: grade.effectiveOdds });
        return true;
      }

      const riders = (parlay.get("riders") as Record<string, RiderEntry> | undefined) ?? {};
      const leagueUpdate: Record<string, unknown> = { lastActivityAt: now };
      if (grade.status === "won" || grade.status === "push") {
        for (const [uid, r] of Object.entries(riders)) {
          if (!league.get(`members.${uid}`)) continue;
          const credit = grade.status === "won" ? Math.round(r.stake * grade.effectiveOdds) : r.stake;
          leagueUpdate[`members.${uid}.leagueTokens`] = FieldValue.increment(credit);
        }
      }
      tx.update(leagueRef, leagueUpdate);
      tx.update(doc.ref, {
        status: grade.status,
        legs: updatedLegs,
        combinedOdds: grade.effectiveOdds,
        settledAt: now,
      });
      return true;
    });
    if (did) touched++;
  }
  return touched;
}

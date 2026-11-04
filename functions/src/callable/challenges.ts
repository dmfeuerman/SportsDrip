import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { CHALLENGE_MAX_MESSAGE, challengeTerms, counterOdds } from "../lib/challengeMath";
import { CHALLENGES, gameLabel, releasePending } from "../lib/challengeSettlement";
import { applyCreditsMany, db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

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

const side = z.enum(["home", "away"]);

const CreateInput = z.object({
  gameId: z.string().min(1),
  opponentUid: z.string().min(1),
  side,
  mode: z.enum(["pot", "odds"]),
  stake: z.number().int(),
  odds: z.number().nullish(),
  message: z.string().max(CHALLENGE_MAX_MESSAGE).nullish(),
  idempotencyKey: z.string().min(8).max(64),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpsError("invalid-argument", "Check the challenge details and try again.");
  return r.data;
}

function displayName(snap: FirebaseFirestore.DocumentSnapshot): string {
  return ((snap.get("displayName") as string) || (snap.get("username") as string) || "A friend").trim();
}

function kickedOff(game: FirebaseFirestore.DocumentSnapshot, now: number): boolean {
  const startsAt = (game.get("startsAt") as number | undefined) ?? 0;
  return !game.exists || game.get("status") !== "upcoming" || !startsAt || startsAt <= now;
}

export const createChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = parse(CreateInput, req.data);
  if (input.opponentUid === uid) throw new HttpsError("invalid-argument", "Pick a friend to challenge.");

  const quote = challengeTerms(input.mode, input.stake, input.odds ?? undefined);
  if (!quote.ok) throw new HttpsError("invalid-argument", quote.reason);
  const terms = quote.terms;

  const id = `${uid}_${input.idempotencyKey}`;
  const ref = CHALLENGES().doc(id);
  const message = input.message?.trim() || null;

  return db.runTransaction(async (tx) => {
    const [existing, game, friendship, me, them] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection("games").doc(input.gameId)),
      tx.get(db.collection("friendships").doc(pairId(uid, input.opponentUid))),
      tx.get(db.collection("users").doc(uid)),
      tx.get(db.collection("users").doc(input.opponentUid)),
    ]);

    if (existing.exists) return { ok: true, challengeId: id, duplicate: true, balance: null };
    if (!friendship.exists) throw new HttpsError("permission-denied", "You can only challenge friends.");
    if (!them.exists) throw new HttpsError("not-found", "That player isn't around any more.");
    if (!game.exists) throw new HttpsError("not-found", "That game is no longer available.");
    if (kickedOff(game, Date.now())) throw new HttpsError("failed-precondition", "This game has already started.");

    const home = game.get("homeTeam") as { name: string; abbreviation: string; color: string };
    const away = game.get("awayTeam") as { name: string; abbreviation: string; color: string };
    const pick = input.side === "home" ? home : away;
    const other = input.side === "home" ? away : home;
    const creatorName = displayName(me);
    const opponentName = displayName(them);
    const now = Date.now();

    const balances = await applyCreditsMany(tx, [
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
      sport: (game.get("sport") as string | undefined) ?? null,
      startsAt: game.get("startsAt") as number,
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
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      respondedAtMs: null,
      closedAtMs: null,
      settledAtMs: null,
    });

    const offer =
      terms.mode === "pot"
        ? `${terms.opponentStake.toLocaleString("en-US")} each, winner takes ${terms.pot.toLocaleString("en-US")}`
        : `you'd put in ${terms.opponentStake.toLocaleString("en-US")} at ${counterOdds(terms).toFixed(2)}x for a ${terms.pot.toLocaleString("en-US")} pot`;
    writeNotification(
      tx,
      input.opponentUid,
      simpleNotification({
        id: `chnew_${id}`,
        type: "challenge_received",
        title: `${creatorName} challenged you`,
        body: `${creatorName} has ${pick.abbreviation} over ${other.abbreviation} — you'd get ${other.abbreviation}. ${offer[0]!.toUpperCase()}${offer.slice(1)}.`,
        now,
        data: { challengeId: id, fromUid: uid },
      })
    );

    return { ok: true, challengeId: id, duplicate: false, balance: balances[uid] ?? null };
  });
});

const RespondInput = z.object({ challengeId: z.string().min(1), accept: z.boolean() });

/**
 * The friend accepts (their stake goes into escrow) or declines (the
 * challenger's stake goes back). A challenge answered after kickoff expires
 * instead, refunding the challenger.
 */
export const respondChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = parse(RespondInput, req.data);
  const ref = CHALLENGES().doc(input.challengeId);

  return db.runTransaction(async (tx) => {
    const ch = await tx.get(ref);
    if (!ch.exists) throw new HttpsError("not-found", "Challenge not found.");
    if (ch.get("opponentUid") !== uid) throw new HttpsError("permission-denied", "This challenge isn't for you.");

    const status = ch.get("status") as string;
    if (status === "accepted" && input.accept) return { ok: true, status: "accepted" as const, balance: null };
    if (status !== "pending") throw new HttpsError("failed-precondition", `This challenge was already ${status}.`);

    const game = await tx.get(db.collection("games").doc(ch.get("gameId") as string));
    const now = Date.now();

    if (kickedOff(game, now)) {
      await releasePending(tx, ch, "expired", now);
      return { ok: true, status: "expired" as const, balance: null };
    }

    if (!input.accept) {
      await releasePending(tx, ch, "declined", now);
      return { ok: true, status: "declined" as const, balance: null };
    }

    const stake = ch.get("opponentStake") as number;
    const creator = ch.get("creatorUid") as string;
    const creatorName = (ch.get("creatorName") as string) || "your friend";
    const opponentName = (ch.get("opponentName") as string) || "Your friend";
    let balances: Record<string, number | null>;
    try {
      balances = await applyCreditsMany(tx, [
        {
          uid,
          delta: -stake,
          type: "challenge_escrow",
          idempotencyKey: `chesc_${ch.id}_${uid}`,
          ref: ch.id,
          note: `Challenge vs ${creatorName} · ${gameLabel(ch)}`,
        },
      ]);
    } catch (err) {
      if (err instanceof HttpsError && err.code === "failed-precondition") {
        throw new HttpsError("failed-precondition", `You need ${stake.toLocaleString("en-US")} credits to accept this one.`);
      }
      throw err;
    }

    tx.update(ref, { status: "accepted", respondedAtMs: now });
    writeNotification(
      tx,
      creator,
      simpleNotification({
        id: `chacc_${ch.id}`,
        type: "challenge_accepted",
        title: `${opponentName} is in`,
        body: `${gameLabel(ch)} is on — ${(ch.get("pot") as number).toLocaleString("en-US")} credits locked in the pot.`,
        now,
        data: { challengeId: ch.id },
      })
    );
    return { ok: true, status: "accepted" as const, balance: balances[uid] ?? null };
  });
});

/** The challenger withdraws an offer nobody has accepted yet. */
export const cancelChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const challengeId = parse(z.string().min(1), req.data?.challengeId);
  const ref = CHALLENGES().doc(challengeId);

  return db.runTransaction(async (tx) => {
    const ch = await tx.get(ref);
    if (!ch.exists) throw new HttpsError("not-found", "Challenge not found.");
    if (ch.get("creatorUid") !== uid) throw new HttpsError("permission-denied", "Only the challenger can withdraw it.");
    const status = ch.get("status") as string;
    if (status === "accepted") {
      throw new HttpsError("failed-precondition", "Your friend already accepted — the pot is locked until the game is final.");
    }
    if (status !== "pending") return { ok: true, status, balance: null };
    const balance = await releasePending(tx, ch, "cancelled", Date.now());
    return { ok: true, status: "cancelled", balance };
  });
});

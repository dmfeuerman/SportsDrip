import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { requirePricedMarket } from "../lib/pricing";
import { checkPlayLimits } from "../lib/playLimits";
import { advanceStreak, type StreakState } from "../lib/streak";
import { recentEmptyDays } from "../lib/streakDays";
import { decide, type Market, type Selection } from "../lib/settlement";
import { voidReason, type GameLike } from "../lib/gameState";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

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
export const MIN_SLIP_LEGS = 2;
export const MAX_SLIP_LEGS = 10;
/** Combined price cap, so a long ticket can't print the economy. */
export const MAX_SLIP_ODDS = 250;
const MIN_STAKE = 10;
const MAX_STAKE = 100_000;

type LegStatus = "pending" | "won" | "lost" | "push" | "void";
interface SlipLeg {
  gameId: string;
  sport: string | null;
  market: Market;
  selection: Selection;
  side: "home" | "away" | null;
  line: number | null;
  label: string;
  teamAbbr: string;
  opponentAbbr: string;
  odds: number;
  startsAt: number;
  status: LegStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Product of live legs (pushes and voids count as 1.0x), capped. */
export function slipOdds(legs: Array<Pick<SlipLeg, "odds" | "status">>): number {
  let p = 1;
  for (const l of legs) if (l.status !== "push" && l.status !== "void") p *= l.odds;
  return round2(Math.min(MAX_SLIP_ODDS, p));
}

const LegInput = z.object({
  gameId: z.string().min(1),
  market: z.enum(["ml", "spread", "total"]).default("ml"),
  selection: z.enum(["home", "away", "over", "under"]),
});
const PlaceInput = z.object({
  legs: z.array(LegInput).min(MIN_SLIP_LEGS).max(MAX_SLIP_LEGS),
  stake: z.number().int().min(MIN_STAKE).max(MAX_STAKE),
  idempotencyKey: z.string().min(8).max(64),
});

export const placeParlay = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = PlaceInput.parse(req.data);
  const ids = input.legs.map((l) => l.gameId);
  if (new Set(ids).size !== ids.length) throw new HttpsError("invalid-argument", "One leg per game: a parlay can't have two picks on the same game.");

  const ref = db.collection("slipParlays").doc(`${uid}_${input.idempotencyKey}`);
  const userRef = db.collection("users").doc(uid);
  const emptyDays = await recentEmptyDays();
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { ok: true, parlayId: ref.id, duplicate: true };
    const [user, ...games] = await Promise.all([tx.get(userRef), ...ids.map((id) => tx.get(db.collection("games").doc(id)))]);
    const now = Date.now();
    const limitUpdate = checkPlayLimits(user, now);
    const legs: SlipLeg[] = input.legs.map((l, i) => {
      const g = games[i]!;
      if (!g.exists) throw new HttpsError("not-found", "One of those games is no longer available.");
      const startsAt = (g.get("startsAt") as number | undefined) ?? 0;
      if (g.get("status") !== "upcoming" || (startsAt && startsAt <= now)) {
        throw new HttpsError("failed-precondition", `${g.get("awayTeam.abbreviation") ?? "A"} @ ${g.get("homeTeam.abbreviation") ?? "game"} has already started. Take it off the slip.`);
      }
      const side = l.market === "total" ? undefined : (l.selection as "home" | "away");
      const p = requirePricedMarket(g, { market: l.market, selection: l.selection, side });
      return {
        gameId: l.gameId,
        sport: (g.get("sport") as string) ?? null,
        market: p.market,
        selection: p.selection,
        side: p.side,
        line: p.line,
        label: p.label,
        teamAbbr: p.teamAbbr,
        opponentAbbr: p.opponentAbbr,
        odds: p.odds,
        startsAt,
        status: "pending" as const,
      };
    });
    const odds = slipOdds(legs);
    const balance = await applyCredits(tx, uid, {
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
      placedAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
    const streak = advanceStreak(user.get("streak") as Partial<StreakState> | undefined, now, { emptyDays });
    tx.update(userRef, {
      "stats.betsPlaced": FieldValue.increment(1),
      "stats.creditsStaked": FieldValue.increment(input.stake),
      streak,
      ...limitUpdate,
    });
    return { ok: true, parlayId: ref.id, duplicate: false, odds, balance };
  });
});

/** Cancels a parlay before its first game starts, refunding the stake. */
export const cancelParlay = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parlayId = z.string().min(1).parse(req.data?.parlayId);
  const ref = db.collection("slipParlays").doc(parlayId);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw new HttpsError("not-found", "Parlay not found.");
    if (p.get("uid") !== uid) throw new HttpsError("permission-denied", "Not your parlay.");
    if (p.get("status") !== "pending") throw new HttpsError("failed-precondition", "That parlay is already settled.");
    const legs = p.get("legs") as SlipLeg[];
    const games = await Promise.all(legs.map((l) => tx.get(db.collection("games").doc(l.gameId))));
    const now = Date.now();
    if (games.some((g) => !g.exists || g.get("status") !== "upcoming" || ((g.get("startsAt") as number) ?? 0) <= now)) {
      throw new HttpsError("failed-precondition", "A game on this parlay has started — it's locked in.");
    }
    const stake = p.get("stake") as number;
    const balance = await applyCredits(tx, uid, { delta: stake, type: "bet_refund", idempotencyKey: `parlay_cancel_${parlayId}`, ref: parlayId, note: "Parlay cancelled before kickoff" });
    tx.update(ref, { status: "cancelled", settledAt: FieldValue.serverTimestamp() });
    tx.update(db.collection("users").doc(uid), { "stats.betsPlaced": FieldValue.increment(-1), "stats.creditsStaked": FieldValue.increment(-stake) });
    return { ok: true, balance };
  });
});

/**
 * Grades one parlay after a leg changed; pays it out, refunds it or loses it
 * once decided. Runs inside the caller's transaction.
 */
async function finish(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, legs: SlipLeg[], data: FirebaseFirestore.DocumentData) {
  const uid = data.uid as string;
  const stake = data.stake as number;
  const lost = legs.find((l) => l.status === "lost");
  const open = legs.some((l) => l.status === "pending");
  if (!lost && open) {
    tx.update(ref, { legs });
    return;
  }
  const now = Date.now();
  if (lost) {
    tx.update(ref, { legs, status: "lost", settledAt: FieldValue.serverTimestamp(), bustedBy: lost.label });
    tx.update(db.collection("users").doc(uid), { "stats.betsLost": FieldValue.increment(1) });
    writeNotification(tx, uid, simpleNotification({ id: `parlay_${ref.id}`, type: "bet_lost", title: `Parlay missed — ${lost.label}`, body: `${legs.length}-leg parlay · −${stake.toLocaleString("en-US")} credits`, delta: -stake, now, popup: true }));
    return;
  }
  const live = legs.filter((l) => l.status === "won");
  if (!live.length) {
    const balance = await applyCredits(tx, uid, { delta: stake, type: "bet_refund", idempotencyKey: `parlay_settle_${ref.id}`, ref: ref.id, note: "Parlay push — stake returned" });
    tx.update(ref, { legs, status: "push", settledAt: FieldValue.serverTimestamp() });
    writeNotification(tx, uid, simpleNotification({ id: `parlay_${ref.id}`, type: "bet_push", title: "Parlay push", body: "Every leg pushed or was called off — your stake is back.", delta: 0, balanceAfter: balance, now }));
    return;
  }
  const odds = slipOdds(legs);
  const payout = Math.round(stake * odds);
  const balance = await applyCredits(tx, uid, { delta: payout, type: "bet_payout", idempotencyKey: `parlay_settle_${ref.id}`, ref: ref.id, note: `Won ${legs.length}-leg parlay` });
  tx.update(ref, { legs, status: "won", odds, potentialPayout: payout, settledAt: FieldValue.serverTimestamp() });
  tx.update(db.collection("users").doc(uid), { "stats.betsWon": FieldValue.increment(1), "stats.creditsWon": FieldValue.increment(payout - stake) });
  writeNotification(tx, uid, simpleNotification({ id: `parlay_${ref.id}`, type: "bet_won", title: `Parlay hit! +${(payout - stake).toLocaleString("en-US")}`, body: `${legs.length}-leg parlay at ${odds.toFixed(2)}x`, delta: payout - stake, balanceAfter: balance, now, popup: true }));
}

/** Grades the legs on a final game across every open parlay that has it. */
export async function settleSlipParlaysForGame(gameId: string): Promise<number> {
  const game = await db.collection("games").doc(gameId).get();
  if (!game.exists || game.get("status") !== "final") return 0;
  const home = game.get("homeScore") as number | null;
  const away = game.get("awayScore") as number | null;
  if (home === null || away === null) return 0;
  const open = await db.collection("slipParlays").where("gameIds", "array-contains", gameId).where("status", "==", "pending").limit(500).get();
  let n = 0;
  for (const d of open.docs) {
    await db.runTransaction(async (tx) => {
      const p = await tx.get(d.ref);
      if (!p.exists || p.get("status") !== "pending") return;
      const legs = (p.get("legs") as SlipLeg[]).map((l) =>
        l.gameId === gameId && l.status === "pending" ? { ...l, status: decide({ market: l.market, selection: l.selection, side: l.side, line: l.line }, home, away) as LegStatus } : l
      );
      await finish(tx, d.ref, legs, p.data()!);
      n++;
    });
  }
  return n;
}

/** Legs on cancelled / long-postponed games drop out (1.0x), so the rest of the ticket still counts. */
export async function voidSlipParlayLegs(now = Date.now()): Promise<number> {
  const open = await db.collection("slipParlays").where("status", "==", "pending").limit(500).get();
  const cache = new Map<string, string | null>();
  let n = 0;
  for (const d of open.docs) {
    const legs = d.get("legs") as SlipLeg[];
    let hit = false;
    for (const l of legs) {
      if (l.status !== "pending") continue;
      if (!cache.has(l.gameId)) {
        const g = await db.collection("games").doc(l.gameId).get();
        cache.set(l.gameId, g.exists ? voidReason(g.data() as GameLike, now) : "expired");
      }
      if (cache.get(l.gameId)) hit = true;
    }
    if (!hit) continue;
    await db.runTransaction(async (tx) => {
      const p = await tx.get(d.ref);
      if (!p.exists || p.get("status") !== "pending") return;
      const next = (p.get("legs") as SlipLeg[]).map((l) => (l.status === "pending" && cache.get(l.gameId) ? { ...l, status: "void" as LegStatus } : l));
      await finish(tx, d.ref, next, p.data()!);
      n++;
    });
  }
  return n;
}

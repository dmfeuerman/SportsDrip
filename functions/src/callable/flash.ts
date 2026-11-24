import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { applyCredits, db, requireAuth } from "../lib/economy";
import {
  decideFlash,
  FLASH_FREE_PER_DAY,
  FLASH_MAX_STAKE,
  FLASH_MIN_STAKE,
  FLASH_PAID_ODDS,
  FLASH_REWARD,
  type FlashSide,
} from "../lib/flash";
import { nyDay } from "../lib/streak";

/**
 * makeFlashPick({ gameId, side, stake? }): "who scores next?" on a live game.
 *
 * First FLASH_FREE_PER_DAY (3) picks each day are free (0 stake, +200 credits).
 * Once the 3 free daily picks are spent, players can place unlimited paid live
 * picks by supplying `stake` (credits), deducted up front and paying
 * Math.round(stake * 1.91) on a win (or refunded on a push). Strictly 1 active
 * pending pick per game at a time.
 */
export const makeFlashPick = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const gameId = String(req.data?.gameId ?? "");
  const side = req.data?.side as FlashSide;
  const rawStake = req.data?.stake;
  if (!gameId || (side !== "home" && side !== "away")) throw new HttpsError("invalid-argument", "Pick a team.");

  const userRef = db.collection("users").doc(uid);
  const gameRef = db.collection("games").doc(gameId);
  const pendingQuery = db
    .collection("flashPicks")
    .where("uid", "==", uid)
    .where("gameId", "==", gameId)
    .where("status", "==", "pending")
    .limit(1);

  return db.runTransaction(async (tx) => {
    const [user, game, pendingSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(gameRef),
      tx.get(pendingQuery),
    ]);
    if (!user.exists) throw new HttpsError("not-found", "Profile not found.");
    if (!game.exists || game.get("status") !== "live" || game.get("disrupted")) {
      throw new HttpsError("failed-precondition", "Live picks open while the game is live.");
    }
    const now = Date.now();
    const breakUntil = user.get("limits.breakUntil") as number | undefined;
    if (breakUntil && breakUntil > now) throw new HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");

    if (!pendingSnap.empty) {
      throw new HttpsError("failed-precondition", "You already have a live pick riding on this game.");
    }

    const day = nyDay(now);
    const prev = user.get("flashToday") as { day?: string; count?: number; freeCount?: number } | undefined;
    const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
    const freeCount = prev?.day === day ? Math.max(0, prev.freeCount ?? Math.min(prev.count ?? 0, FLASH_FREE_PER_DAY)) : 0;

    const isFree = freeCount < FLASH_FREE_PER_DAY;
    let stake = 0;
    let reward = FLASH_REWARD;

    const home = game.get("homeTeam") as { abbreviation?: string } | undefined;
    const away = game.get("awayTeam") as { abbreviation?: string } | undefined;
    const teamAbbr = (side === "home" ? home?.abbreviation : away?.abbreviation) ?? side.toUpperCase();
    const pickRef = db.collection("flashPicks").doc();

    if (!isFree) {
      const parsed = typeof rawStake === "number" ? Math.floor(rawStake) : Number.parseInt(String(rawStake ?? ""), 10);
      if (!Number.isFinite(parsed) || parsed < FLASH_MIN_STAKE || parsed > FLASH_MAX_STAKE) {
        throw new HttpsError(
          "invalid-argument",
          `Choose a live stake between ${FLASH_MIN_STAKE} and ${FLASH_MAX_STAKE.toLocaleString()} credits.`
        );
      }
      stake = parsed;
      reward = Math.round(stake * FLASH_PAID_ODDS);
      // Must run before any tx.set / tx.update so Firestore reads precede writes.
      await applyCredits(tx, uid, {
        delta: -stake,
        type: "flash_pick",
        idempotencyKey: `flash_stake_${pickRef.id}`,
        ref: gameId,
        note: `Live pick: ${teamAbbr} scores next`,
      });
    }

    const nextFreeCount = isFree ? freeCount + 1 : freeCount;
    const pick = {
      uid,
      gameId,
      sport: (game.get("sport") as string | undefined) ?? null,
      side,
      teamAbbr,
      homeAt: (game.get("homeScore") as number | null) ?? 0,
      awayAt: (game.get("awayScore") as number | null) ?? 0,
      stake,
      paid: !isFree,
      odds: isFree ? null : FLASH_PAID_ODDS,
      reward,
      status: "pending" as const,
      createdAt: now,
      settledAt: null,
    };
    tx.set(pickRef, pick);
    tx.update(userRef, { flashToday: { day, count: count + 1, freeCount: nextFreeCount } });
    return {
      ok: true as const,
      id: pickRef.id,
      freeLeft: Math.max(0, FLASH_FREE_PER_DAY - nextFreeCount),
      stake,
      reward,
      paid: !isFree,
    };
  });
});

/**
 * Grades every open flash pick on a game against the scoreboard just written.
 * Called from the games trigger when a score changes or the game ends.
 * Each pick settles in its own transaction; the ledger id makes a replay a no-op.
 */
export async function settleFlashForGame(gameId: string, home: number | null, away: number | null, status: string): Promise<number> {
  const open = await db.collection("flashPicks").where("gameId", "==", gameId).where("status", "==", "pending").limit(500).get();
  let settled = 0;
  for (const doc of open.docs) {
    const outcome = decideFlash(
      { side: doc.get("side") as FlashSide, homeAt: doc.get("homeAt") as number, awayAt: doc.get("awayAt") as number },
      home,
      away,
      status
    );
    if (!outcome) continue;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists || fresh.get("status") !== "pending") return;
        const uid = fresh.get("uid") as string;
        const stake = (fresh.get("stake") as number | undefined) ?? 0;
        if (outcome === "won") {
          await applyCredits(tx, uid, {
            delta: (fresh.get("reward") as number | undefined) ?? FLASH_REWARD,
            type: "flash_pick",
            idempotencyKey: `flash_${doc.id}`,
            ref: gameId,
            note: `Flash pick: ${fresh.get("teamAbbr")} scored next`,
          });
        } else if (outcome === "push" && stake > 0) {
          await applyCredits(tx, uid, {
            delta: stake,
            type: "bet_refund",
            idempotencyKey: `flash_refund_${doc.id}`,
            ref: gameId,
            note: `Live pick push refund: ${fresh.get("teamAbbr")}`,
          });
        }
        tx.update(doc.ref, { status: outcome, settledAt: Date.now(), homeEnd: home, awayEnd: away });
      });
      settled++;
    } catch (err) {
      logger.warn("flash pick settle failed", { id: doc.id, error: String(err) });
    }
  }
  return settled;
}

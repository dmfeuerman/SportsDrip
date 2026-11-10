import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { applyCredits, db, requireAuth } from "../lib/economy";
import { decideFlash, FLASH_PER_DAY, FLASH_PER_GAME, FLASH_REWARD, type FlashSide } from "../lib/flash";
import { nyDay } from "../lib/streak";

/**
 * makeFlashPick({ gameId, side }): a free "who scores next?" call on a live game.
 * flashPicks/{uid}_{gameId}_{n}; one open pick per game, FLASH_PER_GAME per
 * game, FLASH_PER_DAY per day. The scoreboard at pick time is snapshotted
 * server-side, so the client can't choose a favourable baseline.
 */
export const makeFlashPick = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const gameId = String(req.data?.gameId ?? "");
  const side = req.data?.side as FlashSide;
  if (!gameId || (side !== "home" && side !== "away")) throw new HttpsError("invalid-argument", "Pick a team.");

  const userRef = db.collection("users").doc(uid);
  const gameRef = db.collection("games").doc(gameId);
  const slot = (n: number) => db.collection("flashPicks").doc(`${uid}_${gameId}_${n}`);

  return db.runTransaction(async (tx) => {
    const [user, game, ...slots] = await Promise.all([
      tx.get(userRef),
      tx.get(gameRef),
      ...Array.from({ length: FLASH_PER_GAME }, (_, n) => tx.get(slot(n))),
    ]);
    if (!user.exists) throw new HttpsError("not-found", "Profile not found.");
    if (!game.exists || game.get("status") !== "live" || game.get("disrupted")) {
      throw new HttpsError("failed-precondition", "Flash picks open while the game is live.");
    }
    const now = Date.now();
    const breakUntil = user.get("limits.breakUntil") as number | undefined;
    if (breakUntil && breakUntil > now) throw new HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");

    if (slots.some((s) => s.exists && s.get("status") === "pending")) {
      throw new HttpsError("failed-precondition", "You already have a flash pick riding on this game.");
    }
    const n = slots.findIndex((s) => !s.exists);
    if (n < 0) throw new HttpsError("resource-exhausted", `That's all ${FLASH_PER_GAME} flash picks for this game.`);

    const day = nyDay(now);
    const prev = user.get("flashToday") as { day?: string; count?: number } | undefined;
    const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
    if (count >= FLASH_PER_DAY) throw new HttpsError("resource-exhausted", "You've used today's flash picks. They reset at midnight ET.");

    const home = game.get("homeTeam") as { abbreviation?: string } | undefined;
    const away = game.get("awayTeam") as { abbreviation?: string } | undefined;
    const pick = {
      uid,
      gameId,
      sport: (game.get("sport") as string | undefined) ?? null,
      side,
      teamAbbr: (side === "home" ? home?.abbreviation : away?.abbreviation) ?? side.toUpperCase(),
      homeAt: (game.get("homeScore") as number | null) ?? 0,
      awayAt: (game.get("awayScore") as number | null) ?? 0,
      reward: FLASH_REWARD,
      status: "pending" as const,
      createdAt: now,
      settledAt: null,
    };
    tx.set(slot(n), pick);
    tx.update(userRef, { flashToday: { day, count: count + 1 } });
    return { ok: true as const, id: slot(n).id, left: FLASH_PER_GAME - n - 1, leftToday: FLASH_PER_DAY - count - 1 };
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
        if (outcome === "won") {
          await applyCredits(tx, uid, {
            delta: (fresh.get("reward") as number | undefined) ?? FLASH_REWARD,
            type: "flash_pick",
            idempotencyKey: `flash_${doc.id}`,
            ref: gameId,
            note: `Flash pick: ${fresh.get("teamAbbr")} scored next`,
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

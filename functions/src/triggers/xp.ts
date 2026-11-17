import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { autoClaimSoon } from "../callable/levelChallenges";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { xpForLedger } from "../lib/progression";
import { checkAchievements } from "../lib/achievements";

/**
 * XP comes only from level challenges (callable/levelChallenges.ts), each
 * claimable once per level. These triggers no longer grant XP; they keep
 * checking achievements after the events that can earn one.
 *
 * (Previously: XP as a side effect of things that already committed — a ledger row, a
 * settled league bet, a new friendship — never part of their transaction.
 * Every grant is keyed on the source document, so a redelivered event is a
 * no-op.
 */

/** Wins, purchases, prize boxes, league payouts and ad rewards all leave a ledger row. */
export const xpOnLedger = onDocumentCreated(
  { document: "users/{uid}/ledger/{entryId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const row = event.data?.data();
    if (!row) return;
    const { uid, entryId } = event.params;
    let stake: number | undefined;
    if (row.type === "bet_payout" && typeof row.ref === "string") {
      const bet = await db.collection("bets").doc(row.ref).get();
      stake = bet.exists ? (bet.get("stake") as number | undefined) : undefined;
    }
    // Boxes, purchases, videos and payouts can finish a level challenge.
    await autoClaimSoon(uid);
    // Only rows that used to earn XP are achievement-relevant (wins, buys, boxes…).
    if (xpForLedger(row.type, row.delta, stake) <= 0) return;
    void entryId;
    await checkAchievements(uid).catch((err) => logger.warn("achievements", { uid, error: String(err) }));
  }
);

/** League bets are paid in league tokens (no ledger row), so wins are caught here. */
export const xpOnLeagueBet = onDocumentUpdated(
  { document: "leagues/{leagueId}/leagueBets/{betId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status || after.status !== "won") return;
    const uid = after.uid as string | undefined;
    if (!uid) return;
    await autoClaimSoon(uid);
    await checkAchievements(uid).catch(() => []);
  }
);

/** Both players get XP for a new friendship, however it was made. */
export const xpOnFriendship = onDocumentCreated(
  { document: "friendships/{pairId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const users = event.data?.get("users") as string[] | undefined;
    if (!Array.isArray(users)) return;
    await Promise.all(users.map((u) => autoClaimSoon(u)));
    await Promise.all(users.map((u) => checkAchievements(u).catch(() => [])));
  }
);

/** A bet placed (bets, free bets) or won (wins) can finish a level challenge. */
export const challengesOnBet = onDocumentWritten(
  { document: "bets/{betId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;
    const placed = !before;
    const won = before?.status !== "won" && after.status === "won";
    if (placed || won) await autoClaimSoon(after.uid as string | undefined);
  }
);

/** Parlays live in their own collection. */
export const challengesOnParlay = onDocumentCreated(
  { document: "slipParlays/{id}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => autoClaimSoon(event.data?.get("uid") as string | undefined)
);

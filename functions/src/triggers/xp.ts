import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { XP, xpForLedger } from "../lib/progression";
import { grantXp } from "../lib/xp";
import { checkAchievements } from "../lib/achievements";

/**
 * XP is a side effect of things that already committed — a ledger row, a
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
    const amount = xpForLedger(row.type, row.delta, stake);
    if (amount <= 0) return;
    const res = await grantXp(uid, amount, `ledger_${entryId}`, String(row.type));
    if (res.levelsGained) logger.info("level up", { uid, level: res.level, credits: res.credits, unlocks: res.unlocks.length });
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
    await grantXp(uid, XP.leagueBetWin, `lbet_${event.params.betId}`, "league_bet_won");
    await checkAchievements(uid).catch(() => []);
  }
);

/** Both players get XP for a new friendship, however it was made. */
export const xpOnFriendship = onDocumentCreated(
  { document: "friendships/{pairId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const users = event.data?.get("users") as string[] | undefined;
    if (!Array.isArray(users)) return;
    await Promise.all(users.map((u) => grantXp(u, XP.newFriend, `friend_${event.params.pairId}`, "new_friend")));
    await Promise.all(users.map((u) => checkAchievements(u).catch(() => [])));
  }
);

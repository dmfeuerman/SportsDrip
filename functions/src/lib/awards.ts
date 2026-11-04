/**
 * Season trophies, badges, and last-place punishments.
 *
 * At league finalization (`finalizeLeague`), champions receive a permanent
 * trophy doc (`users/{uid}/trophies/champ_{leagueId}`) plus the champion crown
 * in their inventory (`source: "trophy"`). Last place (in leagues of 2+ members)
 * receives a last-place badge and a forced punishment cosmetic worn for 7 days.
 */

import { logger } from "firebase-functions";
import { db, FieldValue } from "./economy";
import { equipOne } from "../callable/avatar";
import type { LeagueResultDoc } from "./leagueLifecycle";

export const CHAMPION_ITEM_ID = "hat_gold_crown";
export const PUNISHMENT_ITEM_ID = "hat_bubblegum_beanie";
export const PUNISHMENT_DURATION_MS = 7 * 86_400_000;

export async function applySeasonAwards(
  leagueId: string,
  leagueName: string,
  results: LeagueResultDoc[],
  now = Date.now()
): Promise<void> {
  if (results.length === 0) return;

  const champ = results[0]!;
  const champUserRef = db.collection("users").doc(champ.memberId);
  await Promise.all([
    champUserRef.collection("trophies").doc(`champ_${leagueId}`).set(
      {
        id: `champ_${leagueId}`,
        kind: "champion",
        title: `${leagueName} Champion`,
        leagueId,
        leagueName,
        rank: 1,
        netWorth: champ.netWorth,
        itemId: CHAMPION_ITEM_ID,
        awardedAt: now,
      },
      { merge: true }
    ),
    champUserRef.collection("inventory").doc(CHAMPION_ITEM_ID).set(
      {
        itemId: CHAMPION_ITEM_ID,
        slot: "hat",
        source: "trophy",
        pricePaid: 0,
        leagueId,
        acquiredAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);

  if (results.length >= 2) {
    const loser = results[results.length - 1]!;
    if (loser.memberId !== champ.memberId && loser.netWorth < champ.netWorth) {
      const loserRef = db.collection("users").doc(loser.memberId);
      const expiresAt = now + PUNISHMENT_DURATION_MS;
      await Promise.all([
        loserRef.collection("trophies").doc(`last_${leagueId}`).set(
          {
            id: `last_${leagueId}`,
            kind: "last_place",
            title: `${leagueName} Last Place`,
            leagueId,
            leagueName,
            rank: results.length,
            netWorth: loser.netWorth,
            itemId: PUNISHMENT_ITEM_ID,
            expiresAt,
            awardedAt: now,
          },
          { merge: true }
        ),
        loserRef.collection("inventory").doc(PUNISHMENT_ITEM_ID).set(
          {
            itemId: PUNISHMENT_ITEM_ID,
            slot: "hat",
            source: "trophy",
            pricePaid: 0,
            leagueId,
            expiresAt,
            acquiredAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        loserRef.set(
          {
            punishment: {
              itemId: PUNISHMENT_ITEM_ID,
              slot: "hat",
              leagueId,
              leagueName,
              expiresAt,
            },
          },
          { merge: true }
        ),
      ]);
      try {
        await equipOne(loser.memberId, "hat", PUNISHMENT_ITEM_ID);
      } catch (err) {
        logger.warn("couldn't equip punishment item", {
          leagueId,
          uid: loser.memberId,
          err: String(err),
        });
      }
    }
  }
}

/** Clears forced punishment items whose 7-day window has elapsed. */
export async function expirePunishments(now = Date.now()): Promise<number> {
  const snaps = await db
    .collection("users")
    .where("punishment.expiresAt", "<=", now)
    .limit(200)
    .get();
  let cleared = 0;
  for (const doc of snaps.docs) {
    await doc.ref.update({ punishment: FieldValue.delete() });
    cleared++;
  }
  return cleared;
}

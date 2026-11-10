import { db, FieldValue, type Tx } from "./economy";
import { writeNotification } from "./notify";
import { simpleNotification } from "./notifyModel";
import { levelFromXp, levelUpCredits, scaledXp } from "./progression";
import { activeSeason, SEASON_XP_REASONS } from "./seasonPass";

/**
 * XP and level-ups. Kept out of the money transactions on purpose: the
 * triggers in triggers/xp.ts call grantXp *after* a bet, purchase or prize box
 * has committed, so a level-up can never roll back (or hold open) the thing
 * that earned it.
 *
 * Reaching a level:
 *  - pays levelUpCredits(level) into the wallet (ledger "level_reward",
 *    keyed `level_<n>` so it is paid once per level, ever)
 *  - grants every catalog item / background whose `levelReward` is at or below
 *    the new level and isn't owned yet (so a reward added later still reaches
 *    players who passed that level)
 *  - writes one `level_up` notification for the feed (the app shows its own
 *    celebration from the profile, so it isn't a popup)
 */

export interface Unlock {
  kind: "item" | "background";
  id: string;
  name: string;
  level: number;
}

interface PendingUnlocks {
  unlocks: Unlock[];
  write: () => void;
}

/**
 * Reads every level reward at or below `level` that this player doesn't own.
 * Reads only: call `write()` after the transaction's other reads.
 */
export async function readLevelUnlocks(tx: Tx, uid: string, level: number): Promise<PendingUnlocks> {
  const userRef = db.collection("users").doc(uid);
  const [items, bgs] = await Promise.all([
    tx.get(db.collection("catalog").where("levelReward", "<=", level)),
    tx.get(db.collection("backgrounds").where("levelReward", "<=", level)),
  ]);
  const candidates: Array<Unlock & { ref: FirebaseFirestore.DocumentReference; slot?: unknown }> = [];
  for (const d of items.docs) {
    const lv = d.get("levelReward") as number;
    if (typeof lv !== "number" || lv < 1) continue;
    candidates.push({ kind: "item", id: d.id, name: (d.get("name") as string) ?? d.id, level: lv, ref: userRef.collection("inventory").doc(d.id), slot: d.get("slot") });
  }
  for (const d of bgs.docs) {
    const lv = d.get("levelReward") as number;
    if (typeof lv !== "number" || lv < 1) continue;
    candidates.push({ kind: "background", id: d.id, name: (d.get("name") as string) ?? d.id, level: lv, ref: userRef.collection("backgrounds").doc(d.id) });
  }
  const owned = await Promise.all(candidates.map((c) => tx.get(c.ref)));
  const missing = candidates.filter((_, i) => !owned[i]!.exists);
  return {
    unlocks: missing.map(({ kind, id, name, level: lv }) => ({ kind, id, name, level: lv })),
    write: () => {
      for (const m of missing) {
        tx.set(
          m.ref,
          m.kind === "item"
            ? { itemId: m.id, slot: m.slot ?? null, source: "level", level: m.level, acquiredAt: FieldValue.serverTimestamp() }
            : { backgroundId: m.id, source: "level", level: m.level, acquiredAt: FieldValue.serverTimestamp() }
        );
      }
    },
  };
}

export interface XpResult {
  applied: boolean;
  xp: number;
  level: number;
  levelsGained: number;
  credits: number;
  unlocks: Unlock[];
}

/**
 * Adds `amount` XP once per `key` (users/{uid}/xpEvents/{key}). Safe to call
 * from retried triggers. Returns what happened, for tests and callers.
 */
export async function grantXp(uid: string, amount: number, key: string, reason: string): Promise<XpResult> {
  const userRef = db.collection("users").doc(uid);
  const eventRef = userRef.collection("xpEvents").doc(key);
  const none = (xp = 0): XpResult => ({ applied: false, xp, level: levelFromXp(xp), levelsGained: 0, credits: 0, unlocks: [] });
  if (!(amount > 0) || !Number.isFinite(amount)) return none();
  // Season pass XP: a parallel counter, only from quests and Daily Picks.
  const season = SEASON_XP_REASONS.has(reason) ? await activeSeason().catch(() => null) : null;

  return db.runTransaction(async (tx) => {
    const [user, ev] = await Promise.all([tx.get(userRef), tx.get(eventRef)]);
    if (!user.exists) return none();
    const before = (user.get("xp") as number | undefined) ?? 0;
    if (ev.exists) return none(before);

    const oldLevel = levelFromXp(before);
    amount = scaledXp(Math.floor(amount), oldLevel);
    const after = before + amount;
    const newLevel = levelFromXp(after);

    // ── reads (all before the first write) ──
    const crossed: number[] = [];
    for (let l = oldLevel + 1; l <= newLevel; l++) crossed.push(l);
    const ledgerRefs = crossed.map((l) => userRef.collection("ledger").doc(`level_${l}`));
    const paid = await Promise.all(ledgerRefs.map((r) => tx.get(r)));
    const pending = crossed.length ? await readLevelUnlocks(tx, uid, newLevel) : null;

    // ── writes ──
    let balance = (user.get("balance") as number | undefined) ?? 0;
    let credits = 0;
    crossed.forEach((l, i) => {
      if (paid[i]!.exists) return;
      const c = levelUpCredits(l);
      if (c <= 0) return;
      balance += c;
      credits += c;
      tx.set(ledgerRefs[i]!, {
        type: "level_reward",
        delta: c,
        balanceAfter: balance,
        ref: `level:${l}`,
        note: `Reached level ${l}`,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    pending?.write();

    tx.set(eventRef, { amount: Math.floor(amount), reason, xpAfter: after, createdAt: FieldValue.serverTimestamp() });
    tx.update(userRef, {
      xp: after,
      level: newLevel,
      ...(season ? { [`seasonXp.${season.id}`]: FieldValue.increment(Math.floor(amount)) } : {}),
      ...(credits > 0 ? { balance } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const unlocks = pending?.unlocks ?? [];
    if (crossed.length) {
      const parts = [credits > 0 ? `+${credits.toLocaleString("en-US")} credits` : null, ...unlocks.map((u) => u.name)].filter(Boolean);
      writeNotification(
        tx,
        uid,
        simpleNotification({
          id: `level_${newLevel}`,
          type: "level_up",
          title: `Level ${newLevel} reached`,
          body: parts.length ? `Unlocked: ${parts.join(" · ")}` : "Keep winning to climb.",
          now: Date.now(),
          delta: credits,
          balanceAfter: credits > 0 ? balance : null,
          data: { level: String(newLevel), from: String(oldLevel), unlocks: unlocks.map((u) => `${u.kind}:${u.id}`).join(",") },
        })
      );
    }

    return { applied: true, xp: after, level: newLevel, levelsGained: crossed.length, credits, unlocks };
  });
}

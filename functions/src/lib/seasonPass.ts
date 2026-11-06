import { db, FieldValue, type Tx } from "./economy";

/**
 * Season pass engine (static). seasons/{seasonId} defines
 *   { startsAt, endsAt, tiers: [{ xp, reward }], premium?: { price, tiers } }.
 * Season XP is a parallel counter (users/{uid}.seasonXp.{seasonId}) earned only
 * from quests and Daily Picks; lifetime XP and levels are untouched.
 * Content and cadence are live-ops; only the engine and its rules live here.
 */

export type SeasonReward =
  | { kind: "item"; id: string }
  | { kind: "background"; id: string }
  | { kind: "move"; id: string }
  | { kind: "credits"; amount: number };

export interface SeasonTier {
  xp: number;
  reward: SeasonReward;
}

export interface SeasonDef {
  id: string;
  startsAt: number;
  endsAt: number;
  tiers: SeasonTier[];
  /** Optional premium track priced in credits (not sold for money — guardrail 1). */
  premium?: { price: number; tiers: SeasonTier[] } | null;
}

export const SEASON_XP_REASONS: ReadonlySet<string> = new Set(["quest", "daily_pick"]);

/** Throws on a config that breaks the rules. Run in tests and before writing a season doc. */
export function validateSeason(s: SeasonDef): void {
  if (!s.id || !(s.endsAt > s.startsAt)) throw new Error(`season ${s.id}: bad window`);
  const check = (tiers: SeasonTier[], track: string) => {
    let prev = 0;
    for (const t of tiers) {
      if (!(t.xp > prev)) throw new Error(`season ${s.id} ${track}: tier xp must strictly increase`);
      prev = t.xp;
      if (t.reward.kind === "credits" && !(t.reward.amount > 0)) throw new Error(`season ${s.id} ${track}: credits must be > 0`);
    }
  };
  check(s.tiers, "free");
  if (s.premium) {
    check(s.premium.tiers, "premium");
    if (!(s.premium.price > 0)) throw new Error(`season ${s.id}: premium price must be > 0`);
    // The pass can never pay for the next pass.
    const credits = [...s.tiers, ...s.premium.tiers].reduce((n, t) => n + (t.reward.kind === "credits" ? t.reward.amount : 0), 0);
    if (credits >= s.premium.price) {
      throw new Error(`season ${s.id}: tracks award ${credits} credits, which buys the next ${s.premium.price}-credit pass`);
    }
  }
}

let cache: { at: number; season: SeasonDef | null } | null = null;

/** The season running at `now`, cached for a minute per instance. */
export async function activeSeason(now = Date.now()): Promise<SeasonDef | null> {
  if (cache && now - cache.at < 60_000) return cache.season && cache.season.endsAt > now && cache.season.startsAt <= now ? cache.season : null;
  const snap = await db.collection("seasons").where("endsAt", ">", now).orderBy("endsAt").limit(3).get().catch(() => null);
  const season =
    snap?.docs.map((d) => ({ ...(d.data() as Omit<SeasonDef, "id">), id: d.id })).find((s) => s.startsAt <= now) ?? null;
  cache = { at: now, season };
  return season;
}

export function resetSeasonCache(): void {
  cache = null;
}

/** Applies a tier reward inside a transaction (writes only; caller did the reads). */
export function writeSeasonReward(tx: Tx, uid: string, seasonId: string, tierIndex: number, r: SeasonReward, balance: number, slot: unknown = null): number {
  const userRef = db.collection("users").doc(uid);
  const src = { source: "season", seasonId, tier: tierIndex, acquiredAt: FieldValue.serverTimestamp() };
  if (r.kind === "item") tx.set(userRef.collection("inventory").doc(r.id), { itemId: r.id, slot: slot ?? null, ...src });
  else if (r.kind === "background") tx.set(userRef.collection("backgrounds").doc(r.id), { backgroundId: r.id, ...src });
  else if (r.kind === "move") tx.set(userRef.collection("moves").doc(r.id), { moveId: r.id, ...src });
  else {
    balance += r.amount;
    tx.set(userRef.collection("ledger").doc(`season_${seasonId}_${tierIndex}`), {
      type: "season_reward",
      delta: r.amount,
      balanceAfter: balance,
      ref: `season:${seasonId}:${tierIndex}`,
      note: `Season tier ${tierIndex + 1}`,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(userRef, { balance });
  }
  return balance;
}

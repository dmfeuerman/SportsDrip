/**
 * Near-peer weekly ladder (pure). Tiers Bronze → Diamond. Cohorts of 10–15 per
 * tier, friends seeded together where possible. Weekly close promotes the top
 * 3 and relegates the bottom 3 (only in cohorts big enough that they don't overlap).
 */

export const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type Tier = (typeof TIERS)[number];
export const COHORT_MIN = 10;
export const COHORT_MAX = 15;
export const MOVERS = 3;
/** Default for meta/ladder.minWeeklyActives. Below this, cohorts are too thin. */
export const DEFAULT_MIN_WEEKLY_ACTIVES = 200;

export const tierOf = (t: unknown): Tier => (TIERS as readonly string[]).includes(t as string) ? (t as Tier) : "bronze";

/** Split n players into groups of 10–15 (one group when n < 20 can't split). */
export function cohortSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n < COHORT_MIN) return [n];
  let k = Math.ceil(n / COHORT_MAX);
  // 16–19 can't split into two groups of ≥10; keep one slightly larger cohort instead.
  if (Math.floor(n / k) < COHORT_MIN) k = Math.max(1, k - 1);
  const base = Math.floor(n / k);
  return Array.from({ length: k }, (_, i) => base + (i < n % k ? 1 : 0));
}

/**
 * Orders players so friends sit next to each other, then cuts by cohortSizes.
 * Deterministic for a given input order.
 */
export function buildCohorts(uids: string[], friendsOf: (uid: string) => string[]): string[][] {
  const pool = new Set(uids);
  const ordered: string[] = [];
  for (const u of uids) {
    if (!pool.has(u)) continue;
    pool.delete(u);
    ordered.push(u);
    for (const f of friendsOf(u)) {
      if (pool.has(f)) {
        pool.delete(f);
        ordered.push(f);
      }
    }
  }
  const out: string[][] = [];
  let i = 0;
  for (const size of cohortSizes(ordered.length)) {
    out.push(ordered.slice(i, i + size));
    i += size;
  }
  return out;
}

export interface LadderMove {
  uid: string;
  rank: number;
  score: number;
  from: Tier;
  to: Tier;
  result: "promoted" | "relegated" | "stayed";
}

/** Ranks a cohort by score (ties by uid) and decides moves. */
export function closeCohort(tier: Tier, scores: Array<{ uid: string; score: number }>): LadderMove[] {
  const ranked = [...scores].sort((a, b) => b.score - a.score || (a.uid < b.uid ? -1 : 1));
  const t = TIERS.indexOf(tier);
  const movers = ranked.length >= MOVERS * 2 + 1 ? MOVERS : 0;
  return ranked.map((s, i) => {
    let to = tier;
    let result: LadderMove["result"] = "stayed";
    if (i < movers && t < TIERS.length - 1 && s.score > 0) {
      to = TIERS[t + 1]!;
      result = "promoted";
    } else if (i >= ranked.length - movers && t > 0) {
      to = TIERS[t - 1]!;
      result = "relegated";
    }
    return { uid: s.uid, rank: i + 1, score: s.score, from: tier, to, result };
  });
}

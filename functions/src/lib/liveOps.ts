import { PRIZE_BOXES } from "./economy";
import { fnv1a } from "./experiments";

/**
 * Rotating content (live-ops). Pure planning so the scheduler and tests agree.
 *
 * meta/liveOps (server-only) — see scripts/liveops-data.mjs:
 *   { enabled, cadenceWeeks: 1|2, dropSize, returnEvery, returnCooldownWeeks,
 *     pool: itemId[], coopRewardPool: itemId[], events: LiveOpsEvent[] }
 * liveOpsDrops/{weekKey}: { itemIds, returning, startsAt, endsAt }
 * liveOpsEvents/{eventId}: { activatedAt, itemIds }
 */

export interface LiveOpsEvent {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  itemIds: string[];
}

export interface LiveOpsConfig {
  enabled: boolean;
  /** 1 = weekly drop, 2 = bi-weekly (a missed drop is worse than a slower cadence). */
  cadenceWeeks: 1 | 2;
  /** Items per drop, clamped to 3–6. */
  dropSize: number;
  /** Every Nth drop brings one retired item back. 0 = never. */
  returnEvery: number;
  /** A retired item can't return until this many weeks after it left. */
  returnCooldownWeeks: number;
  pool: string[];
  coopRewardPool: string[];
  events: LiveOpsEvent[];
}

export interface PastDrop {
  week: string;
  itemIds: string[];
  endsAt: number;
}

export interface PoolItem {
  id: string;
  price: number;
}

export interface DropPlan {
  week: string;
  itemIds: string[];
  returning: string[];
  startsAt: number;
  endsAt: number;
}

const WEEK = 7 * 86_400_000;
export const MIN_DROP = 3;
export const MAX_DROP = 6;

export function normalizeConfig(raw: Partial<LiveOpsConfig> | null | undefined): LiveOpsConfig {
  const r = raw ?? {};
  return {
    enabled: r.enabled === true,
    cadenceWeeks: r.cadenceWeeks === 2 ? 2 : 1,
    dropSize: Math.min(MAX_DROP, Math.max(MIN_DROP, Math.floor(r.dropSize ?? 4))),
    returnEvery: Math.max(0, Math.floor(r.returnEvery ?? 3)),
    returnCooldownWeeks: Math.max(1, Math.floor(r.returnCooldownWeeks ?? 6)),
    pool: Array.isArray(r.pool) ? r.pool.filter((x) => typeof x === "string") : [],
    coopRewardPool: Array.isArray(r.coopRewardPool) ? r.coopRewardPool.filter((x) => typeof x === "string") : [],
    events: Array.isArray(r.events) ? r.events.filter((e) => e && e.id && e.endsAt > e.startsAt) : [],
  };
}

/**
 * Highest credits one Prize Box claim can expected-yield (gold EV + max streak
 * bonus). Rotation items must be priced above it: rotation raises demand, never
 * credit supply.
 */
export function prizeBoxYieldCeiling(): number {
  const ev = (tier: keyof typeof PRIZE_BOXES) => {
    const segs = PRIZE_BOXES[tier].segments;
    const w = segs.reduce((n, s) => n + s.weight, 0);
    return segs.reduce((n, s) => n + s.credits * s.weight, 0) / w;
  };
  return Math.ceil(Math.max(ev("bronze"), ev("silver"), ev("gold")) + 7 * 15);
}

const rank = (seed: string, id: string) => fnv1a(`${seed}:${id}`);

/**
 * Picks this week's drop: never-dropped items first, then the longest-retired;
 * every `returnEvery`th drop swaps one slot for a retired item past cooldown.
 * Deterministic per week, so a retried run plans the same drop.
 */
export function planDrop(cfg: LiveOpsConfig, pool: PoolItem[], history: PastDrop[], week: string, now: number, blocked: Set<string> = new Set()): DropPlan | null {
  const floor = prizeBoxYieldCeiling();
  const eligible = pool.filter((p) => cfg.pool.includes(p.id) && p.price > floor && !blocked.has(p.id));
  const lastSeen = new Map<string, number>();
  for (const d of history) for (const id of d.itemIds) lastSeen.set(id, Math.max(lastSeen.get(id) ?? 0, d.endsAt));
  const live = new Set(history.filter((d) => d.endsAt > now).flatMap((d) => d.itemIds));

  const fresh = eligible.filter((p) => !lastSeen.has(p.id)).sort((a, b) => rank(week, a.id) - rank(week, b.id));
  const retired = eligible
    .filter((p) => lastSeen.has(p.id) && !live.has(p.id) && now - lastSeen.get(p.id)! >= cfg.returnCooldownWeeks * WEEK)
    .sort((a, b) => lastSeen.get(a.id)! - lastSeen.get(b.id)! || rank(week, a.id) - rank(week, b.id));

  const dropNumber = history.length + 1;
  const wantReturn = cfg.returnEvery > 0 && dropNumber % cfg.returnEvery === 0 ? 1 : 0;
  const returning = retired.slice(0, wantReturn).map((p) => p.id);
  // Pool exhausted of new items: fill from retired rather than skip the drop.
  const rest = [...fresh, ...retired.slice(returning.length)].slice(0, cfg.dropSize - returning.length).map((p) => p.id);
  const itemIds = [...rest, ...returning];
  if (itemIds.length < MIN_DROP) return null;
  return {
    week,
    itemIds,
    returning: returning.concat(rest.filter((id) => lastSeen.has(id))),
    startsAt: now,
    endsAt: now + cfg.cadenceWeeks * WEEK,
  };
}

/** Whether a new drop is due: none live, or the live one ends within a day. */
export function dropDue(history: PastDrop[], now: number): boolean {
  const latest = history.reduce((n, d) => Math.max(n, d.endsAt), 0);
  return latest - now <= 86_400_000;
}

/** Events to activate this run: starting within the next week, not ended, not yet activated. */
export function eventsToActivate(cfg: LiveOpsConfig, activated: Set<string>, now: number): LiveOpsEvent[] {
  return cfg.events.filter((e) => !activated.has(e.id) && e.endsAt > now && e.startsAt < now + WEEK && e.itemIds.length > 0);
}

/** Co-op league reward for a week: round-robin over the pool by week index. */
export function coopRewardFor(cfg: LiveOpsConfig, week: string): string | null {
  if (!cfg.coopRewardPool.length) return null;
  const idx = Math.floor(Date.parse(`${week}T00:00:00Z`) / WEEK);
  return cfg.coopRewardPool[((idx % cfg.coopRewardPool.length) + cfg.coopRewardPool.length) % cfg.coopRewardPool.length]!;
}

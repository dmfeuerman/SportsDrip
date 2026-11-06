import { fnv1a } from "./experiments";

/**
 * Weekly quest pool + deterministic selection. The pool lives in
 * meta/questPool (falls back to DEFAULT_QUEST_POOL); each user gets the
 * endowed check-in plus one effort, one social and one skill quest per week,
 * picked by fnv1a(week + uid) — same hashing as lib/experiments.ts.
 */

export type QuestKind = "effort" | "social" | "skill" | "endowed";
export type QuestMetric = "checkin" | "picks" | "pickDays" | "reactions" | "wins" | "underdogWins";
export const QUEST_METRICS: readonly QuestMetric[] = ["checkin", "picks", "pickDays", "reactions", "wins", "underdogWins"];
export const SELECTED_KINDS: readonly QuestKind[] = ["effort", "social", "skill"];

export interface QuestDef {
  id: string;
  kind: QuestKind;
  metric: QuestMetric;
  title: string;
  target: number;
  xp: number;
  active?: boolean;
}

export const DEFAULT_QUEST_POOL: QuestDef[] = [
  { id: "checkin", kind: "endowed", metric: "checkin", title: "Check in this week", target: 1, xp: 10 },
  { id: "picks3", kind: "effort", metric: "picks", title: "Make 3 picks", target: 3, xp: 40 },
  { id: "picks5", kind: "effort", metric: "picks", title: "Make 5 picks", target: 5, xp: 60 },
  { id: "days3", kind: "effort", metric: "pickDays", title: "Pick on 3 different days", target: 3, xp: 60 },
  { id: "react2", kind: "social", metric: "reactions", title: "React to 2 friends' picks", target: 2, xp: 50 },
  { id: "react4", kind: "social", metric: "reactions", title: "React to 4 friends' picks", target: 4, xp: 70 },
  { id: "underdog", kind: "skill", metric: "underdogWins", title: "Hit an underdog (2.00x or longer)", target: 1, xp: 75 },
  { id: "wins2", kind: "skill", metric: "wins", title: "Win 2 bets", target: 2, xp: 60 },
];

/** Drops malformed / inactive entries. Falls back to the default pool for any kind left empty. */
export function normalizePool(raw: unknown): QuestDef[] {
  const list = Array.isArray(raw) ? raw : [];
  const ok = list.filter(
    (q): q is QuestDef =>
      !!q &&
      typeof q.id === "string" &&
      q.id.length > 0 &&
      (["effort", "social", "skill", "endowed"] as unknown[]).includes(q.kind) &&
      QUEST_METRICS.includes(q.metric) &&
      typeof q.title === "string" &&
      Number.isFinite(q.target) &&
      q.target >= 1 &&
      Number.isFinite(q.xp) &&
      q.xp >= 0 &&
      q.active !== false
  );
  const out = [...ok];
  for (const kind of ["endowed", ...SELECTED_KINDS] as QuestKind[]) {
    if (!out.some((q) => q.kind === kind)) out.push(...DEFAULT_QUEST_POOL.filter((q) => q.kind === kind));
  }
  return out;
}

/** Every endowed quest, then one per selected kind. Stable for a (week, uid). */
export function selectWeeklyQuests(pool: QuestDef[], week: string, uid: string): QuestDef[] {
  const out = pool.filter((q) => q.kind === "endowed");
  for (const kind of SELECTED_KINDS) {
    const c = pool.filter((q) => q.kind === kind).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const pick = c[fnv1a(`quests:${week}:${uid}:${kind}`) % Math.max(1, c.length)];
    if (pick) out.push(pick);
  }
  return out;
}

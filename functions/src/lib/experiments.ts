/**
 * Deterministic experiment bucketing. MUST stay byte-for-byte equivalent to
 * artifacts/mobile/lib/experiments.ts so a push and the screen it opens agree
 * on the arm. Config lives in meta/experiments; treatments live in code.
 *
 *   bucket = fnv1a(experimentId + ":" + unit) % 100
 *
 * unit is the uid for individual features and the leagueId for social ones,
 * so a league shares one arm (no spillover). A global holdout (bucketed on uid
 * alone) gets "control" for every engagement experiment.
 */

export type ExperimentUnit = "uid" | "leagueId";

export interface ExperimentConfig {
  id: string;
  unit: ExperimentUnit;
  /** arm -> percentage; should sum to 100. Order is significant. */
  splits: Record<string, number>;
  active: boolean;
}

export interface ExperimentsDoc {
  experiments: ExperimentConfig[];
  /** Percentage of users held out of all new engagement surfaces. */
  globalHoldout: number;
}

export const HOLDOUT_ID = "globalHoldout";
export const CONTROL = "control";

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function bucket(experimentId: string, unit: string): number {
  return fnv1a(`${experimentId}:${unit}`) % 100;
}

export function inHoldout(uid: string, pct: number): boolean {
  return pct > 0 && bucket(HOLDOUT_ID, uid) < pct;
}

/** The arm for this subject, or "control" when inactive, unknown, held out or unit missing. */
export function assignArm(
  doc: ExperimentsDoc | null | undefined,
  experimentId: string,
  subject: { uid: string; leagueId?: string | null }
): string {
  const exp = doc?.experiments?.find((e) => e.id === experimentId);
  if (!exp || !exp.active) return CONTROL;
  // The holdout is per user; league-unit experiments share one arm per league, so it doesn't apply.
  if (exp.unit === "uid" && inHoldout(subject.uid, doc?.globalHoldout ?? 0)) return CONTROL;
  const unit = exp.unit === "leagueId" ? subject.leagueId : subject.uid;
  if (!unit) return CONTROL;
  const b = bucket(experimentId, unit);
  let acc = 0;
  for (const [arm, pct] of Object.entries(exp.splits ?? {})) {
    acc += pct;
    if (b < acc) return arm;
  }
  return CONTROL;
}

/** Experiment ids referenced by code. Seed meta/experiments with these. */
export const EXPERIMENTS = {
  coopGoals: "coop_goals_v1",
  widgetPromo: "widget_promo_v1",
  ladder: "ladder_v1",
  shopRotation: "shop_rotation_v1",
  seasonPass: "season_pass_v1",
} as const;

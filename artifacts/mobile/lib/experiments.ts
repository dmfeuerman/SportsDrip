import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";

/**
 * Deterministic experiment bucketing. MUST stay equivalent to
 * functions/src/lib/experiments.ts so a push and the screen it opens agree on
 * the arm. Config: meta/experiments { experiments: [{ id, unit, splits, active }], globalHoldout }.
 * Treatment definitions live in code; only splits and on/off are config.
 */

export type ExperimentUnit = "uid" | "leagueId";
export interface ExperimentConfig {
  id: string;
  unit: ExperimentUnit;
  splits: Record<string, number>;
  active: boolean;
}
export interface ExperimentsDoc {
  experiments: ExperimentConfig[];
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

export function assignArm(
  cfg: ExperimentsDoc | null | undefined,
  experimentId: string,
  subject: { uid: string; leagueId?: string | null }
): string {
  const exp = cfg?.experiments?.find((e) => e.id === experimentId);
  if (!exp || !exp.active) return CONTROL;
  // The holdout is per user; league-unit experiments share one arm per league, so it doesn't apply.
  if (exp.unit === "uid" && inHoldout(subject.uid, cfg?.globalHoldout ?? 0)) return CONTROL;
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

export const EXPERIMENTS = {
  coopGoals: "coop_goals_v1",
  widgetPromo: "widget_promo_v1",
  ladder: "ladder_v1",
  shopRotation: "shop_rotation_v1",
  seasonPass: "season_pass_v1",
} as const;

let cache: ExperimentsDoc | null = null;
const listeners = new Set<(d: ExperimentsDoc | null) => void>();
let unsub: (() => void) | null = null;

function subscribe(fn: (d: ExperimentsDoc | null) => void): () => void {
  listeners.add(fn);
  if (!unsub && !DEMO) {
    const db = getDb();
    if (db) {
      unsub = onSnapshot(
        doc(db, "meta", "experiments"),
        (snap) => {
          cache = snap.exists() ? (snap.data() as ExperimentsDoc) : null;
          listeners.forEach((l) => l(cache));
        },
        () => {}
      );
    }
  }
  return () => {
    listeners.delete(fn);
  };
}

/** Arm for this subject. "control" until the config loads, so new surfaces stay off by default. */
export function useExperiment(experimentId: string, uid: string | null | undefined, leagueId?: string | null): string {
  const [cfg, setCfg] = useState<ExperimentsDoc | null>(cache);
  useEffect(() => subscribe(setCfg), []);
  if (!uid) return CONTROL;
  return assignArm(cfg, experimentId, { uid, leagueId });
}

/** In the global holdout: hide new engagement surfaces (checklist, celebrations' share cards, etc.). */
export function useHeldOut(uid: string | null | undefined): boolean {
  const [cfg, setCfg] = useState<ExperimentsDoc | null>(cache);
  useEffect(() => subscribe(setCfg), []);
  return !!uid && inHoldout(uid, cfg?.globalHoldout ?? 0);
}

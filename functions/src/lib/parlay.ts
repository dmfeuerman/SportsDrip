/**
 * Pure group-parlay math.
 *
 * Each member in a league can contribute a leg (2–4 legs total). Everyone who
 * rides the parlay stakes their own league tokens at the combined decimal
 * price, capped at MAX_PARLAY_ODDS (20x) to protect the league economy.
 * When any leg loses, `bustedBy` records whose leg killed the ticket.
 */

import type { Market, Outcome, Selection } from "./settlement";

export const MIN_PARLAY_LEGS = 2;
export const MAX_PARLAY_LEGS = 4;
/** A parlay stake can't exceed this share of the current league wallet (loss-chasing guard). */
export const MAX_PARLAY_SHARE = 0.25;

export function parlayStakeCap(walletTokens: number): number {
  return Math.floor(Math.max(0, walletTokens) * MAX_PARLAY_SHARE);
}
export const MAX_PARLAY_ODDS = 20.0;

export type ParlayLegStatus = "pending" | "won" | "lost" | "push" | "void";

export interface ParlayLeg {
  uid: string;
  name: string;
  gameId: string;
  sport: string;
  market: Market;
  selection: Selection;
  side: "home" | "away" | null;
  line: number | null;
  label: string;
  teamAbbr: string;
  opponentAbbr: string;
  odds: number;
  startsAt: number;
  status: ParlayLegStatus;
}

export interface ParlayGrade {
  status: "pending" | "won" | "lost" | "push";
  effectiveOdds: number;
  bustedBy: string | null;
  bustedByName: string | null;
  bustedLeg: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Combined decimal price across legs, treating push/void legs as 1.0x and capping at 20x. */
export function combinedParlayOdds(legs: Array<Pick<ParlayLeg, "odds" | "status">>): number {
  if (!legs.length) return 1;
  let product = 1;
  for (const leg of legs) {
    if (leg.status === "push" || leg.status === "void") continue;
    if (typeof leg.odds === "number" && Number.isFinite(leg.odds) && leg.odds > 1) {
      product *= leg.odds;
    }
  }
  return round2(Math.min(MAX_PARLAY_ODDS, Math.max(1, product)));
}

/** Grades a parlay from its legs. A single lost leg busts the slip immediately. */
export function gradeParlayLegs(legs: ParlayLeg[]): ParlayGrade {
  const lost = legs.find((l) => l.status === "lost");
  if (lost) {
    return {
      status: "lost",
      effectiveOdds: 0,
      bustedBy: lost.uid,
      bustedByName: lost.name,
      bustedLeg: lost.label,
    };
  }
  if (legs.some((l) => l.status === "pending")) {
    return {
      status: "pending",
      effectiveOdds: combinedParlayOdds(legs),
      bustedBy: null,
      bustedByName: null,
      bustedLeg: null,
    };
  }
  const anyWon = legs.some((l) => l.status === "won");
  if (!anyWon) {
    return {
      status: "push",
      effectiveOdds: 1,
      bustedBy: null,
      bustedByName: null,
      bustedLeg: null,
    };
  }
  return {
    status: "won",
    effectiveOdds: combinedParlayOdds(legs),
    bustedBy: null,
    bustedByName: null,
    bustedLeg: null,
  };
}

export function applyOutcomeToLeg(leg: ParlayLeg, outcome: Outcome): ParlayLeg {
  return { ...leg, status: outcome };
}

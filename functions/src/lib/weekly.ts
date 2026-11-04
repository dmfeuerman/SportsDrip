/**
 * Pure weekly league rituals:
 *  - Monday-anchored week keys in America/New_York
 *  - Tuesday League Report card builder (biggest hit, worst bad beat,
 *    biggest climber/faller, best tail, coldest streak)
 *  - Weekly head-to-head round-robin pairing and final-week playoff seeding
 */

import { nyDay } from "./streak";

/**
 * Returns the Monday YYYY-MM-DD in America/New_York for `ms`, so every member's
 * weekly lock, weekly matchup, and Tuesday report share the exact same key.
 */
export function weekKey(ms: number): string {
  const ymd = nyDay(ms);
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const dow = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

/** America/New_York day of week, 0 = Sunday. */
function nyDow(ms: number): number {
  const [y, m, d] = nyDay(ms).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export type MatchupCadence = "weekly" | "twice-weekly" | "daily";

/**
 * Id of the head-to-head period `ms` falls in:
 *  - weekly: the Monday week key ("2026-10-26")
 *  - twice-weekly: Mon–Wed "…-a", Thu–Sun "…-b"
 *  - daily: the New York day ("2026-10-31")
 */
export function matchupPeriodKey(cadence: MatchupCadence | undefined, ms: number): string {
  if (cadence === "daily") return nyDay(ms);
  const wk = weekKey(ms);
  if (cadence === "twice-weekly") {
    const dow = nyDow(ms);
    return `${wk}-${dow >= 1 && dow <= 3 ? "a" : "b"}`;
  }
  return wk;
}

/** True on the first day of a period (when the morning job opens new pairings). */
export function isPeriodStart(cadence: MatchupCadence | undefined, ms: number): boolean {
  if (cadence === "daily") return true;
  const dow = nyDow(ms);
  return cadence === "twice-weekly" ? dow === 1 || dow === 4 : dow === 1;
}

export interface ReportBetInput {
  id: string;
  uid: string;
  displayName: string;
  label: string;
  teamAbbr: string;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: string;
  tailOf?: string | null;
  followOfName?: string | null;
  placedAt: number;
}

export interface ReportMemberInput {
  uid: string;
  displayName: string;
  netWorth: number;
  prevNetWorth?: number;
}

export interface ReportCard {
  kind: "biggest_hit" | "bad_beat" | "climber" | "faller" | "best_tail" | "coldest_streak";
  title: string;
  uid: string;
  displayName: string;
  headline: string;
  detail: string;
  value: number;
}

export interface LeagueReportDoc {
  week: string;
  leagueId: string;
  leagueName: string;
  generatedAt: number;
  totalBets: number;
  totalVolume: number;
  cards: ReportCard[];
}

/**
 * Builds the story cards for a league's weekly recap from settled bets and
 * member net-worth deltas.
 */
export function buildLeagueReport(args: {
  leagueId: string;
  leagueName: string;
  week: string;
  bets: ReportBetInput[];
  members: ReportMemberInput[];
  now: number;
}): LeagueReportDoc {
  const settled = args.bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "push");
  const won = settled.filter((b) => b.status === "won");
  const lost = settled.filter((b) => b.status === "lost");
  const cards: ReportCard[] = [];

  // 1. Biggest hit (largest net profit on a winning bet)
  if (won.length > 0) {
    const best = [...won].sort((a, b) => (b.potentialPayout - b.stake) - (a.potentialPayout - a.stake))[0]!;
    const profit = best.potentialPayout - best.stake;
    cards.push({
      kind: "biggest_hit",
      title: "Biggest Hit",
      uid: best.uid,
      displayName: best.displayName,
      headline: `${best.displayName} cashed +${profit.toLocaleString("en-US")} on ${best.label || best.teamAbbr}`,
      detail: `${best.stake.toLocaleString("en-US")} at ${best.odds.toFixed(2)}x paid ${best.potentialPayout.toLocaleString("en-US")}`,
      value: profit,
    });
  }

  // 2. Worst bad beat (loss at highest implied probability = lowest decimal odds, tiebreak largest stake)
  if (lost.length > 0) {
    const worst = [...lost].sort((a, b) => a.odds - b.odds || b.stake - a.stake)[0]!;
    const impliedPct = Math.round((1 / Math.max(1.01, worst.odds)) * 100);
    cards.push({
      kind: "bad_beat",
      title: "Worst Bad Beat",
      uid: worst.uid,
      displayName: worst.displayName,
      headline: `${worst.displayName} lost ${worst.stake.toLocaleString("en-US")} on a ${impliedPct}% favourite (${worst.label || worst.teamAbbr})`,
      detail: `Priced at ${worst.odds.toFixed(2)}x (${impliedPct}% implied chance)`,
      value: impliedPct,
    });
  }

  // Compute net delta per member (from explicit prevNetWorth if present, else from settled bets)
  const netByUid = new Map<string, number>();
  for (const m of args.members) {
    if (typeof m.prevNetWorth === "number") {
      netByUid.set(m.uid, m.netWorth - m.prevNetWorth);
    } else {
      netByUid.set(m.uid, 0);
    }
  }
  if (!args.members.some((m) => typeof m.prevNetWorth === "number")) {
    for (const b of settled) {
      const delta = b.status === "won" ? b.potentialPayout - b.stake : b.status === "lost" ? -b.stake : 0;
      netByUid.set(b.uid, (netByUid.get(b.uid) ?? 0) + delta);
    }
  }

  const deltas = args.members
    .map((m) => ({ ...m, delta: netByUid.get(m.uid) ?? 0 }))
    .sort((a, b) => b.delta - a.delta);

  // 3. Biggest climber
  const topClimber = deltas[0];
  if (topClimber && topClimber.delta > 0) {
    cards.push({
      kind: "climber",
      title: "Biggest Climber",
      uid: topClimber.uid,
      displayName: topClimber.displayName,
      headline: `${topClimber.displayName} climbed +${topClimber.delta.toLocaleString("en-US")} tokens`,
      detail: `Now sitting at ${topClimber.netWorth.toLocaleString("en-US")} net worth`,
      value: topClimber.delta,
    });
  }

  // 4. Biggest faller
  const topFaller = deltas[deltas.length - 1];
  if (topFaller && topFaller.delta < 0) {
    cards.push({
      kind: "faller",
      title: "Biggest Faller",
      uid: topFaller.uid,
      displayName: topFaller.displayName,
      headline: `${topFaller.displayName} dropped ${Math.abs(topFaller.delta).toLocaleString("en-US")} tokens`,
      detail: `Down to ${topFaller.netWorth.toLocaleString("en-US")} net worth`,
      value: topFaller.delta,
    });
  }

  // 5. Best tail
  const winningTails = won.filter((b) => !!b.tailOf);
  if (winningTails.length > 0) {
    const bestTail = [...winningTails].sort(
      (a, b) => (b.potentialPayout - b.stake) - (a.potentialPayout - a.stake)
    )[0]!;
    const profit = bestTail.potentialPayout - bestTail.stake;
    cards.push({
      kind: "best_tail",
      title: "Best Tail",
      uid: bestTail.uid,
      displayName: bestTail.displayName,
      headline: `${bestTail.displayName} rode ${bestTail.followOfName ?? "a league-mate"} on ${bestTail.label || bestTail.teamAbbr} for +${profit.toLocaleString("en-US")}`,
      detail: `Tailed at ${bestTail.odds.toFixed(2)}x`,
      value: profit,
    });
  }

  // 6. Coldest streak (most consecutive losses by a member)
  let coldest: { uid: string; displayName: string; streak: number } | null = null;
  const byMember = new Map<string, ReportBetInput[]>();
  for (const b of settled) {
    const list = byMember.get(b.uid) ?? [];
    list.push(b);
    byMember.set(b.uid, list);
  }
  for (const [uid, list] of byMember) {
    const ordered = [...list].sort((a, b) => a.placedAt - b.placedAt);
    let cur = 0;
    let maxLoss = 0;
    for (const b of ordered) {
      if (b.status === "lost") {
        cur++;
        if (cur > maxLoss) maxLoss = cur;
      } else if (b.status === "won") {
        cur = 0;
      }
    }
    if (maxLoss >= 2 && (!coldest || maxLoss > coldest.streak)) {
      coldest = { uid, displayName: ordered[0]!.displayName, streak: maxLoss };
    }
  }
  if (coldest) {
    cards.push({
      kind: "coldest_streak",
      title: "Coldest Streak",
      uid: coldest.uid,
      displayName: coldest.displayName,
      headline: `${coldest.displayName} dropped ${coldest.streak} straight picks`,
      detail: `${coldest.streak} losses in a row`,
      value: coldest.streak,
    });
  }

  return {
    week: args.week,
    leagueId: args.leagueId,
    leagueName: args.leagueName,
    generatedAt: args.now,
    totalBets: settled.length,
    totalVolume: settled.reduce((s, b) => s + b.stake, 0),
    cards,
  };
}

// ---------------------------------------------------------------------------
// Weekly Head-to-Head Matchups & Playoff Bracket
// ---------------------------------------------------------------------------

export interface MatchupSeed {
  uid: string;
  displayName: string;
  netWorth: number;
  w: number;
  l: number;
  t: number;
}

export interface MatchupPair {
  aUid: string;
  aName: string;
  bUid: string;
  bName: string;
  aStartNetWorth: number;
  bStartNetWorth: number;
  aEndNetWorth: number | null;
  bEndNetWorth: number | null;
  aDelta: number | null;
  bDelta: number | null;
  winnerUid: string | "tie" | null;
  bracket: "regular" | "playoff" | "consolation";
}

/**
 * Deterministic circle-method round-robin pairings for regular-season week `weekIndex`.
 * If there's an odd number of members, the last slot is a bye (omitted from pairs).
 */
export function roundRobinPairs(
  members: Array<{ uid: string; displayName: string; netWorth: number }>,
  weekIndex: number
): MatchupPair[] {
  const sorted = [...members].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  if (sorted.length < 2) return [];
  const pool: Array<{ uid: string; displayName: string; netWorth: number } | null> = [...sorted];
  if (pool.length % 2 === 1) pool.push(null);

  const n = pool.length;
  const fixed = pool[0]!;
  const rotating = pool.slice(1);
  const shift = ((weekIndex % (n - 1)) + (n - 1)) % (n - 1);
  const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];
  const order = [fixed, ...rotated];

  const pairs: MatchupPair[] = [];
  for (let i = 0; i < n / 2; i++) {
    const a = order[i];
    const b = order[n - 1 - i];
    if (!a || !b) continue;
    pairs.push({
      aUid: a.uid,
      aName: a.displayName,
      bUid: b.uid,
      bName: b.displayName,
      aStartNetWorth: a.netWorth,
      bStartNetWorth: b.netWorth,
      aEndNetWorth: null,
      bEndNetWorth: null,
      aDelta: null,
      bDelta: null,
      winnerUid: null,
      bracket: "regular",
    });
  }
  return pairs;
}

/**
 * Seeds members by H2H record (wins, then ties, then net worth tiebreaker) and
 * pairs #1 vs #2 for the championship and #3 vs #4 for third place.
 */
export function playoffPairs(seeds: MatchupSeed[]): MatchupPair[] {
  const ranked = [...seeds].sort(
    (a, b) =>
      b.w - a.w ||
      b.t - a.t ||
      a.l - b.l ||
      b.netWorth - a.netWorth ||
      (a.uid < b.uid ? -1 : 1)
  );
  const pairs: MatchupPair[] = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) {
    const a = ranked[i]!;
    const b = ranked[i + 1]!;
    pairs.push({
      aUid: a.uid,
      aName: a.displayName,
      bUid: b.uid,
      bName: b.displayName,
      aStartNetWorth: a.netWorth,
      bStartNetWorth: b.netWorth,
      aEndNetWorth: null,
      bEndNetWorth: null,
      aDelta: null,
      bDelta: null,
      winnerUid: null,
      bracket: i === 0 ? "playoff" : "consolation",
    });
  }
  return pairs;
}

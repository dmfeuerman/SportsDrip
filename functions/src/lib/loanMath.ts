/**
 * League loan math: flat, one-time interest, balance sheets and standings.
 * Pure functions, no imports — the server uses this to move tokens and the
 * client uses the identical file to display what is owed.
 *
 * KEEP IN SYNC: functions/src/lib/loanMath.ts and
 * artifacts/mobile/lib/loanMath.ts must be byte-identical. A test enforces it.
 *
 * Model
 * -----
 * A loan carries a fixed return: `ratePct` percent of the original principal,
 * charged once. Borrow 100 at 10% and the lender gets back exactly 110 — no
 * matter how long it takes, and never more. Nothing accrues over time and
 * interest is never charged on interest.
 *
 * Because the fee is a pure function of `principal` and `ratePct`, reading a
 * loan, opening a screen or re-running a job can never change what is owed.
 * Repayments settle the fee first, then principal; the total is the same
 * either way.
 *
 * `accruedThrough` and `intervalHours` are kept on stored loans for backward
 * compatibility only; they no longer affect any amount.
 *
 * Money is integer tokens. The fee is rounded once, half-up, so the display
 * and the server agree to the token.
 */

export const HOUR_MS = 3_600_000;

export type LoanKind = "bank" | "peer";
export type LoanStatus = "requested" | "countered" | "active" | "repaid" | "rejected" | "cancelled";

export interface LoanTerms {
  /** Amount originally borrowed. Never changes. */
  principal: number;
  /** Principal not yet repaid. */
  principalOutstanding: number;
  /** The flat fee: `flatInterest(principal, ratePct)`. */
  interestAccrued: number;
  /** Interest already repaid. */
  interestPaid: number;
  /** Legacy. Unused. */
  accruedThrough: number;
  /** Flat percent of the original principal, charged once. */
  ratePct: number;
  /** Legacy. Unused. */
  intervalHours: number;
}

export interface LoanSnapshot {
  principal: number;
  principalOutstanding: number;
  principalRepaid: number;
  /** The flat fee for the whole loan. */
  interestCharged: number;
  interestPaid: number;
  interestOutstanding: number;
  /** principalOutstanding + interestOutstanding. */
  totalOwed: number;
  /** principal + interestCharged — the most this loan can ever cost. */
  totalRepayable: number;
  /** principalRepaid + interestPaid. */
  totalRepaid: number;
}

/** The fixed return on a loan: ratePct of principal, once, rounded half-up. */
export function flatInterest(principal: number, ratePct: number): number {
  if (!(principal > 0) || !(ratePct > 0)) return 0;
  // Integer arithmetic: rate is at most two decimals.
  const rateHundredths = Math.round(ratePct * 100);
  return Math.floor((principal * rateHundredths + 5000) / 10000);
}

/** principal + flat fee. */
export function totalRepayable(principal: number, ratePct: number): number {
  return Math.max(0, Math.floor(principal)) + flatInterest(principal, ratePct);
}

/** Normalises a stored loan to the flat model. Idempotent. */
export function materialize(loan: LoanTerms, _now?: number): LoanTerms {
  const fee = flatInterest(loan.principal, loan.ratePct);
  return loan.interestAccrued === fee ? loan : { ...loan, interestAccrued: fee };
}

export function loanSnapshot(loan: LoanTerms, _now?: number): LoanSnapshot {
  const m = materialize(loan);
  const principalOutstanding = Math.max(0, m.principalOutstanding);
  const interestPaid = Math.min(m.interestPaid, m.interestAccrued);
  const interestOutstanding = Math.max(0, m.interestAccrued - m.interestPaid);
  const principalRepaid = Math.max(0, m.principal - principalOutstanding);
  return {
    principal: m.principal,
    principalOutstanding,
    principalRepaid,
    interestCharged: m.interestAccrued,
    interestPaid,
    interestOutstanding,
    totalOwed: principalOutstanding + interestOutstanding,
    totalRepayable: m.principal + m.interestAccrued,
    totalRepaid: principalRepaid + interestPaid,
  };
}

export interface RepaymentResult {
  loan: LoanTerms;
  /** What was actually taken — never more than was owed. */
  applied: number;
  toInterest: number;
  toPrincipal: number;
  /** True when nothing is owed afterwards. */
  settled: boolean;
}

/** Applies a repayment: the flat fee first, then principal. */
export function applyRepayment(loan: LoanTerms, amount: number, _now?: number): RepaymentResult {
  const m = materialize(loan);
  const pay = Math.max(0, Math.floor(amount));
  const interestDue = Math.max(0, m.interestAccrued - m.interestPaid);
  const toInterest = Math.min(pay, interestDue);
  const toPrincipal = Math.min(pay - toInterest, Math.max(0, m.principalOutstanding));
  const next: LoanTerms = {
    ...m,
    interestPaid: m.interestPaid + toInterest,
    principalOutstanding: m.principalOutstanding - toPrincipal,
  };
  const settled = next.principalOutstanding <= 0 && next.interestAccrued - next.interestPaid <= 0;
  return { loan: next, applied: toInterest + toPrincipal, toInterest, toPrincipal, settled };
}

/** A fresh loan with its flat fee already set. */
export function newLoanTerms(principal: number, ratePct: number, intervalHours: number, now: number): LoanTerms {
  return {
    principal,
    principalOutstanding: principal,
    interestAccrued: flatInterest(principal, ratePct),
    interestPaid: 0,
    accruedThrough: now,
    ratePct,
    intervalHours,
  };
}

// ---------------------------------------------------------------------------
// Balance sheets and standings
// ---------------------------------------------------------------------------

export interface LeagueLoanLike extends LoanTerms {
  kind: LoanKind;
  status: LoanStatus;
  borrowerId: string;
  lenderId: string | null;
}

export interface BalanceSheet {
  tokens: number;
  /** Everything this member owes, bank and peer, interest included. */
  debt: number;
  bankDebt: number;
  peerDebt: number;
  /** What other members owe this member. */
  receivable: number;
  /** tokens + receivable - debt. Standings rank on this. */
  netWorth: number;
}

export function balanceSheet(uid: string, tokens: number, loans: LeagueLoanLike[], now: number): BalanceSheet {
  let bankDebt = 0;
  let peerDebt = 0;
  let receivable = 0;
  for (const loan of loans) {
    if (loan.status !== "active") continue;
    const owed = loanSnapshot(loan, now).totalOwed;
    if (loan.borrowerId === uid) {
      if (loan.kind === "bank") bankDebt += owed;
      else peerDebt += owed;
    } else if (loan.lenderId === uid) {
      receivable += owed;
    }
  }
  const debt = bankDebt + peerDebt;
  return { tokens, debt, bankDebt, peerDebt, receivable, netWorth: tokens + receivable - debt };
}

export interface StandingMember {
  uid: string;
  leagueTokens: number;
  joinedAt: number;
}

export interface Standing extends BalanceSheet {
  uid: string;
  rank: number;
}

/**
 * Ranks on net worth, not on raw tokens — otherwise borrowing would be a free
 * climb up the table. Ties break on fewer tokens owed (`debt`), then earlier
 * join, then uid, so every device and the server produce the same order.
 */
export function rankMembers(members: StandingMember[], loans: LeagueLoanLike[], now: number): Standing[] {
  return members
    .map((m) => ({ uid: m.uid, joinedAt: m.joinedAt, ...balanceSheet(m.uid, m.leagueTokens, loans, now) }))
    .sort(
      (a, b) =>
        b.netWorth - a.netWorth ||
        a.debt - b.debt ||
        a.joinedAt - b.joinedAt ||
        (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
    )
    .map(({ joinedAt: _j, ...s }, i) => ({ ...s, rank: i + 1 }));
}

/**
 * H2H leagues (mode "matchups") rank on head-to-head record — 2 points a win,
 * 1 a tie — with net worth breaking ties. Matches the server's season end.
 * Other modes keep the net-worth order.
 */
export function rankByMode(
  standings: Standing[],
  mode: string | undefined,
  h2h: (uid: string) => { w?: number; l?: number; t?: number } | undefined
): Standing[] {
  if (mode !== "matchups") return standings;
  const pts = (uid: string) => {
    const h = h2h(uid);
    return (h?.w ?? 0) * 2 + (h?.t ?? 0);
  };
  const sorted = [...standings].sort((a, b) => pts(b.uid) - pts(a.uid) || b.netWorth - a.netWorth || (a.uid < b.uid ? -1 : 1));
  let rank = 1;
  return sorted.map((s, i) => {
    const prev = sorted[i - 1];
    if (prev && (pts(prev.uid) !== pts(s.uid) || prev.netWorth !== s.netWorth)) rank = i + 1;
    return { ...s, rank };
  });
}

export interface PrizeShares {
  firstPct: number;
  secondPct: number;
  thirdPct: number;
}

/**
 * Splits a pot across ranked places. Percentages for places nobody occupies
 * roll up to first, and the rounding remainder goes to first, so the payouts
 * always sum to exactly the pot.
 *
 * When `netWorths` (ordered by standing) is supplied, members tied on net worth
 * pool the prizes of the places they span and split them equally.
 */
export function prizeSplit(pot: number, shares: PrizeShares, memberCount: number, netWorths?: number[]): number[] {
  const totalMembers = netWorths ? netWorths.length : memberCount;
  const n = Math.max(0, Math.min(3, totalMembers));
  if (pot <= 0 || n === 0) return [];
  const pcts = [shares.firstPct, shares.secondPct, shares.thirdPct].map((p) => Math.max(0, p));
  const totalPct = pcts.reduce((s, p) => s + p, 0) || 100;
  const base: number[] = [];
  for (let i = 0; i < n; i++) base.push(Math.floor((pot * pcts[i]!) / totalPct));
  const paid = base.reduce((s, x) => s + x, 0);
  base[0] = base[0]! + (pot - paid);

  if (!netWorths || netWorths.length === 0) return base;

  const slotPrizes = Array.from({ length: netWorths.length }, (_, i) => base[i] ?? 0);
  const out = new Array<number>(netWorths.length).fill(0);
  let i = 0;
  while (i < netWorths.length) {
    let j = i + 1;
    while (j < netWorths.length && netWorths[j] === netWorths[i]) j++;
    const count = j - i;
    let pool = 0;
    for (let k = i; k < j; k++) pool += slotPrizes[k]!;
    const each = Math.floor(pool / count);
    const rem = pool - each * count;
    for (let k = i; k < j; k++) {
      out[k] = each + (k - i < rem ? 1 : 0);
    }
    i = j;
  }
  return out;
}

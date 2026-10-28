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
 * climb up the table. Ties break on earlier join, then uid, so every device
 * and the server produce the same order.
 */
export function rankMembers(members: StandingMember[], loans: LeagueLoanLike[], now: number): Standing[] {
  return members
    .map((m) => ({ uid: m.uid, joinedAt: m.joinedAt, ...balanceSheet(m.uid, m.leagueTokens, loans, now) }))
    .sort((a, b) => b.netWorth - a.netWorth || a.joinedAt - b.joinedAt || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
    .map(({ joinedAt: _j, ...s }, i) => ({ ...s, rank: i + 1 }));
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
 */
export function prizeSplit(pot: number, shares: PrizeShares, memberCount: number): number[] {
  const n = Math.max(0, Math.min(3, memberCount));
  if (pot <= 0 || n === 0) return [];
  const pcts = [shares.firstPct, shares.secondPct, shares.thirdPct].map((p) => Math.max(0, p));
  const totalPct = pcts.reduce((s, p) => s + p, 0) || 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.floor((pot * pcts[i]!) / totalPct));
  const paid = out.reduce((s, x) => s + x, 0);
  out[0] = out[0]! + (pot - paid);
  return out;
}

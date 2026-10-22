/**
 * League loan math: simple (non-compounding) interest, balance sheets and
 * standings. Pure functions, no imports — the server uses this to move tokens
 * and the client uses the identical file to display what is owed.
 *
 * KEEP IN SYNC: functions/src/lib/loanMath.ts and
 * artifacts/mobile/lib/loanMath.ts must be byte-identical. A test enforces it.
 *
 * Model
 * -----
 * A loan charges `ratePct` percent of its *outstanding principal* once per
 * `intervalHours`. Interest is never charged on interest: `interestAccrued` is
 * tracked separately from `principalOutstanding` and is not part of the base.
 *
 * Interest is not written on a timer. It is a pure function of the loan and
 * the clock: `accruedThrough` marks how far interest has been folded into
 * `interestAccrued`, always advanced by whole periods. Reading a loan, opening
 * a screen, or re-running a job therefore cannot charge interest twice — the
 * same inputs always give the same number.
 *
 * Interest is only materialised when the principal changes (a repayment),
 * because that is the only time the base for future periods changes.
 * Repayments settle accrued interest first, then principal.
 *
 * Money is integer tokens. Each constant-principal segment is rounded once,
 * half-up, so the display and the server agree to the token.
 */

export const HOUR_MS = 3_600_000;

export type LoanKind = "bank" | "peer";
export type LoanStatus = "requested" | "countered" | "active" | "repaid" | "rejected" | "cancelled";

export interface LoanTerms {
  /** Amount originally borrowed. Never changes. */
  principal: number;
  /** Principal not yet repaid. Interest accrues on this. */
  principalOutstanding: number;
  /** Interest folded in up to `accruedThrough`. */
  interestAccrued: number;
  /** Interest already repaid. */
  interestPaid: number;
  /** Epoch ms. Interest is settled up to here, in whole periods. */
  accruedThrough: number;
  /** Percent of outstanding principal charged per period. */
  ratePct: number;
  /** Hours per period. */
  intervalHours: number;
}

export interface LoanSnapshot {
  principal: number;
  principalOutstanding: number;
  principalRepaid: number;
  /** All interest charged so far, including periods not yet materialised. */
  interestCharged: number;
  interestPaid: number;
  interestOutstanding: number;
  /** principalOutstanding + interestOutstanding. */
  totalOwed: number;
  /** Interest the next period will add at the current principal. */
  nextPeriodInterest: number;
  /** Epoch ms of the next charge, or null when nothing is outstanding. */
  nextAccrualAt: number | null;
}

/** Whole periods between two instants. Never negative. */
export function periodsBetween(from: number, to: number, intervalHours: number): number {
  if (!(intervalHours > 0) || !(to > from)) return 0;
  return Math.floor((to - from) / (intervalHours * HOUR_MS));
}

/** Simple interest on a fixed principal, rounded half-up to whole tokens. */
export function simpleInterest(principal: number, ratePct: number, periods: number): number {
  if (!(principal > 0) || !(ratePct > 0) || !(periods > 0)) return 0;
  // Integer arithmetic where possible: rate is at most two decimals.
  const rateHundredths = Math.round(ratePct * 100);
  return Math.floor((principal * rateHundredths * periods + 5000) / 10000);
}

/** Interest accrued since `accruedThrough` but not yet folded in. */
export function pendingInterest(loan: LoanTerms, now: number): number {
  const periods = periodsBetween(loan.accruedThrough, now, loan.intervalHours);
  return simpleInterest(loan.principalOutstanding, loan.ratePct, periods);
}

/**
 * Folds every whole elapsed period into `interestAccrued`. Idempotent:
 * materialising twice at the same instant is the same as once.
 */
export function materialize(loan: LoanTerms, now: number): LoanTerms {
  const periods = periodsBetween(loan.accruedThrough, now, loan.intervalHours);
  if (periods <= 0) return loan;
  return {
    ...loan,
    interestAccrued: loan.interestAccrued + simpleInterest(loan.principalOutstanding, loan.ratePct, periods),
    accruedThrough: loan.accruedThrough + periods * loan.intervalHours * HOUR_MS,
  };
}

export function loanSnapshot(loan: LoanTerms, now: number): LoanSnapshot {
  const m = materialize(loan, now);
  const interestOutstanding = Math.max(0, m.interestAccrued - m.interestPaid);
  const principalOutstanding = Math.max(0, m.principalOutstanding);
  const totalOwed = principalOutstanding + interestOutstanding;
  const live = principalOutstanding > 0;
  return {
    principal: m.principal,
    principalOutstanding,
    principalRepaid: Math.max(0, m.principal - principalOutstanding),
    interestCharged: m.interestAccrued,
    interestPaid: m.interestPaid,
    interestOutstanding,
    totalOwed,
    nextPeriodInterest: live ? simpleInterest(principalOutstanding, m.ratePct, 1) : 0,
    nextAccrualAt: live ? m.accruedThrough + m.intervalHours * HOUR_MS : null,
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

/** Applies a repayment: accrued interest first, then principal. */
export function applyRepayment(loan: LoanTerms, amount: number, now: number): RepaymentResult {
  const m = materialize(loan, now);
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

/** A fresh, unaccrued loan. */
export function newLoanTerms(principal: number, ratePct: number, intervalHours: number, now: number): LoanTerms {
  return {
    principal,
    principalOutstanding: principal,
    interestAccrued: 0,
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

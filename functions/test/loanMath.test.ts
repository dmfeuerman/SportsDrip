import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOUR_MS,
  applyRepayment,
  balanceSheet,
  loanSnapshot,
  materialize,
  newLoanTerms,
  pendingInterest,
  prizeSplit,
  rankMembers,
  simpleInterest,
  type LeagueLoanLike,
} from "../src/lib/loanMath";

const T0 = Date.UTC(2026, 0, 1);
const day = 24 * HOUR_MS;

test("the spec example: 1,000 at 10% per period for 2 periods accrues 200, owes 1,200", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  const snap = loanSnapshot(loan, T0 + 2 * day);
  assert.equal(snap.interestCharged, 200);
  assert.equal(snap.totalOwed, 1200);
  assert.equal(snap.principalOutstanding, 1000);
});

test("interest never compounds: 10 periods at 10% is exactly 100% of principal", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  assert.equal(loanSnapshot(loan, T0 + 10 * day).interestCharged, 1000);
  // The old code multiplied the running balance: 1000 * 1.1^10 - 1000 = 1594.
  assert.notEqual(loanSnapshot(loan, T0 + 10 * day).interestCharged, 1594);
});

test("partial periods don't accrue; the next charge time is reported", () => {
  const loan = newLoanTerms(500, 5, 24, T0);
  const s = loanSnapshot(loan, T0 + 23 * HOUR_MS);
  assert.equal(s.interestCharged, 0);
  assert.equal(s.nextAccrualAt, T0 + day);
  assert.equal(s.nextPeriodInterest, 25);
});

test("reading or materialising repeatedly never charges twice", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  const now = T0 + 3 * day + 5 * HOUR_MS;
  const once = materialize(loan, now);
  const twice = materialize(once, now);
  assert.deepEqual(once, twice);
  assert.equal(once.interestAccrued, 300);
  assert.equal(once.accruedThrough, T0 + 3 * day);
  assert.equal(pendingInterest(once, now), 0);
  for (let i = 0; i < 50; i++) assert.equal(loanSnapshot(loan, now).totalOwed, 1300);
});

test("repayments settle interest first, then principal; interest then runs on the lower principal", () => {
  let loan = newLoanTerms(1000, 10, 24, T0);
  // After 2 days: 200 interest due. Pay 500 → 200 interest, 300 principal.
  const r1 = applyRepayment(loan, 500, T0 + 2 * day);
  assert.equal(r1.toInterest, 200);
  assert.equal(r1.toPrincipal, 300);
  assert.equal(r1.settled, false);
  loan = r1.loan;
  assert.equal(loan.principalOutstanding, 700);
  // One more day accrues 10% of 700, not of 1000 and not of the old balance.
  const s = loanSnapshot(loan, T0 + 3 * day);
  assert.equal(s.interestOutstanding, 70);
  assert.equal(s.totalOwed, 770);
  assert.equal(s.interestCharged, 270);
  assert.equal(s.principalRepaid, 300);
});

test("overpaying is clamped to what's owed and closes the loan", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  const r = applyRepayment(loan, 99_999, T0 + day);
  assert.equal(r.applied, 1100);
  assert.equal(r.settled, true);
  assert.equal(loanSnapshot(r.loan, T0 + 30 * day).totalOwed, 0);
});

test("a repaid loan stops accruing", () => {
  const r = applyRepayment(newLoanTerms(200, 10, 1, T0), 200, T0 + 30 * 60_000);
  assert.equal(r.settled, true);
  assert.equal(loanSnapshot(r.loan, T0 + 1000 * HOUR_MS).totalOwed, 0);
});

test("rounding is half-up per segment and fractional rates work", () => {
  assert.equal(simpleInterest(333, 2.5, 1), 8); // 8.325
  assert.equal(simpleInterest(330, 2.5, 1), 8); // 8.25
  assert.equal(simpleInterest(340, 2.5, 1), 9); // 8.5 → 9
  assert.equal(simpleInterest(1000, 0.5, 3), 15);
  assert.equal(simpleInterest(0, 10, 3), 0);
  assert.equal(simpleInterest(100, 10, 0), 0);
});

const loanLike = (over: Partial<LeagueLoanLike>): LeagueLoanLike => ({
  ...newLoanTerms(1000, 10, 24, T0),
  kind: "bank",
  status: "active",
  borrowerId: "a",
  lenderId: null,
  ...over,
});

test("balance sheet: borrowing doesn't change net worth on the day it's taken", () => {
  const sheet = balanceSheet("a", 2000, [loanLike({})], T0);
  assert.equal(sheet.debt, 1000);
  assert.equal(sheet.netWorth, 1000);
});

test("balance sheet: peer loans are a liability to the borrower and an asset to the lender", () => {
  const peer = loanLike({ kind: "peer", borrowerId: "a", lenderId: "b" });
  const now = T0 + day;
  assert.deepEqual(
    [balanceSheet("a", 0, [peer], now).peerDebt, balanceSheet("b", 0, [peer], now).receivable],
    [1100, 1100]
  );
  const inactive = loanLike({ status: "requested" });
  assert.equal(balanceSheet("a", 0, [inactive], now).debt, 0);
});

test("standings rank on net worth with deterministic tie-breaks", () => {
  const loans = [loanLike({ borrowerId: "rich-on-paper" })];
  const ranked = rankMembers(
    [
      { uid: "rich-on-paper", leagueTokens: 1800, joinedAt: 1 },
      { uid: "steady", leagueTokens: 1200, joinedAt: 2 },
      { uid: "tie-late", leagueTokens: 800, joinedAt: 9 },
      { uid: "tie-early", leagueTokens: 800, joinedAt: 3 },
    ],
    loans,
    T0
  );
  assert.deepEqual(ranked.map((r) => r.uid), ["steady", "rich-on-paper", "tie-early", "tie-late"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
});

test("prize split always sums to the pot and rolls unused places up to first", () => {
  assert.deepEqual(prizeSplit(1000, { firstPct: 60, secondPct: 30, thirdPct: 10 }, 5), [600, 300, 100]);
  assert.deepEqual(prizeSplit(1000, { firstPct: 60, secondPct: 30, thirdPct: 10 }, 2), [700, 300]);
  assert.deepEqual(prizeSplit(1000, { firstPct: 60, secondPct: 30, thirdPct: 10 }, 1), [1000]);
  const odd = prizeSplit(101, { firstPct: 70, secondPct: 30, thirdPct: 0 }, 4);
  assert.equal(odd.reduce((s, x) => s + x, 0), 101);
  assert.deepEqual(prizeSplit(0, { firstPct: 100, secondPct: 0, thirdPct: 0 }, 3), []);
});

test("client and server copies of loanMath are identical", () => {
  // Run from functions/ (npm test).
  const root = process.cwd();
  const server = readFileSync(join(root, "src", "lib", "loanMath.ts"), "utf8");
  const client = readFileSync(join(root, "..", "artifacts", "mobile", "lib", "loanMath.ts"), "utf8");
  assert.equal(client, server, "artifacts/mobile/lib/loanMath.ts has drifted from functions/src/lib/loanMath.ts");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOUR_MS,
  applyRepayment,
  balanceSheet,
  flatInterest,
  loanSnapshot,
  materialize,
  newLoanTerms,
  prizeSplit,
  rankMembers,
  totalRepayable,
  type LeagueLoanLike,
} from "../src/lib/loanMath";

const T0 = Date.UTC(2026, 0, 1);
const day = 24 * HOUR_MS;

test("the spec example: borrow 100 at 10% and repay exactly 110", () => {
  const loan = newLoanTerms(100, 10, 24, T0);
  const snap = loanSnapshot(loan, T0);
  assert.equal(snap.interestCharged, 10);
  assert.equal(snap.totalOwed, 110);
  assert.equal(snap.totalRepayable, 110);
  assert.equal(totalRepayable(100, 10), 110);
});

test("interest never grows with time", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  for (const t of [T0, T0 + HOUR_MS, T0 + day, T0 + 30 * day, T0 + 3650 * day]) {
    assert.equal(loanSnapshot(loan, t).interestCharged, 100);
    assert.equal(loanSnapshot(loan, t).totalOwed, 1100);
  }
});

test("reading or materialising repeatedly never charges twice", () => {
  const loan = newLoanTerms(1000, 10, 24, T0);
  const once = materialize(loan, T0 + 5 * day);
  assert.deepEqual(materialize(once, T0 + 50 * day), once);
  assert.equal(once.interestAccrued, 100);
});

test("legacy loans with period-accrued interest are normalised to the flat fee", () => {
  const legacy = { ...newLoanTerms(1000, 10, 24, T0), interestAccrued: 700 };
  assert.equal(loanSnapshot(legacy, T0).interestCharged, 100);
  assert.equal(loanSnapshot(legacy, T0).totalOwed, 1100);
  const overpaid = { ...legacy, interestPaid: 300 };
  assert.equal(loanSnapshot(overpaid, T0).interestOutstanding, 0);
  assert.equal(loanSnapshot(overpaid, T0).totalOwed, 1000);
});

test("repayments settle the fee first, then principal; the total never changes", () => {
  let loan = newLoanTerms(1000, 10, 24, T0);
  const r1 = applyRepayment(loan, 500, T0 + 2 * day);
  assert.equal(r1.toInterest, 100);
  assert.equal(r1.toPrincipal, 400);
  assert.equal(r1.settled, false);
  loan = r1.loan;
  const s = loanSnapshot(loan, T0 + 300 * day);
  assert.equal(s.principalOutstanding, 600);
  assert.equal(s.interestOutstanding, 0);
  assert.equal(s.totalOwed, 600);
  assert.equal(s.totalRepaid, 500);
  const r2 = applyRepayment(loan, 600, T0 + 400 * day);
  assert.equal(r2.settled, true);
  assert.equal(r1.applied + r2.applied, 1100);
});

test("paying back only the principal still leaves the fee owed", () => {
  const r = applyRepayment(newLoanTerms(100, 10, 24, T0), 100, T0);
  assert.equal(r.settled, false);
  assert.equal(loanSnapshot(r.loan, T0).totalOwed, 10);
});

test("overpaying is clamped to principal + fee and closes the loan", () => {
  const r = applyRepayment(newLoanTerms(1000, 10, 24, T0), 99_999, T0 + day);
  assert.equal(r.applied, 1100);
  assert.equal(r.settled, true);
  assert.equal(loanSnapshot(r.loan, T0 + 30 * day).totalOwed, 0);
});

test("rounding is half-up and fractional rates work", () => {
  assert.equal(flatInterest(333, 2.5), 8); // 8.325
  assert.equal(flatInterest(330, 2.5), 8); // 8.25
  assert.equal(flatInterest(340, 2.5), 9); // 8.5 → 9
  assert.equal(flatInterest(1000, 0.5), 5);
  assert.equal(flatInterest(0, 10), 0);
  assert.equal(flatInterest(100, 0), 0);
});

const loanLike = (over: Partial<LeagueLoanLike>): LeagueLoanLike => ({
  ...newLoanTerms(1000, 10, 24, T0),
  kind: "bank",
  status: "active",
  borrowerId: "a",
  lenderId: null,
  ...over,
});

test("balance sheet: a loan is a liability of principal + flat fee from day one", () => {
  const sheet = balanceSheet("a", 2000, [loanLike({})], T0);
  assert.equal(sheet.debt, 1100);
  assert.equal(sheet.netWorth, 900);
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
      { uid: "rich-on-paper", leagueTokens: 1950, joinedAt: 1 }, // 1950 - (1000 + 100 fee) = 850
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

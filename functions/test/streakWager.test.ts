import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWager, wagerProgress } from "../src/lib/streakWager";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 10, 10, 17); // noon ET
const day = (n: number) => new Date(Date.UTC(2026, 10, 10 + n)).toISOString().slice(0, 10);
const w = { stake: 100, startCount: 3, startDay: day(0), target: 10 };

test("streak wager: stays active while the streak is alive and short of the target", () => {
  assert.equal(evaluateWager(w, { count: 6, lastDay: day(3) }, t0 + 3 * DAY), "active");
  assert.equal(wagerProgress(w, { count: 6 }), 3);
});
test("streak wager: reaching the target wins", () => {
  assert.equal(evaluateWager(w, { count: 10, lastDay: day(7) }, t0 + 7 * DAY), "won");
});
test("streak wager: a lapsed or reset streak loses", () => {
  assert.equal(evaluateWager(w, { count: 5, lastDay: day(2) }, t0 + 5 * DAY), "lost");
  assert.equal(evaluateWager(w, { count: 1, lastDay: day(5) }, t0 + 5 * DAY), "lost");
});
test("streak wager: a same-day repair in progress is not a loss yet", () => {
  const now = t0 + 5 * DAY;
  assert.equal(evaluateWager(w, { count: 1, lastDay: day(5), repairPending: { day: day(5), needed: 2, done: 1, from: 5 } }, now), "active");
});
test("streak wager: placed with no streak, still active that day, lost if no pick follows", () => {
  const fresh = { stake: 50, startCount: 0, startDay: day(0), target: 7 };
  assert.equal(evaluateWager(fresh, null, t0), "active");
  assert.equal(evaluateWager(fresh, null, t0 + 2 * DAY), "lost");
});

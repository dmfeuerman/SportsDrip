import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceStreak, daysBetween } from "../src/lib/streak";

const at = (ymd: string) => Date.parse(`${ymd}T17:00:00Z`); // midday ET

test("one missed day with no freeze: two actions today restore count + 1", () => {
  const prev = { count: 5, longest: 5, lastDay: "2026-10-10", freezes: 0 };
  const first = advanceStreak(prev, at("2026-10-12"));
  assert.equal(first.count, 1);
  assert.deepEqual(first.repairPending, { day: "2026-10-12", needed: 2, done: 1, from: 5 });
  const second = advanceStreak(first, at("2026-10-12") + 60_000);
  assert.equal(second.count, 6);
  assert.equal(second.repairPending, null);
  // A third action the same day changes nothing.
  assert.equal(advanceStreak(second, at("2026-10-12") + 120_000).count, 6);
});

test("repair lapses if the second action isn't the same day", () => {
  const first = advanceStreak({ count: 5, longest: 5, lastDay: "2026-10-10", freezes: 0 }, at("2026-10-12"));
  const next = advanceStreak(first, at("2026-10-13"));
  assert.equal(next.count, 2);
  assert.equal(next.repairPending, null);
});

test("a freeze still covers the missed day without needing a repair", () => {
  const s = advanceStreak({ count: 8, longest: 8, lastDay: "2026-10-10", freezes: 1 }, at("2026-10-12"));
  assert.equal(s.count, 9);
  assert.equal(s.freezes, 0);
  assert.equal(s.repairPending, null);
});

test("no-game days are neutral", () => {
  assert.deepEqual(daysBetween("2026-10-10", "2026-10-13"), ["2026-10-11", "2026-10-12"]);
  const empty = new Set(["2026-10-11"]);
  assert.equal(advanceStreak({ count: 3, longest: 3, lastDay: "2026-10-10" }, at("2026-10-12"), { emptyDays: empty }).count, 4);
  // Two missed days, one empty → counts as one miss → repair offered.
  const s = advanceStreak({ count: 3, longest: 3, lastDay: "2026-10-10" }, at("2026-10-13"), { emptyDays: empty });
  assert.equal(s.repairPending?.from, 3);
});

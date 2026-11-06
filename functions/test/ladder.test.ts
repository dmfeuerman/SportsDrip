import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCohorts, closeCohort, cohortSizes } from "../src/lib/ladder";

test("cohorts are 10–15, friends seeded together", () => {
  assert.deepEqual(cohortSizes(9), [9]);
  assert.deepEqual(cohortSizes(15), [15]);
  assert.deepEqual(cohortSizes(16), [16]);
  for (const n of [20, 30, 31, 44, 200]) for (const s of cohortSizes(n)) assert.ok(s >= 10 && s <= 15, `${n}:${s}`);
  const uids = Array.from({ length: 30 }, (_, i) => `u${String(i).padStart(2, "0")}`);
  const cohorts = buildCohorts(uids, (u) => (u === "u00" ? ["u29", "u28"] : []));
  assert.ok(cohorts[0]!.includes("u29") && cohorts[0]!.includes("u28"));
  assert.equal(cohorts.flat().length, 30);
});

test("close promotes top 3 and relegates bottom 3", () => {
  const scores = Array.from({ length: 10 }, (_, i) => ({ uid: `p${i}`, score: 10 - i }));
  const moves = closeCohort("silver", scores);
  assert.deepEqual(moves.filter((m) => m.result === "promoted").map((m) => m.uid), ["p0", "p1", "p2"]);
  assert.deepEqual(moves.filter((m) => m.result === "relegated").map((m) => m.uid), ["p7", "p8", "p9"]);
  assert.equal(closeCohort("bronze", scores).filter((m) => m.result === "relegated").length, 0);
  assert.equal(closeCohort("diamond", scores).filter((m) => m.result === "promoted").length, 0);
  assert.equal(closeCohort("gold", scores.slice(0, 5)).filter((m) => m.result !== "stayed").length, 0);
});

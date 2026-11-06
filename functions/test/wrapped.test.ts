import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWrapped } from "../src/lib/wrapped";

test("wrapped: record, best call, worst beat, rival and top team", () => {
  const w = buildWrapped({
    uid: "ann",
    periodId: "L1",
    title: "Office",
    bets: [
      { status: "won", odds: 1.8, stake: 50, teamAbbr: "BOS" },
      { status: "won", odds: 3.2, stake: 20, teamAbbr: "MIA" },
      { status: "lost", odds: 2, stake: 200, teamAbbr: "BOS" },
      { status: "push", odds: 1.9, stake: 10, teamAbbr: "BOS" },
      { status: "pending", odds: 1.9, stake: 10, teamAbbr: "NYK" },
    ],
    rivalries: [
      { aUid: "ann", bUid: "ben", aName: "Ann", bName: "Ben", aWins: 3, bWins: 1 },
      { aUid: "cat", bUid: "ann", aName: "Cat", bName: "Ann", aWins: 1, bWins: 0 },
    ],
    streakBest: 9,
    xp: 0,
    achievements: 2,
    now: 1,
  });
  assert.deepEqual(w.record, { w: 2, l: 1, p: 1 });
  assert.deepEqual(w.bestCall, { label: "MIA", odds: 3.2 });
  assert.deepEqual(w.worstBeat, { label: "BOS", stake: 200 });
  assert.equal(w.rival?.uid, "ben");
  assert.deepEqual(w.topTeam, { abbr: "BOS", picks: 3 });
});

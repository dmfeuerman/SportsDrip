import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePicks, scoreBracket, slotOptions, validateTemplate, type BracketTemplate } from "../src/lib/bracket";

const t: BracketTemplate = {
  id: "t",
  name: "Mini",
  locksAt: 0,
  slots: [
    { id: "r1a", round: 1, teams: ["AAA", "BBB"], gameId: "g1" },
    { id: "r1b", round: 1, teams: ["CCC", "DDD"], gameId: "g2" },
    { id: "f", round: 2, feeds: ["r1a", "r1b"], gameId: "g3" },
  ],
};

test("bracket: structure, cascading picks and 1-2-4 scoring", () => {
  validateTemplate(t);
  assert.throws(() => validateTemplate({ ...t, slots: [...t.slots, { id: "x", round: 3, feeds: ["r1a", "f"] }] }), /feeder/);
  const picks = sanitizePicks(t, { r1a: "AAA", r1b: "DDD", f: "DDD" });
  assert.deepEqual(slotOptions(t, picks, "f"), ["AAA", "DDD"]);
  // A final pick not fed by your own round-1 picks is dropped.
  assert.equal(sanitizePicks(t, { r1a: "AAA", r1b: "DDD", f: "CCC" }).f, undefined);
  assert.deepEqual(scoreBracket({ ...t, results: { r1a: "AAA", r1b: "CCC" } }, picks), { points: 1, correct: 1 });
  assert.deepEqual(scoreBracket({ ...t, results: { r1a: "AAA", r1b: "DDD", f: "DDD" } }, picks), { points: 4, correct: 3 });
});

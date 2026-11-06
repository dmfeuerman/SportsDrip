import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextReactionProgress } from "../src/lib/questProgress";
import { QUESTS } from "../src/callable/quests";

test("social quest counts distinct items, so toggling can't farm it", () => {
  const a = nextReactionProgress(undefined, "L_messages_m1")!;
  assert.equal(a.reactions, 1);
  assert.equal(nextReactionProgress(a, "L_messages_m1"), null);
  assert.equal(nextReactionProgress(a, "dm_x")!.reactions, 2);
  assert.ok(QUESTS.some((q) => q.id === "react2" && q.kind === "social" && q.target === 2));
});

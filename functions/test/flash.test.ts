import assert from "node:assert/strict";
import { test } from "node:test";
import { decideFlash } from "../src/lib/flash";

const pick = { side: "home" as const, homeAt: 7, awayAt: 3 };

test("flash pick: nothing scored yet stays open", () => {
  assert.equal(decideFlash(pick, 7, 3, "live"), null);
});
test("flash pick: your side scores next wins, other side loses", () => {
  assert.equal(decideFlash(pick, 14, 3, "live"), "won");
  assert.equal(decideFlash(pick, 7, 6, "live"), "lost");
});
test("flash pick: both scored between samples, bigger gain takes it, equal pushes", () => {
  assert.equal(decideFlash(pick, 14, 6, "live"), "won");
  assert.equal(decideFlash(pick, 9, 6, "live"), "lost");
  assert.equal(decideFlash(pick, 10, 6, "live"), "push");
});
test("flash pick: game ends with no score, or a score is corrected down, pushes", () => {
  assert.equal(decideFlash(pick, 7, 3, "final"), "push");
  assert.equal(decideFlash(pick, 6, 3, "live"), "push");
  assert.equal(decideFlash(pick, null, null, "final"), "push");
});

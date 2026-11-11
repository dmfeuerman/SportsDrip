import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_POOL, CHALLENGE_SLOTS, challengeById, dealChallenges } from "../src/lib/levelChallenges";

test("level 1 deals explore challenges, including the theme one", () => {
  const all: string[] = [];
  let active: string[] = [];
  const claimed: Record<string, boolean> = {};
  for (let i = 0; i < 20; i++) {
    active = dealChallenges(active, claimed, 1);
    if (!active.length) break;
    for (const id of active) if (!all.includes(id)) all.push(id);
    claimed[active[0]!] = true;
  }
  assert.ok(all.includes("x_theme"));
  assert.ok(all.every((id) => challengeById(id)!.minLevel === 1));
});

test("unfinished challenges carry over when the player levels up", () => {
  const l1 = dealChallenges([], {}, 1);
  const l5 = dealChallenges(l1, {}, 5);
  assert.deepEqual(l5, l1);
});

test("a claimed slot is refilled, preferring harder tiers once explore is done", () => {
  const claimed = Object.fromEntries(CHALLENGE_POOL.filter((c) => c.explore).map((c) => [c.id, true]));
  const hi = dealChallenges([], claimed, 12);
  assert.equal(hi.length, CHALLENGE_SLOTS);
  assert.ok(hi.every((id) => challengeById(id)!.minLevel === 12));
  const lo = dealChallenges([], claimed, 2);
  assert.ok(lo.every((id) => challengeById(id)!.minLevel === 2));
});

test("never two challenges on the same metric at once", () => {
  const claimed = Object.fromEntries(CHALLENGE_POOL.filter((c) => c.explore).map((c) => [c.id, true]));
  const a = dealChallenges([], claimed, 30);
  const metrics = a.map((id) => challengeById(id)!.metric);
  assert.equal(new Set(metrics).size, metrics.length);
});

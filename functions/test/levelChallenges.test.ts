import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_XP_RATIO, challengeById, levelSet } from "../src/lib/levelChallenges";
import { scaledXp, xpForNext, MAX_LEVEL } from "../src/lib/progression";

test("every level's set pays more XP than the level needs, so players can pick and choose", () => {
  for (let l = 1; l < MAX_LEVEL; l++) {
    const set = levelSet(l);
    const paid = set.reduce((s, c) => s + scaledXp(c.xp, l), 0);
    assert.ok(paid > xpForNext(l), `level ${l}: ${paid} <= ${xpForNext(l)}`);
    assert.ok(paid >= Math.floor(CHALLENGE_XP_RATIO * xpForNext(l)) - set.length, `level ${l} pays ~the ratio`);
    // Skipping the single biggest challenge still levels you up.
    const biggest = Math.max(...set.map((c) => scaledXp(c.xp, l)));
    assert.ok(paid - biggest >= xpForNext(l), `level ${l}: can skip one`);
  }
});

test("each level has its own set; higher levels offer more and bigger challenges", () => {
  assert.ok(levelSet(1).every((c) => c.explore), "level 1 explores the app");
  assert.ok(levelSet(1).some((c) => c.id === "x_theme"));
  const l2 = levelSet(2), l20 = levelSet(20);
  assert.ok(l2.every((c) => c.id.startsWith("l2_")));
  assert.ok(l20.length > l2.length);
  const bets = (s: typeof l2) => s.find((c) => c.metric === "bets")!.target;
  assert.ok(bets(l20) > bets(l2));
  assert.equal(new Set(l20.map((c) => c.id)).size, l20.length, "unique ids");
  const all = Array.from({ length: 12 }, (_, i) => levelSet(i + 2)).flat();
  for (const m of ["boxes", "videos", "referrals", "friends", "items", "wins", "leagues"]) assert.ok(all.some((c) => c.metric === m), `${m} is a challenge somewhere`);
  assert.ok(all.some((c) => c.title.startsWith("Have ") && c.lifetime), "a lifetime friends goal");
});

test("ids resolve back to their level's challenge", () => {
  for (const c of [...levelSet(1), ...levelSet(7)]) assert.deepEqual(challengeById(c.id), c);
  assert.equal(challengeById("l7_nope"), undefined);
});

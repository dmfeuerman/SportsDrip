import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFriendStreak, advanceFriendStreak } from "../src/lib/friendStreak";
import { isLeavingSoon, windowState } from "../src/lib/storeWindow";
import { DEFAULT_QUEST_POOL, normalizePool, selectWeeklyQuests } from "../src/lib/questPool";
import { canClaimWinBack, dueWinBackStage } from "../src/lib/winBack";
import { accountAgeOk, GIFT_MIN_ACCOUNT_AGE_MS } from "../src/callable/gifts";

const DAY = 86_400_000;
const at = (ymd: string, h = 17) => Date.parse(`${ymd}T${String(h).padStart(2, "0")}:00:00Z`);

test("friend streak: consecutive shared days count, gaps reset, same day is idempotent", () => {
  const a = advanceFriendStreak(undefined, "2026-11-01")!;
  assert.deepEqual(a, { count: 1, longest: 1, lastDay: "2026-11-01" });
  assert.equal(advanceFriendStreak(a, "2026-11-01"), null);
  const b = advanceFriendStreak(a, "2026-11-02")!;
  assert.equal(b.count, 2);
  const c = advanceFriendStreak(b, "2026-11-05")!;
  assert.deepEqual(c, { count: 1, longest: 2, lastDay: "2026-11-05" });
  assert.equal(advanceFriendStreak(c, "2026-11-04"), null);
  assert.equal(activeFriendStreak(b, at("2026-11-03")), 2);
  assert.equal(activeFriendStreak(b, at("2026-11-04")), 0);
});

test("store window: from/until/featured", () => {
  const now = at("2026-11-05");
  assert.equal(windowState({}, now), "on_sale");
  assert.equal(windowState({ available: false }, now), "disabled");
  assert.equal(windowState({ availableFrom: now + 1 }, now), "upcoming");
  assert.equal(windowState({ releaseAt: now + 1 }, now), "upcoming");
  assert.equal(windowState({ availableUntil: now }, now), "expired");
  assert.equal(windowState({ availableFrom: now - 1, availableUntil: now + 1 }, now), "on_sale");
  assert.ok(isLeavingSoon({ availableUntil: now + DAY }, now));
  assert.ok(!isLeavingSoon({ availableUntil: now + 10 * DAY }, now));
});

test("quest selection: one per kind, deterministic, varies by user", () => {
  const pool = normalizePool(DEFAULT_QUEST_POOL);
  const a = selectWeeklyQuests(pool, "2026-11-02", "u1");
  assert.deepEqual(a.map((q) => q.kind), ["endowed", "effort", "social", "skill"]);
  assert.deepEqual(selectWeeklyQuests(pool, "2026-11-02", "u1"), a);
  const ids = new Set<string>();
  for (let i = 0; i < 40; i++) selectWeeklyQuests(pool, "2026-11-02", `u${i}`).forEach((q) => ids.add(q.id));
  assert.ok(ids.size > 4);
  // Malformed / empty pools fall back per kind.
  const p = normalizePool([{ id: "x", kind: "effort", metric: "nope", title: "bad", target: 1, xp: 1 }]);
  assert.deepEqual(selectWeeklyQuests(p, "w", "u").map((q) => q.kind), ["endowed", "effort", "social", "skill"]);
});

test("win-back: fires at 3/7/14 days once per lapse", () => {
  assert.equal(dueWinBackStage("2026-11-02", "2026-11-05", null), 3);
  assert.equal(dueWinBackStage("2026-11-02", "2026-11-04", null), null);
  assert.equal(dueWinBackStage("2026-11-02", "2026-11-05", { lastDay: "2026-11-02", stage: 3 }), null);
  assert.equal(dueWinBackStage("2026-10-29", "2026-11-05", { lastDay: "2026-10-29", stage: 3 }), 7);
  assert.equal(dueWinBackStage("2026-10-22", "2026-11-05", null), 14);
  assert.equal(dueWinBackStage(undefined, "2026-11-05", null), null);
  assert.ok(canClaimWinBack({ pending: true, lastDay: "2026-11-02" }));
  assert.ok(!canClaimWinBack({ pending: false, lastDay: "2026-11-02" }));
});

test("gifting requires a 7-day-old account", () => {
  const now = Date.now();
  assert.ok(!accountAgeOk(null, now));
  assert.ok(!accountAgeOk(now - GIFT_MIN_ACCOUNT_AGE_MS + 1, now));
  assert.ok(accountAgeOk(now - GIFT_MIN_ACCOUNT_AGE_MS, now));
});

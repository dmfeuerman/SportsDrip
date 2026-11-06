import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPush, decidePush, inQuietHours, localDay } from "../src/lib/pushBudget";

// 2026-10-01 17:00 UTC = 13:00 New York, 02:00 next day Tokyo.
const NOON_NY = Date.UTC(2026, 9, 1, 17);
const MIDNIGHT_NY = Date.UTC(2026, 9, 2, 4, 30); // 00:30 New York

const base = { now: NOON_NY, tz: "America/New_York", sentToday: 0, atDailyLimit: false, recentLoss: false };

test("push classification: money and social obligations are transactional", () => {
  for (const t of ["bet_won", "bet_lost", "challenge_received", "loan_request", "friend_request"] as const) {
    assert.equal(classifyPush(t), "transactional", t);
  }
  for (const t of ["sweat_alert", "lock_reminder", "team_reminder", "reaction", "achievement"] as const) {
    assert.equal(classifyPush(t), "engagement", t);
  }
});

test("quiet hours follow the user's timezone and wrap midnight", () => {
  assert.equal(inQuietHours(NOON_NY, "America/New_York"), false);
  assert.equal(inQuietHours(MIDNIGHT_NY, "America/New_York"), true);
  assert.equal(inQuietHours(NOON_NY, "Asia/Tokyo"), true);
  assert.equal(localDay(MIDNIGHT_NY, "America/New_York"), "2026-10-02");
  assert.equal(localDay(MIDNIGHT_NY, "America/Los_Angeles"), "2026-10-01");
});

test("engagement pushes respect cap, quiet hours, breaks and limits; transactional always send", () => {
  assert.deepEqual(decidePush({ ...base, type: "reaction" }), { send: true, counts: true });
  assert.deepEqual(decidePush({ ...base, type: "reaction", sentToday: 4 }), { send: false, reason: "budget" });
  assert.deepEqual(decidePush({ ...base, type: "reaction", now: MIDNIGHT_NY }), { send: false, reason: "quiet_hours" });
  assert.deepEqual(decidePush({ ...base, type: "reaction", now: MIDNIGHT_NY, quietHours: false }), { send: true, counts: true });
  assert.deepEqual(decidePush({ ...base, type: "sweat_alert", breakUntil: NOON_NY + 1 }), { send: false, reason: "on_break" });
  assert.deepEqual(decidePush({ ...base, type: "sweat_alert", atDailyLimit: true }), { send: false, reason: "daily_limit" });
  assert.deepEqual(decidePush({ ...base, type: "bet_won", sentToday: 99, now: MIDNIGHT_NY, atDailyLimit: true }), { send: true, counts: false });
});

test("never a 'come back and bet' prompt after a loss", () => {
  assert.deepEqual(decidePush({ ...base, type: "lock_reminder", recentLoss: true }), { send: false, reason: "recent_loss" });
  assert.deepEqual(decidePush({ ...base, type: "team_reminder", recentLoss: true }), { send: false, reason: "recent_loss" });
  // A reaction isn't a bet prompt.
  assert.equal(decidePush({ ...base, type: "reaction", recentLoss: true }).send, true);
});

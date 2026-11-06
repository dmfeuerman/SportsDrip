import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, clock, db, key, seedUser } from "./helpers";
import { createLeague } from "../src/callable/leagues";
import { joinBeforeStart as joinLeague } from "./helpers";
import { coopTarget, recordCoopWins } from "../src/lib/coop";
import { weekKey } from "../src/lib/weekly";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 9, 5, 16));
});

test("co-op target clamps", () => {
  assert.equal(coopTarget(2), 20);
  assert.equal(coopTarget(10), 50);
  assert.equal(coopTarget(40), 80);
});

test("co-op: only in the treatment arm, counts each win once, grants the reward on completion", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await call<{ leagueId: string; code: string }>(createLeague, "ann", {
    idempotencyKey: key(),
    name: "Coop",
    startingLeagueTokens: 1000,
    duration: "1 Month",
    sports: ["NBA"],
    buyIn: 0,
    prizePreset: "winner-all",
    bankLoanEnabled: false,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
  });
  await call(joinLeague, "ben", { code });
  const now = Date.now();
  const wins = Array.from({ length: 20 }, (_, i) => ({ leagueId, uid: i % 2 ? "ben" : "ann", betId: `b${i}` }));

  // Control arm (no config): nothing happens.
  await recordCoopWins(wins, now);
  assert.equal(db.read(`leagues/${leagueId}/coop/${weekKey(now)}`), undefined);

  await db.doc("meta/experiments").set({ globalHoldout: 50, experiments: [{ id: "coop_goals_v1", unit: "leagueId", splits: { treatment: 100 }, active: true }] });
  await db.doc("meta/coopRewards").set({ current: "coop_hat" });
  await db.doc("catalog/coop_hat").set({ name: "Team Hat", slot: "hat", price: 0 });
  await recordCoopWins(wins.slice(0, 19), now);
  await recordCoopWins(wins.slice(0, 19), now); // replay
  const mid = db.read(`leagues/${leagueId}/coop/${weekKey(now)}`)!;
  assert.equal(mid.progress, 19);
  assert.equal(mid.completedAt, undefined);
  assert.equal(await recordCoopWins(wins, now), 1);
  assert.ok(db.read("users/ann/inventory/coop_hat"));
  assert.ok(db.read("users/ben/inventory/coop_hat"));
  assert.ok(db.read(`leagues/${leagueId}/messages/coop_${weekKey(now)}`));
});

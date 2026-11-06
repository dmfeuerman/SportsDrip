import { fake } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSeason, type SeasonDef } from "../src/lib/seasonPass";
import { coopRewardFor, dropDue, normalizeConfig, planDrop, prizeBoxYieldCeiling, type PastDrop } from "../src/lib/liveOps";
import { runLiveOps } from "../src/scheduled/liveOps";
import { weekKey } from "../src/lib/weekly";

const WEEK = 7 * 86_400_000;
const ROOT = join(__dirname, "..", "..", "..", "..");
// Real ESM import (tsc would turn import() into require()).
const esm = new Function("u", "return import(u)") as (u: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const importData = (f: string) => esm(pathToFileURL(join(ROOT, "scripts", f)).href);

const cfg = normalizeConfig({ enabled: true, dropSize: 4, returnEvery: 3, returnCooldownWeeks: 2, pool: ["a", "b", "c", "d", "e", "f", "g", "h", "cheap"] });
const pool = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, price: 5000 })).concat({ id: "cheap", price: 100 });

test("drop plan: 3–6 items, never below the Prize Box ceiling, deterministic", () => {
  const p1 = planDrop(cfg, pool, [], "2026-11-09", 0)!;
  assert.equal(p1.itemIds.length, 4);
  assert.ok(!p1.itemIds.includes("cheap"));
  assert.deepEqual(planDrop(cfg, pool, [], "2026-11-09", 0), p1);
  assert.equal(normalizeConfig({ dropSize: 20 }).dropSize, 6);
  assert.equal(normalizeConfig({ dropSize: 1 }).dropSize, 3);
  assert.ok(prizeBoxYieldCeiling() > 0);
});

test("drop plan: fresh items first, retired ones return on schedule", () => {
  const now = 10 * WEEK;
  const history: PastDrop[] = [
    { week: "w1", itemIds: ["a", "b", "c", "d"], endsAt: now - 5 * WEEK },
    { week: "w2", itemIds: ["e", "f", "g", "h"], endsAt: now - 1 * WEEK },
  ];
  const p = planDrop(cfg, pool, history, "w3", now)!; // 3rd drop → one return
  assert.equal(p.itemIds.length, 4);
  assert.ok(p.returning.length >= 1);
  for (const id of p.itemIds) assert.ok(["a", "b", "c", "d"].includes(id), "only past-cooldown items can return");
  assert.equal(planDrop(cfg, pool.slice(0, 2), [], "w", 0), null);
});

test("cadence and co-op reward rotation", () => {
  assert.equal(dropDue([], 0), true);
  assert.equal(dropDue([{ week: "w", itemIds: [], endsAt: 3 * 86_400_000 }], 0), false);
  const c = normalizeConfig({ coopRewardPool: ["x", "y"] });
  assert.notEqual(coopRewardFor(c, "2026-11-09"), coopRewardFor(c, "2026-11-16"));
  assert.equal(coopRewardFor(normalizeConfig({}), "2026-11-09"), null);
});

test("checked-in live-ops content is valid", async () => {
  const { seasons } = JSON.parse(readFileSync(join(ROOT, "functions", "config", "seasons.json"), "utf8")) as { seasons: SeasonDef[] };
  const { CATALOG } = await importData("catalog-data.mjs");
  const { MOVES } = await importData("move-data.mjs");
  const { BACKGROUNDS } = await importData("background-data.mjs");
  const { LIVE_OPS } = await importData("liveops-data.mjs");
  const items = new Map<string, { price: number }>(CATALOG.map((i: { id: string; price: number }) => [i.id, i]));
  const ids = { item: items, move: new Set(MOVES.map((m: { id: string }) => m.id)), background: new Set(BACKGROUNDS.map((b: { id: string }) => b.id)) };

  let prevEnd = 0;
  for (const s of [...seasons].sort((a, b) => a.startsAt - b.startsAt)) {
    validateSeason(s);
    assert.ok(s.startsAt >= prevEnd, `${s.id} overlaps the previous season`);
    const weeks = (s.endsAt - s.startsAt) / WEEK;
    assert.ok(weeks >= 8 && weeks <= 12, `${s.id}: ${weeks} weeks`);
    prevEnd = s.endsAt;
    for (const t of s.tiers) if (t.reward.kind !== "credits") assert.ok(ids[t.reward.kind].has(t.reward.id), `${s.id}: unknown ${t.reward.kind} ${t.reward.id}`);
  }

  const floor = prizeBoxYieldCeiling();
  const rotating = [...LIVE_OPS.pool, ...LIVE_OPS.events.flatMap((e: { itemIds: string[] }) => e.itemIds)];
  assert.equal(new Set(rotating).size, rotating.length, "an item is in the pool and an event, or twice");
  for (const id of [...rotating, ...LIVE_OPS.coopRewardPool]) assert.ok(items.has(id), `unknown item ${id}`);
  for (const id of rotating) assert.ok(items.get(id)!.price > floor, `${id} priced at/below Prize Box yield`);
  for (const id of LIVE_OPS.coopRewardPool) assert.ok(!rotating.includes(id), `${id} is both a co-op reward and rotating`);
});

beforeEach(() => fake.db.reset());

test("Monday run drops, is idempotent, sets the co-op reward and activates events", async () => {
  const now = Date.UTC(2026, 10, 9, 5, 5);
  for (const p of pool) fake.db.seed(`catalog/${p.id}`, { price: p.price, available: true, rotation: true, availableUntil: now - 1 });
  fake.db.seed("catalog/ev", { price: 9000, available: true });
  fake.db.seed("meta/liveOps", {
    enabled: true,
    dropSize: 4,
    pool: pool.map((p) => p.id),
    coopRewardPool: ["reward_x"],
    events: [{ id: "sb", name: "SB", startsAt: now + 2 * 86_400_000, endsAt: now + 9 * 86_400_000, itemIds: ["ev"] }],
  });

  const r = await runLiveOps(now);
  assert.equal(r.drop!.length, 4);
  assert.deepEqual(r.events, ["sb"]);
  assert.equal(r.coopReward, "reward_x");
  const dropped = fake.db.read(`catalog/${r.drop![0]}`)!;
  assert.equal(dropped.featured, true);
  assert.equal(dropped.availableUntil, now + WEEK);
  assert.equal(fake.db.read("catalog/ev")!.availableFrom, now + 2 * 86_400_000);
  assert.equal(fake.db.read("meta/coopRewards")!.current, "reward_x");
  assert.ok(fake.db.read(`liveOpsDrops/${weekKey(now)}`));

  const again = await runLiveOps(now + 3600_000);
  assert.equal(again.drop, null);
  assert.deepEqual(again.events, []);
});

test("disabled config does nothing", async () => {
  fake.db.seed("meta/liveOps", { enabled: false, pool: ["a"] });
  assert.deepEqual(await runLiveOps(0), { drop: null, events: [], coopReward: null });
});

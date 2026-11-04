import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { balance, call, db, key, ledger, rejects, seedUser } from "./helpers";
import { purchaseMove, setMoveLoadout } from "../src/callable/moves";
import { getPlayerProfile } from "../src/callable/players";
import { DEFAULT_LOADOUT, FREE_MOVES, MAX_LOADOUT } from "../src/lib/moves";
import * as client from "../../artifacts/mobile/constants/moves";

const ROOT = join(__dirname, "..", "..", "..", "..");
const esm = new Function("p", "return import(p)") as (p: string) => Promise<any>;

beforeEach(() => {
  db.reset();
  for (const [id, price] of [
    ["two_step", 1500],
    ["hype_clap", 1800],
    ["the_dab", 4500],
    ["the_robot", 16000],
    ["the_floss", 18000],
  ] as const) {
    db.seed(`moves/${id}`, { name: id, price, rarity: "common", available: true, releaseAt: null });
  }
});

const loadout = (uid: string) => db.read(`users/${uid}`)!.moves as string[] | undefined;
const owns = (uid: string, id: string) => !!db.read(`users/${uid}/moves/${id}`);

test("buying a move debits the server price, grants it once and puts it on the dance button", async () => {
  seedUser("amy", 5000);
  const res = await call<{ balance: number; equipped: boolean }>(purchaseMove, "amy", { moveId: "the_dab", idempotencyKey: key() });
  assert.equal(res.balance, 500);
  assert.equal(res.equipped, true);
  assert.equal(balance("amy"), 500);
  assert.ok(owns("amy", "the_dab"));
  assert.deepEqual(loadout("amy"), [...DEFAULT_LOADOUT, "the_dab"]);
  const row = ledger("amy").find((l) => l.ref === "move:the_dab")!;
  assert.equal(row.delta, -4500);
  assert.equal(row.type, "purchase");
});

test("a double-tapped purchase is one purchase; buying an owned move again is refused", async () => {
  seedUser("amy", 10000);
  const k = key();
  await Promise.all([1, 2, 3].map(() => call(purchaseMove, "amy", { moveId: "two_step", idempotencyKey: k }).catch(() => null)));
  assert.equal(balance("amy"), 8500);
  await rejects(call(purchaseMove, "amy", { moveId: "two_step", idempotencyKey: key() }), /already own/);
  assert.equal(balance("amy"), 8500);
});

test("can't buy what you can't afford, what isn't listed, a free move, or a retired one", async () => {
  seedUser("amy", 1000);
  await rejects(call(purchaseMove, "amy", { moveId: "two_step", idempotencyKey: key() }), /Not enough credits/);
  await rejects(call(purchaseMove, "amy", { moveId: "moonwalk", idempotencyKey: key() }), /isn't in the store/);
  await rejects(call(purchaseMove, "amy", { moveId: "cheer", idempotencyKey: key() }), /Everyone already has/);
  db.seed("moves/hype_clap", { name: "Hype Clap", price: 10, available: false });
  await rejects(call(purchaseMove, "amy", { moveId: "hype_clap", idempotencyKey: key() }), /isn't available/);
  assert.equal(balance("amy"), 1000);
  assert.ok(!owns("amy", "two_step"));
});

test("a full loadout keeps its four; the new move is owned but not equipped", async () => {
  seedUser("amy", 60000);
  for (const m of ["two_step", "hype_clap"]) await call(purchaseMove, "amy", { moveId: m, idempotencyKey: key() });
  assert.equal(loadout("amy")!.length, MAX_LOADOUT);
  const res = await call<{ equipped: boolean }>(purchaseMove, "amy", { moveId: "the_robot", idempotencyKey: key() });
  assert.equal(res.equipped, false);
  assert.ok(owns("amy", "the_robot"));
  assert.deepEqual(loadout("amy"), ["cheer", "fist_pump", "two_step", "hype_clap"]);
});

test("loadout: 1–4 distinct moves, each free or owned, saved in order", async () => {
  seedUser("amy", 60000);
  await call(purchaseMove, "amy", { moveId: "the_floss", idempotencyKey: key() });
  await call(setMoveLoadout, "amy", { moves: ["the_floss", "cheer"] });
  assert.deepEqual(loadout("amy"), ["the_floss", "cheer"]);

  await rejects(call(setMoveLoadout, "amy", { moves: ["the_robot"] }), /don't own/);
  await rejects(call(setMoveLoadout, "amy", { moves: [] }), /at least one/);
  await rejects(call(setMoveLoadout, "amy", { moves: ["cheer", "cheer"] }), /only be in your loadout once/);
  await rejects(call(setMoveLoadout, "amy", { moves: ["cheer", "fist_pump", "the_floss", "cheer", "fist_pump"] }), /up to 4/);
  await rejects(call(setMoveLoadout, "amy", { moves: ["../users/x"] }), /Unknown move/);
  await rejects(call(setMoveLoadout, null, { moves: ["cheer"] }), /sign/i);
  assert.deepEqual(loadout("amy"), ["the_floss", "cheer"]);
});

test("profiles carry the loadout (the default for players who never set one)", async () => {
  seedUser("amy");
  seedUser("ben");
  db.seed("friendships/amy_ben", { users: ["amy", "ben"] });
  const before = await call<{ profile: { moves: string[] } }>(getPlayerProfile, "ben", { uid: "amy" });
  assert.deepEqual(before.profile.moves, DEFAULT_LOADOUT);
  await call(setMoveLoadout, "amy", { moves: ["fist_pump"] });
  const after = await call<{ profile: { moves: string[] } }>(getPlayerProfile, "ben", { uid: "amy" });
  assert.deepEqual(after.profile.moves, ["fist_pump"]);
});

test("client and server agree on the free moves, default loadout and limit; every listed move has an animation", async () => {
  assert.deepEqual([...client.FREE_MOVES], [...FREE_MOVES]);
  assert.deepEqual(client.DEFAULT_LOADOUT, DEFAULT_LOADOUT);
  assert.equal(client.MAX_LOADOUT, MAX_LOADOUT);
  const { MOVES } = await esm(join(ROOT, "scripts", "move-data.mjs"));
  for (const m of MOVES as Array<{ id: string; price: number }>) {
    const lib = client.MOVES_BY_ID.get(m.id);
    assert.ok(lib, `${m.id} is listed for sale but the app has no animation for it`);
    assert.ok(m.price > 0, `${m.id} must have a price`);
    assert.equal(lib!.price, m.price, `${m.id}: app fallback price differs from the seeded price`);
  }
  for (const id of FREE_MOVES) assert.ok(client.MOVES_BY_ID.has(id));
});

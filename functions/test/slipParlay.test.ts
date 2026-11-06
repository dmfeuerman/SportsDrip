import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { balance, call, clock, db, finishGame, key, rejects, seedGame, seedUser } from "./helpers";
import { placeParlay, cancelParlay, settleSlipParlaysForGame } from "../src/callable/slipParlays";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 10, 5, 17));
});

test("parlay: stake once, odds multiply, every leg must win", async () => {
  seedUser("amy", 1000);
  seedGame("a"); // BOS 1.8 / NYK 2.1
  seedGame("b");
  await rejects(call(placeParlay, "amy", { legs: [{ gameId: "a", selection: "home" }], stake: 100, idempotencyKey: key() }), /./);
  await rejects(call(placeParlay, "amy", { legs: [{ gameId: "a", selection: "home" }, { gameId: "a", selection: "away" }], stake: 100, idempotencyKey: key() }), /One leg per game/);
  const r = await call<{ parlayId: string; odds: number }>(placeParlay, "amy", { legs: [{ gameId: "a", selection: "home" }, { gameId: "b", selection: "away" }], stake: 100, idempotencyKey: key() });
  assert.equal(r.odds, 3.78);
  assert.equal(balance("amy"), 900);
  finishGame("a", 100, 90);
  await settleSlipParlaysForGame("a");
  assert.equal(db.read(`slipParlays/${r.parlayId}`)!.status, "pending");
  finishGame("b", 95, 99);
  await settleSlipParlaysForGame("b");
  assert.equal(db.read(`slipParlays/${r.parlayId}`)!.status, "won");
  assert.equal(balance("amy"), 900 + 378);
});

test("parlay: one miss loses it; a push leg drops out; cancel before kickoff refunds", async () => {
  seedUser("bo", 1000);
  seedGame("a");
  seedGame("b");
  seedGame("c");
  const lose = await call<{ parlayId: string }>(placeParlay, "bo", { legs: [{ gameId: "a", selection: "home" }, { gameId: "b", selection: "home" }], stake: 100, idempotencyKey: key() });
  const push = await call<{ parlayId: string }>(placeParlay, "bo", { legs: [{ gameId: "c", selection: "home" }, { gameId: "b", selection: "away" }], stake: 100, idempotencyKey: key() });
  const cancel = await call<{ parlayId: string }>(placeParlay, "bo", { legs: [{ gameId: "a", selection: "away" }, { gameId: "c", selection: "away" }], stake: 50, idempotencyKey: key() });
  await call(cancelParlay, "bo", { parlayId: cancel.parlayId });
  assert.equal(balance("bo"), 800);
  finishGame("a", 80, 90);
  await settleSlipParlaysForGame("a");
  assert.equal(db.read(`slipParlays/${lose.parlayId}`)!.status, "lost");
  finishGame("c", 100, 100);
  await settleSlipParlaysForGame("c");
  finishGame("b", 90, 99);
  await settleSlipParlaysForGame("b");
  const p = db.read(`slipParlays/${push.parlayId}`)!;
  assert.equal(p.status, "won");
  assert.equal(p.odds, 2.1);
  assert.equal(balance("bo"), 800 + 210);
});

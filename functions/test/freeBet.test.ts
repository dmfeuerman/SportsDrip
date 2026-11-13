import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { balance, call, clock, db, finishGame, key, rejects, seedGame, seedUser } from "./helpers";
import { placeFreeBet } from "../src/callable/dailyPick";
import { cancelBet } from "../src/callable/bets";
import { settleBetsForGame } from "../src/scheduled/settleBets";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 10, 4, 17)); // noon ET
});

test("daily free bet: costs nothing, one per day, a win pays the winnings only", async () => {
  seedUser("amy", 5000);
  seedGame("g1"); // BOS 1.8 / NYK 2.1
  seedGame("g2");
  const r = await call<{ betId: string; winnings: number }>(placeFreeBet, "amy", { gameId: "g1", side: "away", idempotencyKey: key() });
  assert.equal(r.winnings, 1100, "1000 × 2.1 − 1000");
  assert.equal(balance("amy"), 5000, "nothing debited");
  const bet = db.read(`bets/${r.betId}`)!;
  assert.equal(bet.stake, 0);
  assert.equal(bet.freeBet, true);
  await rejects(call(placeFreeBet, "amy", { gameId: "g2", side: "home", idempotencyKey: key() }), /already used today's free bet/);

  finishGame("g1", 90, 101);
  await settleBetsForGame("g1");
  assert.equal(db.read(`bets/${r.betId}`)!.status, "won");
  assert.equal(balance("amy"), 6100);

  // A new day brings a new one.
  clock.set(Date.UTC(2026, 10, 5, 17));
  seedGame("g3");
  await call(placeFreeBet, "amy", { gameId: "g3", side: "home", idempotencyKey: key() });
});

test("daily free bet: a loss costs nothing, started games are refused, cancelling gives it back", async () => {
  seedUser("bo", 200);
  seedGame("live", { startsAt: clock.get() - 60_000 });
  await rejects(call(placeFreeBet, "bo", { gameId: "live", side: "home", idempotencyKey: key() }), /already started/);
  seedGame("g1");
  const r = await call<{ betId: string }>(placeFreeBet, "bo", { gameId: "g1", side: "home", idempotencyKey: key() });
  await call(cancelBet, "bo", { betId: r.betId });
  assert.equal(balance("bo"), 200);
  const again = await call<{ betId: string }>(placeFreeBet, "bo", { gameId: "g1", side: "home", idempotencyKey: key() });
  finishGame("g1", 80, 99);
  await settleBetsForGame("g1");
  assert.equal(db.read(`bets/${again.betId}`)!.status, "lost");
  assert.equal(balance("bo"), 200);
});

test("daily free bet: spreads and totals too, at the spread price", async () => {
  seedUser("cy", 100);
  seedGame("g1", { line: { spreadHome: -4.5, overUnder: 221.5 } });
  const r = await call<{ betId: string; winnings: number }>(placeFreeBet, "cy", { gameId: "g1", market: "total", selection: "over", idempotencyKey: key() });
  const bet = db.read(`bets/${r.betId}`)!;
  assert.equal(bet.market, "total");
  assert.equal(bet.selection, "over");
  assert.equal(bet.stake, 0);
});

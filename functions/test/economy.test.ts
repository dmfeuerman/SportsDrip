import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { addPal, call, clock, db, key, rejects, seedGame, seedUser } from "./helpers";
import { createLeague, placeLeagueBet, requestReset } from "../src/callable/leagues";
import { joinBeforeStart as joinLeague } from "./helpers";
import { createGroupParlay } from "../src/callable/parlays";
import { parlayStakeCap } from "../src/lib/parlay";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 9, 5, 16));
});

async function makeLeague(owner: string) {
  return call<{ leagueId: string; code: string }>(createLeague, owner, {
    idempotencyKey: key(),
    name: "Econ",
    startingLeagueTokens: 10_000,
    duration: "1 Month",
    sports: ["NBA", "NFL", "MLB"],
    buyIn: 1_000,
    prizePreset: "top-2",
    bankLoanEnabled: true,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
  });
}
const member = (leagueId: string, uid: string) =>
  (db.read(`leagues/${leagueId}`)!.members as Record<string, { leagueTokens: number; resetUsed?: boolean }>)[uid]!;

test("parlay stakes are capped at 25% of the wallet", async () => {
  assert.equal(parlayStakeCap(10_000), 2500);
  seedUser("ann", 10_000, "Ann");
  const { leagueId } = await makeLeague("ann");
  await addPal(leagueId);
  seedGame("pc1");
  await rejects(
    call(createGroupParlay, "ann", { leagueId, idempotencyKey: key(), stake: 3000, leg: { gameId: "pc1", side: "home" } }),
    /capped at 25%/
  );
  await call(createGroupParlay, "ann", { leagueId, idempotencyKey: key(), stake: 2500, leg: { gameId: "pc1", side: "home" } });
});

test("bankrupt reset: 25% of starting tokens, once, only at zero with nothing open", async () => {
  seedUser("ann", 10_000, "Ann");
  seedUser("ben", 10_000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  await rejects(call(requestReset, "ben", { leagueId }), /empty wallet/);

  seedGame("rg1");
  await call(placeLeagueBet, "ben", { leagueId, gameId: "rg1", side: "home", stake: 10_000, idempotencyKey: key() });
  await rejects(call(requestReset, "ben", { leagueId }), /open picks/);

  // Simulate the loss settling.
  const bets = db.list(`leagues/${leagueId}/leagueBets/`);
  for (const b of bets) await db.doc(b.path).update({ status: "lost" });
  const res = await call<{ leagueTokens: number }>(requestReset, "ben", { leagueId });
  assert.equal(res.leagueTokens, 2500);
  assert.equal(member(leagueId, "ben").leagueTokens, 2500);
  assert.equal(member(leagueId, "ben").resetUsed, true);
  // No debt was created.
  assert.equal(db.list(`leagues/${leagueId}/loans/`).length, 0);
  // Second call is a no-op.
  const again = await call<{ duplicate?: boolean }>(requestReset, "ben", { leagueId });
  assert.equal(again.duplicate, true);
  assert.equal(member(leagueId, "ben").leagueTokens, 2500);
});

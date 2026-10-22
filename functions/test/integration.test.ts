import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { balance, call, clock, db, finishGame, key, ledger, notifications, rejects, seedGame, seedUser } from "./helpers";
import { placeBet, cancelBet } from "../src/callable/bets";
import { purchaseItem } from "../src/callable/shop";
import {
  createLeague,
  endLeague,
  joinLeague,
  leaveLeague,
  peerLoanAction,
  placeLeagueBet,
  repayLoan,
  requestPeerLoan,
  takeBankLoan,
  updateLeagueSettings,
  inviteToLeague,
} from "../src/callable/leagues";
import { refundStale, settleBetsForGame, settleLeagueBetsForGame } from "../src/scheduled/settleBets";
import { sweepLeagues } from "../src/scheduled/leagues";
import { loanSnapshot } from "../src/lib/loanMath";

const START = Date.UTC(2026, 9, 1, 12);

beforeEach(() => {
  db.reset();
  clock.set(START);
});

// ---------------------------------------------------------------------------
// Main-wallet betting regressions
// ---------------------------------------------------------------------------

test("a winning bet pays once and notifies once, even when the trigger and the sweep race", async () => {
  seedUser("alice", 1000);
  seedGame("g1");
  await call(placeBet, "alice", { gameId: "g1", side: "home", stake: 100, idempotencyKey: key() });
  assert.equal(balance("alice"), 900);

  finishGame("g1", 101, 99);
  const counts = await Promise.all([settleBetsForGame("g1"), settleBetsForGame("g1"), settleBetsForGame("g1")]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 1, "exactly one settlement commits");
  assert.equal(balance("alice"), 900 + 180);

  const notes = notifications("alice");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.type, "bet_won");
  assert.equal(notes[0]!.delta, 180);
  assert.equal(notes[0]!.balanceAfter, 1080);
  assert.equal(notes[0]!.read, false);
  assert.equal(ledger("alice").filter((l) => l.type === "bet_payout").length, 1);

  // A later sweep is a no-op.
  assert.equal(await settleBetsForGame("g1"), 0);
  assert.equal(balance("alice"), 1080);
});

test("a losing bet notifies with the stake and the current balance, and moves no money", async () => {
  seedUser("bob", 500);
  seedGame("g2");
  await call(placeBet, "bob", { gameId: "g2", side: "away", stake: 200, idempotencyKey: key() });
  finishGame("g2", 120, 90);
  await settleBetsForGame("g2");
  assert.equal(balance("bob"), 300);
  const [n] = notifications("bob");
  assert.equal(n!.type, "bet_lost");
  assert.equal(n!.delta, -200);
  assert.equal(n!.balanceAfter, 300);
  assert.equal((n!.bet as { finalHomeScore: number }).finalHomeScore, 120);
});

test("several bets resolving at the same moment each get their own correct notification", async () => {
  seedUser("cara", 1000);
  for (const g of ["a", "b", "c", "d"]) seedGame(g);
  for (const g of ["a", "b", "c", "d"]) {
    await call(placeBet, "cara", { gameId: g, side: "home", stake: 100, idempotencyKey: key() });
  }
  finishGame("a", 2, 1); // won 180
  finishGame("b", 1, 2); // lost
  finishGame("c", 3, 3); // push 100
  finishGame("d", 5, 0); // won 180
  await Promise.all(["a", "b", "c", "d", "a", "d"].map((g) => settleBetsForGame(g)));
  assert.equal(balance("cara"), 600 + 180 + 100 + 180);
  const types = notifications("cara").map((n) => n.type).sort();
  assert.deepEqual(types, ["bet_lost", "bet_push", "bet_won", "bet_won"]);
});

test("double-tapped bets are one bet; cancelled bets refund once", async () => {
  seedUser("dan", 1000);
  seedGame("g3");
  const k1 = key();
  await Promise.all([
    call(placeBet, "dan", { gameId: "g3", side: "home", stake: 100, idempotencyKey: k1 }),
    call(placeBet, "dan", { gameId: "g3", side: "home", stake: 100, idempotencyKey: k1 }),
  ]);
  assert.equal(balance("dan"), 900);
  const betId = `dan_${k1}`;
  await Promise.all([call(cancelBet, "dan", { betId }), call(cancelBet, "dan", { betId }).catch(() => null)]);
  assert.equal(balance("dan"), 1000);
});

test("balances can't go negative and odds come from the server", async () => {
  seedUser("eve", 50);
  seedGame("g4");
  await rejects(call(placeBet, "eve", { gameId: "g4", side: "home", stake: 100, idempotencyKey: key() }), /Not enough credits/);
  await call(placeBet, "eve", { gameId: "g4", side: "home", stake: 50, idempotencyKey: key(), expectedOdds: 1.2 });
  const bet = db.list("bets/")[0]!.data;
  assert.equal(bet.odds, 1.8);
  assert.equal(bet.potentialPayout, 90);
});

test("a stale, orphaned bet is refunded once with a notification", async () => {
  seedUser("fay", 300);
  seedGame("g5");
  await call(placeBet, "fay", { gameId: "g5", side: "home", stake: 100, idempotencyKey: key() });
  db.docs.delete("games/g5");
  await Promise.all([refundStale(clock.get()), refundStale(clock.get())]);
  assert.equal(balance("fay"), 300);
  assert.equal(notifications("fay").filter((n) => n.type === "bet_refunded").length, 1);
});

test("purchases can't be duplicated by a retry storm", async () => {
  seedUser("gus", 500);
  db.seed("catalog/cap_red", { name: "Red cap", slot: "hat", price: 200, available: true });
  const k = key();
  await Promise.all([1, 2, 3].map(() => call(purchaseItem, "gus", { itemId: "cap_red", idempotencyKey: k }).catch(() => null)));
  assert.equal(balance("gus"), 300);
});

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

async function makeLeague(owner: string, over: Record<string, unknown> = {}) {
  const res = await call<{ leagueId: string; code: string }>(createLeague, owner, {
    idempotencyKey: key(),
    name: "Office",
    startingLeagueTokens: 1000,
    duration: "1 Week",
    sports: ["NBA", "NFL"],
    buyIn: 100,
    prizePreset: "top-2",
    bankLoanEnabled: true,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
    ...over,
  });
  return res;
}

const league = (id: string) => db.read(`leagues/${id}`)!;
const tokens = (id: string, uid: string) => (league(id).members as Record<string, { leagueTokens: number }>)[uid]!.leagueTokens;
const loansOf = (id: string) => db.list(`leagues/${id}/loans/`).map((d) => d.data);

test("create and join charge the buy-in once, build the pot, and reject double-joins", async () => {
  seedUser("ann", 1000);
  seedUser("ben", 1000);
  const { leagueId, code } = await makeLeague("ann");
  assert.equal(balance("ann"), 900);
  await Promise.all([call(joinLeague, "ben", { code }), call(joinLeague, "ben", { code })]);
  assert.equal(balance("ben"), 900);
  const l = league(leagueId);
  assert.equal(l.pot, 200);
  assert.deepEqual((l.memberIds as string[]).sort(), ["ann", "ben"]);
  assert.equal(tokens(leagueId, "ben"), 1000);
  await rejects(call(joinLeague, "ben", { code: "ZZZZZZ" }), /No league with that code/);
});

test("league bets debit league tokens only, respect allowed sports, and settle exactly once", async () => {
  seedUser("ann", 1000);
  const { leagueId } = await makeLeague("ann");
  seedGame("nba1");
  seedGame("mlb1", { sport: "MLB" });
  await rejects(
    call(placeLeagueBet, "ann", { leagueId, gameId: "mlb1", side: "home", stake: 100, idempotencyKey: key() }),
    /MLB isn't part of this league/
  );
  await call(placeLeagueBet, "ann", { leagueId, gameId: "nba1", side: "away", stake: 400, idempotencyKey: key() });
  assert.equal(tokens(leagueId, "ann"), 600);
  assert.equal(balance("ann"), 900, "real credits untouched");
  await rejects(
    call(placeLeagueBet, "ann", { leagueId, gameId: "nba1", side: "away", stake: 700, idempotencyKey: key() }),
    /Not enough league tokens/
  );

  finishGame("nba1", 99, 100);
  const n = await Promise.all([settleLeagueBetsForGame("nba1"), settleLeagueBetsForGame("nba1")]);
  assert.equal(n[0] + n[1], 1);
  assert.equal(tokens(leagueId, "ann"), 600 + 840);
  const notes = notifications("ann").filter((x) => x.wallet === "league");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.balanceAfter, 1440);
  assert.equal(notes[0]!.leagueName, "Office");
});

test("one user in two leagues: bets on the same game settle into the right league", async () => {
  seedUser("ann", 2000);
  const a = await makeLeague("ann", { name: "A" });
  const b = await makeLeague("ann", { name: "B" });
  seedGame("g");
  await call(placeLeagueBet, "ann", { leagueId: a.leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key() });
  await call(placeLeagueBet, "ann", { leagueId: b.leagueId, gameId: "g", side: "away", stake: 300, idempotencyKey: key() });
  finishGame("g", 10, 5);
  await settleLeagueBetsForGame("g");
  assert.equal(tokens(a.leagueId, "ann"), 900 + 180);
  assert.equal(tokens(b.leagueId, "ann"), 700);
  assert.deepEqual(notifications("ann").map((x) => x.type).sort(), ["bet_lost", "bet_won"]);
});

test("non-members can't bet, peek, or end; only the creator ends early", async () => {
  seedUser("ann", 1000);
  seedUser("mal", 1000);
  seedUser("ben", 1000);
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  seedGame("g");
  await rejects(
    call(placeLeagueBet, "mal", { leagueId, gameId: "g", side: "home", stake: 10, idempotencyKey: key() }),
    /not in this league/
  );
  await rejects(call(endLeague, "ben", { leagueId }), /Only the creator/);
  await rejects(
    call(updateLeagueSettings, "ben", { leagueId, bankLoanEnabled: false, bankInterestRate: 5, bankInterestIntervalHours: 24 }),
    /Only the league creator/
  );
});

test("bank loans: simple interest, capped principal, interest-first repayment, idempotent repay", async () => {
  seedUser("ann", 1000);
  const { leagueId } = await makeLeague("ann");
  await call(takeBankLoan, "ann", { leagueId, amount: 600, idempotencyKey: key() });
  assert.equal(tokens(leagueId, "ann"), 1600);
  await rejects(call(takeBankLoan, "ann", { leagueId, amount: 500, idempotencyKey: key() }), /lends up to 1,000/);

  clock.advanceHours(48); // two periods at 10% of 600
  const [loan] = loansOf(leagueId);
  const snap = loanSnapshot(loan as never, clock.get());
  assert.equal(snap.interestCharged, 120);
  assert.equal(snap.totalOwed, 720);

  // Revisiting / re-reading never changes the stored loan.
  assert.deepEqual(loansOf(leagueId)[0], loan);

  const rk = key();
  const [r1, r2] = await Promise.all([
    call<{ applied: number; toInterest: number; toPrincipal: number }>(repayLoan, "ann", { leagueId, loanId: loan!.id, amount: 300, idempotencyKey: rk }),
    call<{ applied: number }>(repayLoan, "ann", { leagueId, loanId: loan!.id, amount: 300, idempotencyKey: rk }),
  ]);
  assert.equal(r1.applied, 300);
  assert.equal(r2.applied, 300, "the duplicate reports the original receipt");
  assert.equal(r1.toInterest, 120);
  assert.equal(r1.toPrincipal, 180);
  assert.equal(tokens(leagueId, "ann"), 1300);

  clock.advanceHours(24); // 10% of the remaining 420 principal
  const after = loanSnapshot(loansOf(leagueId)[0] as never, clock.get());
  assert.equal(after.principalOutstanding, 420);
  assert.equal(after.interestOutstanding, 42);

  const done = await call<{ settled: boolean; applied: number }>(repayLoan, "ann", { leagueId, loanId: loan!.id, amount: 10_000, idempotencyKey: key() });
  assert.equal(done.applied, 462);
  assert.equal(done.settled, true);
  assert.equal(loansOf(leagueId)[0]!.status, "repaid");
  // A rate change applies to new loans only.
  await call(updateLeagueSettings, "ann", { leagueId, bankLoanEnabled: true, bankInterestRate: 20, bankInterestIntervalHours: 12 });
  await call(takeBankLoan, "ann", { leagueId, amount: 100, idempotencyKey: key() });
  const newest = loansOf(leagueId).find((l) => l.status === "active")!;
  assert.equal(newest.ratePct, 20);
  assert.equal(newest.intervalHours, 12);
});

test("peer loans move tokens between members and repayments reach the lender", async () => {
  seedUser("ann", 1000);
  seedUser("ben", 1000);
  seedUser("cat", 1000);
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  await call(joinLeague, "cat", { code });

  await rejects(call(requestPeerLoan, "ben", { leagueId, amount: 600, rate: 5, idempotencyKey: key() }), /capped at 500/);
  const { loanId } = await call<{ loanId: string }>(requestPeerLoan, "ben", { leagueId, amount: 400, rate: 5, idempotencyKey: key() });
  assert.ok(notifications("ann").some((n) => n.type === "loan_request"));
  await rejects(call(peerLoanAction, "ben", { leagueId, loanId, action: "fund" }), /own request/);

  await call(peerLoanAction, "cat", { leagueId, loanId, action: "counter", rate: 8 });
  await call(peerLoanAction, "ben", { leagueId, loanId, action: "accept_counter" });
  assert.equal(tokens(leagueId, "cat"), 600);
  assert.equal(tokens(leagueId, "ben"), 1400);
  const loan = loansOf(leagueId)[0]!;
  assert.equal(loan.lenderId, "cat");
  assert.equal(loan.ratePct, 8);

  // Funding twice is impossible.
  await rejects(call(peerLoanAction, "ann", { leagueId, loanId, action: "fund" }), /isn't open/);

  clock.advanceHours(24);
  await call(repayLoan, "ben", { leagueId, loanId, amount: 432, idempotencyKey: key() });
  assert.equal(tokens(leagueId, "cat"), 1032);
  assert.equal(tokens(leagueId, "ben"), 968);
  assert.equal(loansOf(leagueId)[0]!.status, "repaid");
  assert.ok(notifications("cat").some((n) => n.type === "loan_repaid"));
});

test("leaving is blocked while loans or open bets tie you to the league", async () => {
  seedUser("ann", 1000);
  seedUser("ben", 1000);
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  const { loanId } = await call<{ loanId: string }>(takeBankLoan, "ben", { leagueId, amount: 100, idempotencyKey: key() });
  await rejects(call(leaveLeague, "ben", { leagueId }), /Settle your loans/);
  await call(repayLoan, "ben", { leagueId, loanId, amount: 100, idempotencyKey: key() });
  await call(leaveLeague, "ben", { leagueId });
  assert.deepEqual(league(leagueId).memberIds, ["ann"]);
  await rejects(call(joinLeague, "ben", { code }), /can't rejoin/);
});

test("ending a league ranks on net worth, voids open bets, and pays the pot exactly once", async () => {
  seedUser("ann", 1000);
  seedUser("ben", 1000);
  seedUser("cat", 1000);
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  await call(joinLeague, "cat", { code });
  assert.equal(league(leagueId).pot, 300);

  // ben borrows heavily: more tokens, but not more net worth.
  await call(takeBankLoan, "ben", { leagueId, amount: 1000, idempotencyKey: key() });
  // cat has a bet open when the season ends.
  seedGame("late");
  await call(placeLeagueBet, "cat", { leagueId, gameId: "late", side: "home", stake: 500, idempotencyKey: key() });
  // ann wins a bet.
  seedGame("w");
  await call(placeLeagueBet, "ann", { leagueId, gameId: "w", side: "home", stake: 100, idempotencyKey: key() });
  finishGame("w", 3, 1);
  await settleLeagueBetsForGame("w");

  clock.advanceHours(24);
  // Run the creator's button and the scheduler at the same time.
  await Promise.all([call(endLeague, "ann", { leagueId }), sweepLeagues(clock.get() + 8 * 86_400_000)]);
  await sweepLeagues(clock.get() + 8 * 86_400_000);

  const l = league(leagueId);
  assert.equal(l.status, "ended");
  const results = l.results as Array<{ memberId: string; prizeTokens: number; paid: boolean; netWorth: number }>;
  assert.deepEqual(results.map((r) => r.memberId), ["ann", "cat", "ben"]);
  assert.equal(results[2]!.netWorth, 1000 - 100, "ben pays one period of interest");
  assert.deepEqual(results.map((r) => r.prizeTokens), [210, 90, 0]);
  assert.ok(results.filter((r) => r.prizeTokens > 0).every((r) => r.paid));
  assert.equal(l.payoutStatus, "paid");

  assert.equal(balance("ann"), 900 + 210);
  assert.equal(balance("cat"), 900 + 90);
  assert.equal(balance("ben"), 900);
  assert.equal(ledger("ann").filter((x) => x.type === "league_payout").length, 1);
  assert.equal(notifications("ann").filter((n) => n.type === "league_payout").length, 1);
  assert.equal(notifications("ben").filter((n) => n.type === "league_ended").length, 1);

  // cat's open bet was voided and refunded before ranking; settling the game later does nothing.
  assert.equal(db.list(`leagues/${leagueId}/leagueBets/`).find((b) => b.data.uid === "cat")!.data.status, "cancelled");
  finishGame("late", 1, 0);
  assert.equal(await settleLeagueBetsForGame("late"), 0);
  await rejects(
    call(placeLeagueBet, "ann", { leagueId, gameId: "late", side: "home", stake: 10, idempotencyKey: key() }),
    /ended/
  );
});

test("invites go to friends only, as a notification with the code", async () => {
  seedUser("ann", 1000);
  seedUser("ben", 1000);
  seedUser("zed", 1000);
  const { leagueId, code } = await makeLeague("ann");
  db.seed("friendships/ann_ben", { users: ["ann", "ben"] });
  await call(inviteToLeague, "ann", { leagueId, friendUid: "ben" });
  await call(inviteToLeague, "ann", { leagueId, friendUid: "ben" });
  const inv = notifications("ben").filter((n) => n.type === "league_invite");
  assert.equal(inv.length, 1);
  assert.equal((inv[0]!.data as { code: string }).code, code);
  await rejects(call(inviteToLeague, "ann", { leagueId, friendUid: "zed" }), /only invite friends/);
});

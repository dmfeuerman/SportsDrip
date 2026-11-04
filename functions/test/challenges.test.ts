import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { balance, call, clock, db, finishGame, key, ledger, notifications, rejects, seedGame, seedUser } from "./helpers";
import { cancelChallenge, createChallenge, respondChallenge } from "../src/callable/challenges";
import { purchaseItem } from "../src/callable/shop";
import { placeBet } from "../src/callable/bets";
import {
  expirePendingChallenges,
  refundStaleChallenges,
  settleChallengesForGame,
  sweepChallenges,
} from "../src/lib/challengeSettlement";
import { challengePayouts, challengeTerms } from "../src/lib/challengeMath";

const START = Date.UTC(2026, 9, 1, 12);

beforeEach(() => {
  db.reset();
  clock.set(START);
});

function befriend(a: string, b: string) {
  const id = a < b ? `${a}_${b}` : `${b}_${a}`;
  db.seed(`friendships/${id}`, { users: [a, b].sort() });
}

function setup(aBal = 1000, bBal = 1000) {
  seedUser("amy", aBal, "Amy");
  seedUser("ben", bBal, "Ben");
  befriend("amy", "ben");
  seedGame("g1"); // BOS (home) v NYK (away)
}

async function challenge(over: Record<string, unknown> = {}) {
  const res = await call<{ challengeId: string; duplicate: boolean }>(createChallenge, "amy", {
    gameId: "g1",
    opponentUid: "ben",
    side: "home",
    mode: "pot",
    stake: 100,
    idempotencyKey: key(),
    ...over,
  });
  return res.challengeId;
}

const ch = (id: string) => db.read(`challenges/${id}`)!;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

test("pot and odds terms: who escrows what", () => {
  const pot = challengeTerms("pot", 250);
  assert.ok(pot.ok);
  assert.deepEqual(pot.ok && pot.terms, { mode: "pot", odds: 2, creatorStake: 250, opponentStake: 250, pot: 500 });

  const odds = challengeTerms("odds", 100, 2.5);
  assert.ok(odds.ok);
  assert.deepEqual(odds.ok && odds.terms, { mode: "odds", odds: 2.5, creatorStake: 100, opponentStake: 150, pot: 250 });

  const fav = challengeTerms("odds", 300, 1.4);
  assert.ok(fav.ok && fav.terms.opponentStake === 120 && fav.terms.pot === 420);

  assert.equal(challengeTerms("odds", 10, 1.5).ok, false, "friend's side under the minimum");
  assert.equal(challengeTerms("odds", 100, 15).ok, false, "odds out of range");
  assert.equal(challengeTerms("pot", 5).ok, false, "stake under the minimum");

  assert.deepEqual(challengePayouts("creator", { creatorStake: 100, opponentStake: 150, pot: 250 }), { creator: 250, opponent: 0 });
  assert.deepEqual(challengePayouts("push", { creatorStake: 100, opponentStake: 150, pot: 250 }), { creator: 100, opponent: 150 });
});

test("the app's copy of the challenge rules matches the server's", () => {
  const strip = (s: string) => s.replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
  const server = readFileSync(join(__dirname, "../../../src/lib/challengeMath.ts"), "utf8");
  const app = readFileSync(join(__dirname, "../../../../artifacts/mobile/lib/challengeMath.ts"), "utf8");
  assert.equal(strip(app), strip(server));
});

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

test("sending a challenge escrows the challenger's stake and notifies the friend", async () => {
  setup();
  // Firebase httpsCallable encodes `{ odds: undefined, message: undefined }` as `{ odds: null, message: null }` on the wire.
  const id = await challenge({ stake: 200, odds: null, message: null });
  assert.equal(balance("amy"), 800);
  assert.equal(balance("ben"), 1000);
  const c = ch(id);
  assert.equal(c.status, "pending");
  assert.equal(c.pot, 400);
  assert.deepEqual(c.participants, ["amy", "ben"]);
  assert.equal(ledger("amy").filter((l) => l.type === "challenge_escrow").length, 1);
  const [n] = notifications("ben");
  assert.equal(n!.type, "challenge_received");
  assert.equal((n!.data as { challengeId: string }).challengeId, id);
});

test("escrowed credits can't be spent while the challenge is open", async () => {
  setup(300);
  await challenge({ stake: 250 });
  assert.equal(balance("amy"), 50);
  db.seed("catalog/cap", { name: "Cap", slot: "hat", price: 100, available: true });
  await rejects(call(purchaseItem, "amy", { itemId: "cap", idempotencyKey: key() }), /Not enough credits/);
  seedGame("g2");
  await rejects(call(placeBet, "amy", { gameId: "g2", side: "home", stake: 100, idempotencyKey: key() }), /Not enough credits/);
  assert.equal(balance("amy"), 50);
});

test("can't challenge more than you have, a stranger, yourself, or a started game", async () => {
  setup(80);
  await rejects(challenge({ stake: 100 }), /Not enough credits/);
  seedUser("cal", 1000);
  await rejects(challenge({ opponentUid: "cal" }), /only challenge friends/);
  await rejects(challenge({ opponentUid: "amy", stake: 50 }), /Pick a friend/);
  seedGame("g1", { startsAt: Date.now() - 1000 });
  await rejects(challenge({ stake: 50 }), /already started/);
  assert.equal(balance("amy"), 80);
});

test("a double-tapped challenge is one challenge and one escrow", async () => {
  setup();
  const k = key();
  await Promise.all([1, 2, 3].map(() => challenge({ idempotencyKey: k })));
  assert.equal(balance("amy"), 900);
  assert.equal(db.list("challenges/").length, 1);
});

test("accepting escrows the friend's stake; an underfunded friend can't accept", async () => {
  setup(1000, 120);
  const id = await challenge({ mode: "odds", odds: 2.5, stake: 100 }); // ben owes 150
  await rejects(call(respondChallenge, "ben", { challengeId: id, accept: true }), /need 150 credits/);
  assert.equal(ch(id).status, "pending");
  assert.equal(balance("ben"), 120);

  db.seed("users/ben", { ...db.read("users/ben")!, balance: 500 });
  const res = await call<{ status: string }>(respondChallenge, "ben", { challengeId: id, accept: true });
  assert.equal(res.status, "accepted");
  assert.equal(balance("ben"), 350);
  assert.equal(ch(id).status, "accepted");
  assert.equal(notifications("amy").filter((n) => n.type === "challenge_accepted").length, 1);
  // Nobody else can answer it, and the challenger can't pull out now.
  await rejects(call(respondChallenge, "amy", { challengeId: id, accept: true }), /isn't for you/);
  await rejects(call(cancelChallenge, "amy", { challengeId: id }), /already accepted/);
});

test("a racing double-accept escrows once", async () => {
  setup();
  const id = await challenge();
  await Promise.all([1, 2, 3].map(() => call(respondChallenge, "ben", { challengeId: id, accept: true }).catch(() => null)));
  assert.equal(balance("ben"), 900);
  assert.equal(ledger("ben").filter((l) => l.type === "challenge_escrow").length, 1);
});

test("declining or withdrawing refunds the challenger once", async () => {
  setup();
  const a = await challenge();
  await call(respondChallenge, "ben", { challengeId: a, accept: false });
  assert.equal(ch(a).status, "declined");
  assert.equal(balance("amy"), 1000);
  assert.equal(notifications("amy").filter((n) => n.type === "challenge_declined").length, 1);

  const b = await challenge();
  await Promise.all([call(cancelChallenge, "amy", { challengeId: b }), call(cancelChallenge, "amy", { challengeId: b })]);
  assert.equal(ch(b).status, "cancelled");
  assert.equal(balance("amy"), 1000);
  await rejects(call(respondChallenge, "ben", { challengeId: b, accept: true }), /already cancelled/);
  assert.equal(balance("ben"), 1000);
});

test("an unanswered challenge expires at kickoff and the challenger is refunded", async () => {
  setup();
  const id = await challenge();
  clock.advanceHours(4); // past startsAt, status still "upcoming" (sync lag)
  const res = await call<{ status: string }>(respondChallenge, "ben", { challengeId: id, accept: true });
  assert.equal(res.status, "expired");
  assert.equal(ch(id).status, "expired");
  assert.equal(balance("amy"), 1000);
  assert.equal(balance("ben"), 1000);

  clock.set(START);
  const again = await challenge();
  clock.advanceHours(4);
  await Promise.all([sweepChallenges(), expirePendingChallenges("g1")]);
  assert.equal(ch(again).status, "expired");
  assert.equal(balance("amy"), 1000);
  assert.equal(notifications("amy").filter((n) => n.type === "challenge_expired").length, 2);
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

test("pot: the winner takes the whole pot, once, with a popup each side", async () => {
  setup();
  const id = await challenge({ stake: 200 }); // amy BOS, ben NYK
  await call(respondChallenge, "ben", { challengeId: id, accept: true });
  assert.equal(balance("amy"), 800);
  assert.equal(balance("ben"), 800);

  finishGame("g1", 110, 100);
  const n = await Promise.all([settleChallengesForGame("g1"), settleChallengesForGame("g1"), sweepChallenges()]);
  assert.equal(n.reduce((a, b) => a + b, 0), 1);
  assert.equal(balance("amy"), 1200);
  assert.equal(balance("ben"), 800);
  assert.equal(ch(id).status, "settled");
  assert.equal(ch(id).winnerUid, "amy");

  const won = notifications("amy").find((x) => x.type === "challenge_won")!;
  assert.equal(won.delta, 400);
  assert.equal(won.balanceAfter, 1200);
  assert.equal(won.popup, true);
  const lost = notifications("ben").find((x) => x.type === "challenge_lost")!;
  assert.equal(lost.delta, -200);
  assert.equal(lost.balanceAfter, 800);
  assert.equal((lost.bet as { teamAbbr: string }).teamAbbr, "NYK");

  assert.equal(await settleChallengesForGame("g1"), 0);
  assert.equal(balance("amy"), 1200);
});

test("odds: the friend who covers the price wins the pot when the pick loses", async () => {
  setup();
  const id = await challenge({ mode: "odds", odds: 3, stake: 100 }); // ben covers 200
  await call(respondChallenge, "ben", { challengeId: id, accept: true });
  assert.equal(balance("ben"), 800);
  finishGame("g1", 90, 99);
  await settleChallengesForGame("g1");
  assert.equal(balance("amy"), 900);
  assert.equal(balance("ben"), 1100);
  assert.equal(ch(id).outcome, "opponent");
});

test("a draw hands both stakes back", async () => {
  setup();
  const id = await challenge({ mode: "odds", odds: 2.2, stake: 100 }); // ben 120
  await call(respondChallenge, "ben", { challengeId: id, accept: true });
  finishGame("g1", 3, 3);
  await settleChallengesForGame("g1");
  assert.equal(balance("amy"), 1000);
  assert.equal(balance("ben"), 1000);
  assert.equal(ch(id).outcome, "push");
});

test("a pending challenge still open at the final whistle expires instead of settling", async () => {
  setup();
  const id = await challenge();
  finishGame("g1", 1, 0);
  await settleChallengesForGame("g1");
  assert.equal(ch(id).status, "expired");
  assert.equal(balance("amy"), 1000);
  assert.equal(balance("ben"), 1000);
});

test("a game that never happens voids an accepted challenge and refunds both", async () => {
  setup();
  const id = await challenge({ mode: "odds", odds: 1.5, stake: 200 }); // ben 100
  await call(respondChallenge, "ben", { challengeId: id, accept: true });
  db.docs.delete("games/g1");
  await Promise.all([refundStaleChallenges(clock.get()), refundStaleChallenges(clock.get())]);
  assert.equal(ch(id).status, "void");
  assert.equal(balance("amy"), 1000);
  assert.equal(balance("ben"), 1000);
  assert.equal(notifications("ben").filter((n) => n.type === "challenge_refunded").length, 1);
});

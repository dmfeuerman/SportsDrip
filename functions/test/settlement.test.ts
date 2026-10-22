import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, payoutFor, settlementCredit } from "../src/lib/settlement";
import { betNotificationId, betResultNotification, type BetSummary } from "../src/lib/notifyModel";

test("decide: home/away/draw", () => {
  assert.equal(decide("home", 3, 1), "won");
  assert.equal(decide("away", 3, 1), "lost");
  assert.equal(decide("away", 1, 3), "won");
  assert.equal(decide("home", 2, 2), "push");
  assert.equal(decide("away", 0, 0), "push");
});

test("settlement credit: payout on win, stake on push, nothing on loss", () => {
  assert.equal(settlementCredit("won", 100, 185), 185);
  assert.equal(settlementCredit("push", 100, 185), 100);
  assert.equal(settlementCredit("lost", 100, 185), 0);
  assert.equal(payoutFor(100, 1.855), 186);
});

const bet: BetSummary = {
  betId: "u1_k1",
  gameId: "NBA:1",
  sport: "NBA",
  side: "home",
  teamName: "Boston Celtics",
  teamAbbr: "BOS",
  teamColor: "#007A33",
  opponentAbbr: "NYK",
  odds: 1.85,
  stake: 100,
  payout: 185,
  finalHomeScore: 110,
  finalAwayScore: 99,
};

test("notification ids are deterministic per bet and per wallet", () => {
  assert.equal(betNotificationId("b1"), "settle_b1");
  assert.equal(betNotificationId("b1", "lg1"), "lsettle_lg1_b1");
});

test("win and loss notifications carry outcome, amount, balance and bet details", () => {
  const won = betResultNotification({ outcome: "won", bet, balanceAfter: 1085, wallet: "credits", now: 1 });
  assert.equal(won.type, "bet_won");
  assert.equal(won.delta, 185);
  assert.equal(won.balanceAfter, 1085);
  assert.equal(won.popup, true);
  assert.equal(won.read, false);
  assert.match(won.body, /110–99/);
  assert.equal(won.bet?.odds, 1.85);

  const lost = betResultNotification({
    outcome: "lost",
    bet: { ...bet, side: "away", teamAbbr: "NYK", teamName: "New York Knicks", opponentAbbr: "BOS" },
    balanceAfter: 900,
    wallet: "league",
    leagueId: "lg1",
    leagueName: "Office",
    now: 1,
  });
  assert.equal(lost.type, "bet_lost");
  assert.equal(lost.delta, -100);
  assert.equal(lost.id, "lsettle_lg1_u1_k1");
  assert.match(lost.body, /99–110/);
  assert.match(lost.body, /league tokens staked in Office/);

  const push = betResultNotification({ outcome: "push", bet, balanceAfter: 1000, wallet: "credits", now: 1 });
  assert.equal(push.popup, false);
});

import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { balance, call, clock, db, finishGame, key, notifications, rejects, seedGame, seedUser } from "./helpers";
import { placeBet } from "../src/callable/bets";
import {
  createLeague,
  endLeague,
  joinLeague,
  peerLoanAction,
  placeLeagueBet,
  reportResult,
  requestPeerLoan,
  takeBankLoan,
  updateLeagueSettings,
  voidLeagueBet,
  voteEndLeague,
} from "../src/callable/leagues";
import { openPrizeBox, claimPrizeBox } from "../src/callable/prizes";
import { reactToItem } from "../src/callable/social";
import { makePick } from "../src/callable/picks";
import { createGroupParlay, addParlayLeg, lockParlay, rideParlay } from "../src/callable/parlays";
import { getPlayerProfile } from "../src/callable/players";
import { equipItem } from "../src/callable/shop";
import { settleBetsForGame, settleLeagueBetsForGame, voidDisrupted } from "../src/scheduled/settleBets";
import { sendLockReminders } from "../src/scheduled/reminders";
import { sendClutchAlerts } from "../src/scheduled/syncGames";
import { closeMatchups, generateTuesdayReport, openWeekMatchups } from "../src/scheduled/weekly";
import { sweepLeagues } from "../src/scheduled/leagues";
import { parseEvent } from "../src/lib/sportsProvider";

const START = Date.UTC(2026, 9, 5, 16); // Monday 12:00 ET
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  db.reset();
  clock.set(START);
});

async function makeLeague(owner: string, over: Record<string, unknown> = {}) {
  return call<{ leagueId: string; code: string }>(createLeague, owner, {
    idempotencyKey: key(),
    name: "Audit League",
    startingLeagueTokens: 1000,
    duration: "1 Month",
    sports: ["NBA", "NFL", "MLB"],
    buyIn: 100,
    prizePreset: "top-2",
    bankLoanEnabled: true,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
    ...over,
  });
}

const leagueDoc = (id: string) => db.read(`leagues/${id}`)!;
const tokens = (id: string, uid: string) =>
  (leagueDoc(id).members as Record<string, { leagueTokens: number }>)[uid]!.leagueTokens;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sub = (id: string, c: string): Array<Record<string, any> & { id: string }> =>
  db.list(`leagues/${id}/${c}/`).map((d) => ({ ...d.data, id: d.path.split("/").pop()! }));

// ---------------------------------------------------------------------------
// 1. Spread and Total Markets + Line Freeze
// ---------------------------------------------------------------------------

test("spread and total markets pay 1.91x, push on the exact number, and enforce the 0.5 line freeze", async () => {
  seedUser("amy", 1000, "Amy");
  seedGame("g_spread", {
    line: { spread: "BOS -3.5", spreadHome: -3.5, overUnder: 215, provider: "ESPN BET" },
  });

  // Line freeze: moved > 0.5 from expectedLine rejects.
  await rejects(
    call(placeBet, "amy", {
      gameId: "g_spread",
      market: "spread",
      selection: "home",
      stake: 100,
      expectedLine: -2.5,
      idempotencyKey: key(),
    }),
    /line moved/i
  );

  // Within 0.5 succeeds and snapshots the server line.
  const b1 = await call<{ betId: string }>(placeBet, "amy", {
    gameId: "g_spread",
    market: "spread",
    selection: "home",
    stake: 100,
    expectedLine: -3.0,
    idempotencyKey: key(),
  });
  const doc1 = db.read(`bets/${b1.betId}`)!;
  assert.equal(doc1.odds, 1.91);
  assert.equal(doc1.line, -3.5);
  assert.equal(doc1.label, "BOS -3.5");

  // Total bet landing on exact 215 pushes.
  const b2 = await call<{ betId: string }>(placeBet, "amy", {
    gameId: "g_spread",
    market: "total",
    selection: "over",
    stake: 100,
    expectedLine: 215,
    idempotencyKey: key(),
  });
  finishGame("g_spread", 110, 105); //BOS wins by 5 (covers -3.5), total = 215 (exact push)
  await settleBetsForGame("g_spread");

  assert.equal(db.read(`bets/${b1.betId}`)!.status, "won");
  assert.equal(db.read(`bets/${b2.betId}`)!.status, "push");
  assert.equal(balance("amy"), 800 + 191 + 100);
});

// ---------------------------------------------------------------------------
// 2. Daily Pick Streak & Prize Box Bonus
// ---------------------------------------------------------------------------

test("daily pick streak counts consecutive ET days and adds a small bonus to prize boxes", async () => {
  seedUser("amy", 1000, "Amy");
  seedGame("d1", { startsAt: START + 5 * DAY });
  seedGame("d2", { startsAt: START + 5 * DAY });
  seedGame("d3", { startsAt: START + 5 * DAY });

  await call(placeBet, "amy", { gameId: "d1", side: "home", stake: 10, idempotencyKey: key() });
  // Second bet same ET day does not double-increment.
  await call(placeBet, "amy", { gameId: "d2", side: "home", stake: 10, idempotencyKey: key() });
  assert.equal((db.read("users/amy")!.streak as { count: number }).count, 1);

  clock.advanceHours(24);
  await call(placeBet, "amy", { gameId: "d3", side: "home", stake: 10, idempotencyKey: key() });
  assert.equal((db.read("users/amy")!.streak as { count: number }).count, 2);

  await call(openPrizeBox, "amy", { tier: "bronze" });
  clock.advanceHours(2);
  const claim = await call<{ rewardCredits: number; baseCredits: number; streakBonus: number; streakDays: number }>(
    claimPrizeBox,
    "amy",
    { tier: "bronze" }
  );
  assert.equal(claim.streakDays, 2);
  assert.equal(claim.streakBonus, 10);
  assert.equal(claim.rewardCredits, claim.baseCredits + 10);
});

// ---------------------------------------------------------------------------
// 3. Disrupted Games (Postponed / Cancelled)
// ---------------------------------------------------------------------------

test("ESPN postponed and cancelled statuses map to disrupted, block bets, and void appropriately", async () => {
  const canceled = parseEvent(
    {
      id: "99",
      date: new Date(START + 2 * HOUR).toISOString(),
      status: { type: { name: "STATUS_CANCELED" } },
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { displayName: "A", abbreviation: "AAA" } },
            { homeAway: "away", team: { displayName: "B", abbreviation: "BBB" } },
          ],
        },
      ],
    },
    "NBA",
    "basketball",
    null,
    "basketball/nba"
  )!;
  assert.equal(canceled.disrupted, "canceled");
  assert.equal(canceled.priced, false);

  seedUser("amy", 1000, "Amy");
  seedGame("g_can");
  seedGame("g_post", { startsAt: START + HOUR });
  await call(placeBet, "amy", { gameId: "g_can", side: "home", stake: 100, idempotencyKey: key() });
  await call(placeBet, "amy", { gameId: "g_post", side: "home", stake: 100, idempotencyKey: key() });
  assert.equal(balance("amy"), 800);

  // Flip g_can to canceled and g_post to postponed.
  seedGame("g_can", { disrupted: "canceled" });
  seedGame("g_post", { startsAt: START + HOUR, disrupted: "postponed" });

  // Canceled refunds immediately; postponed waits 24h from original start.
  await voidDisrupted(START + 2 * HOUR);
  assert.equal(balance("amy"), 900);

  // 25h after original start, postponed voids too.
  await voidDisrupted(START + 26 * HOUR);
  assert.equal(balance("amy"), 1000);
});

// ---------------------------------------------------------------------------
// 4. Early End Majority Vote, Tie Prize Split, Rules & Audit Log, Disputes/Void
// ---------------------------------------------------------------------------

test("ending early takes a majority vote; the creator alone can't cash out a lead", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  seedUser("cat", 1000, "Cat");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  await call(joinLeague, "cat", { code });

  seedGame("g1");
  await call(placeLeagueBet, "ann", { leagueId, gameId: "g1", side: "home", stake: 200, idempotencyKey: key() });
  finishGame("g1", 10, 5);
  await settleLeagueBetsForGame("g1");

  // Ann is leading but cannot end alone in a 3-person league.
  await rejects(call(endLeague, "ann", { leagueId }), /majority vote/i);

  const v1 = await call<{ ended: boolean; votes: number; needed: number }>(voteEndLeague, "ann", {
    leagueId,
    vote: true,
  });
  assert.equal(v1.ended, false);
  assert.equal(v1.votes, 1);
  assert.equal(v1.needed, 2);

  await call(voteEndLeague, "ben", { leagueId, vote: false });
  const v3 = await call<{ ended: boolean }>(voteEndLeague, "cat", { leagueId, vote: true });
  assert.equal(v3.ended, true);
  assert.equal(leagueDoc(leagueId).status, "ended");

  const audit = sub(leagueId, "audit");
  assert.ok(audit.filter((a) => a.action === "end_vote").length >= 3);
});

test("tied standings split the combined prize equally instead of favouring earliest joinedAt", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  seedUser("cat", 1000, "Cat");
  const { leagueId, code } = await makeLeague("ann", { prizePreset: "top-2", buyIn: 100 });
  await call(joinLeague, "ben", { code });
  await call(joinLeague, "cat", { code });

  // Cat loses 100 so Ann and Ben tie for 1st/2nd at 1000 each (pot 300: 210 + 90 = 300 -> 150 each).
  seedGame("g_tie");
  await call(placeLeagueBet, "cat", { leagueId, gameId: "g_tie", side: "away", stake: 100, idempotencyKey: key() });
  finishGame("g_tie", 10, 5);
  await settleLeagueBetsForGame("g_tie");

  await sweepLeagues(START + 35 * DAY);
  const results = leagueDoc(leagueId).results as Array<{ memberId: string; rank: number; prizeTokens: number }>;
  const annRes = results.find((r) => r.memberId === "ann")!;
  const benRes = results.find((r) => r.memberId === "ben")!;
  assert.equal(annRes.rank, 1);
  assert.equal(benRes.rank, 1);
  assert.equal(annRes.prizeTokens, 150);
  assert.equal(benRes.prizeTokens, 150);
  assert.equal(balance("ann"), 900 + 150);
  assert.equal(balance("ben"), 900 + 150);
});

test("commissioner rules lock after the first bet, and every settings change/dispute/void writes to audit", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });

  // Rule edit before any bet succeeds and logs before/after.
  await call(updateLeagueSettings, "ann", {
    leagueId,
    name: "Renamed League",
    prizePreset: "winner-all",
  });
  const settingsAudit = sub(leagueId, "audit").find((a) => a.action === "settings")!;
  assert.equal(settingsAudit.before.name, "Audit League");
  assert.equal(settingsAudit.after.name, "Renamed League");

  // Place a bet -> rule edits now lock, bank edits still allowed.
  seedGame("g_rule");
  const bet = await call<{ betId: string }>(placeLeagueBet, "ben", {
    leagueId,
    gameId: "g_rule",
    side: "home",
    stake: 200,
    idempotencyKey: key(),
  });
  await rejects(
    call(updateLeagueSettings, "ann", { leagueId, prizePreset: "top-3" }),
    /locked once the first bet/i
  );
  await call(updateLeagueSettings, "ann", { leagueId, bankLoanEnabled: false });

  // Settle, then Ben flags the result and Ann voids it with a logged reason.
  finishGame("g_rule", 5, 10);
  await settleLeagueBetsForGame("g_rule");
  assert.equal(tokens(leagueId, "ben"), 800);

  await call(reportResult, "ben", { leagueId, betId: bet.betId, reason: "Stat correction after overtime" });
  assert.ok(sub(leagueId, "audit").some((a) => a.action === "dispute_reported"));

  await call(voidLeagueBet, "ann", { leagueId, betId: bet.betId, reason: "Verified stat correction" });
  const voidAudit = sub(leagueId, "audit").find((a) => a.action === "bet_voided")!;
  assert.equal(voidAudit.reason, "Verified stat correction");
  assert.equal(db.read(`leagues/${leagueId}/leagueBets/${bet.betId}`)!.status, "cancelled");
  assert.equal(tokens(leagueId, "ben"), 1000);
});

// ---------------------------------------------------------------------------
// 5. Chat Bet Cards, Hidden Picks, Reactions, Lock of the Week, Sweat & Rivalries
// ---------------------------------------------------------------------------

test("league bets post chat cards, update gameSides, respect hidden flag, and support emoji reactions", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  seedGame("g_chat");

  const b1 = await call<{ betId: string }>(placeLeagueBet, "ann", {
    leagueId,
    gameId: "g_chat",
    side: "home",
    stake: 150,
    lock: true,
    idempotencyKey: key(),
  });
  // Only one Lock of the Week per member per week.
  seedGame("g_chat2");
  await rejects(
    call(placeLeagueBet, "ann", {
      leagueId,
      gameId: "g_chat2",
      side: "home",
      stake: 50,
      lock: true,
      idempotencyKey: key(),
    }),
    /Lock of the Week/i
  );

  // Ben places a hidden pick: no chat card, not in gameSides, activity text hides the team.
  await call(placeLeagueBet, "ben", {
    leagueId,
    gameId: "g_chat",
    side: "away",
    stake: 150,
    hidden: true,
    idempotencyKey: key(),
  });

  const sides = sub(leagueId, "gameSides").find((s) => s.id === "g_chat")!;
  assert.equal(sides.entries.length, 1);
  assert.equal(sides.entries[0].uid, "ann");

  const msgs = sub(leagueId, "messages");
  assert.equal(msgs.filter((m) => m.kind === "bet").length, 1);
  const benFeed = sub(leagueId, "activity").find((a) => a.uid === "ben" && a.type === "bet_placed")!;
  assert.doesNotMatch(benFeed.text, /NYK|BOS/);

  // Reactions toggle cleanly on messages and bets.
  const msgId = `bet_${b1.betId}`;
  await call(reactToItem, "ben", { leagueId, targetType: "message", targetId: msgId, emoji: "🔥" });
  assert.deepEqual(db.read(`leagues/${leagueId}/messages/${msgId}`)!.reactions, { "🔥": 1 });
  await call(reactToItem, "ben", { leagueId, targetType: "message", targetId: msgId, emoji: "🔥" });
  assert.deepEqual(db.read(`leagues/${leagueId}/messages/${msgId}`)!.reactions, {});
});

test("opposing league bets record head-to-head rivalry records and surface in getPlayerProfile", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });
  seedGame("g_riv");

  await call(placeLeagueBet, "ann", { leagueId, gameId: "g_riv", side: "home", stake: 100, lock: true, idempotencyKey: key() });
  await call(placeLeagueBet, "ben", { leagueId, gameId: "g_riv", side: "away", stake: 100, idempotencyKey: key() });

  finishGame("g_riv", 110, 95);
  await settleLeagueBetsForGame("g_riv");

  const riv = sub(leagueId, "rivalries")[0]!;
  assert.deepEqual([riv.aWins, riv.bWins, riv.pushes], [1, 0, 0]);
  assert.ok(sub(leagueId, "activity").some((a) => a.type === "rivalry"));

  const prof = await call<{ league: { rivalry: { myWins: number; theirWins: number } } }>(
    getPlayerProfile,
    "ann",
    { uid: "ben", leagueId }
  );
  assert.deepEqual(prof.league.rivalry, { myWins: 1, theirWins: 0, pushes: 0 });
});

// ---------------------------------------------------------------------------
// 6. Lock Reminders, Clutch Alerts, Reports, Matchups, Pick'em/Survivor, Parlays, Awards
// ---------------------------------------------------------------------------

test("lock reminders notify unbet league members once per league per day, and clutch alerts fire once", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });

  seedGame("g_soon", { startsAt: START + 16 * 60_000 });
  await call(placeLeagueBet, "ann", { leagueId, gameId: "g_soon", side: "home", stake: 100, idempotencyKey: key() });

  assert.equal(await sendLockReminders(START), 1);
  assert.equal(await sendLockReminders(START), 0, "capped at one reminder per league per day");
  assert.ok(notifications("ben").some((n) => n.type === "lock_reminder"));

  // Game goes live in Q4 with 2:00 left and 3-point lead -> clutch alert fires once.
  seedGame("g_soon", { status: "live", period: 4, clock: "2:00", clockSec: 120, homeScore: 102, awayScore: 99 });
  assert.equal(await sendClutchAlerts(undefined, START + 20 * 60_000), 1);
  assert.equal(await sendClutchAlerts(undefined, START + 21 * 60_000), 0);
  assert.ok(notifications("ann").some((n) => n.type === "clutch_alert"));
});

test("Tuesday League Report and weekly head-to-head matchups grade and seed playoffs", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann", { matchupsEnabled: true });
  await call(joinLeague, "ben", { code });

  await openWeekMatchups(leagueId, START, "2026-10-05");
  seedGame("g_wk1");
  await call(placeLeagueBet, "ann", { leagueId, gameId: "g_wk1", side: "home", stake: 200, idempotencyKey: key() });
  await call(placeLeagueBet, "ben", { leagueId, gameId: "g_wk1", side: "away", stake: 200, idempotencyKey: key() });
  finishGame("g_wk1", 105, 100);
  await settleLeagueBetsForGame("g_wk1");

  const rep = await generateTuesdayReport(leagueId, START + DAY, "2026-10-05");
  assert.ok(rep && rep.cards.length >= 2);

  await closeMatchups(leagueId, START + 7 * DAY);
  const mDoc = sub(leagueId, "matchups")[0]!;
  assert.equal(mDoc.pairs[0].winnerUid, "ann");
});

test("survivor: one team a week, never twice, a loss or a missed week is out", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann", { mode: "survivor", buyIn: 0 });
  await call(joinLeague, "ben", { code });

  seedGame("s1", { startsAt: START + 2 * HOUR });
  await call(makePick, "ann", { leagueId, gameId: "s1", side: "home" }); // BOS
  await call(makePick, "ben", { leagueId, gameId: "s1", side: "away" }); // NYK
  finishGame("s1", 100, 90);
  await (await import("../src/callable/picks")).settlePicksForGame("s1");

  // Ben lost -> eliminated; cannot pick next week.
  seedGame("s2", {
    startsAt: START + 8 * DAY,
    homeTeam: { name: "Boston Celtics", abbreviation: "BOS", color: "#007A33", odds: 1.8 },
    awayTeam: { name: "Miami Heat", abbreviation: "MIA", color: "#98002E", odds: 2.1 },
  });
  await rejects(call(makePick, "ben", { leagueId, gameId: "s2", side: "away" }), /knocked out|already|closed/);
  // Ann cannot reuse BOS in week 2.
  await rejects(call(makePick, "ann", { leagueId, gameId: "s2", side: "home" }), /already used BOS/);
  await call(makePick, "ann", { leagueId, gameId: "s2", side: "away" });
});

test("group parlays cap combined price at 20x and call out whose leg busted the ticket", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });

  seedGame("p1");
  seedGame("p2");
  const { parlayId } = await call<{ parlayId: string }>(createGroupParlay, "ann", {
    leagueId,
    idempotencyKey: key(),
    stake: 100,
    leg: { gameId: "p1", side: "home" },
  });
  await call(addParlayLeg, "ben", {
    leagueId,
    parlayId,
    gameId: "p2",
    side: "away",
    stake: 100,
  });
  await call(lockParlay, "ann", { leagueId, parlayId });
  await rejects(call(rideParlay, "ann", { leagueId, parlayId, stake: 50 }), /already riding/);

  // Ann's leg wins, Ben's leg loses -> parlay busts and blames Ben.
  finishGame("p1", 10, 5);
  finishGame("p2", 10, 5);
  const { gradeParlays } = await import("../src/callable/parlays");
  await gradeParlays("p1");
  await gradeParlays("p2");

  const p = sub(leagueId, "parlays")[0]!;
  assert.equal(p.status, "lost");
  assert.equal(p.bustedBy, "ben");
  assert.ok(sub(leagueId, "activity").some((a) => /Ben's leg/.test(a.text)));
});

test("season awards grant champion crown, lock last-place punishment for 7 days, and bailouts/margin calls fire", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  db.seed("catalog/hat_gold_crown", { id: "hat_gold_crown", name: "Crown", slot: "hat", model: "hat_crown", price: 50000, available: true });
  db.seed("catalog/hat_bubblegum_beanie", { id: "hat_bubblegum_beanie", name: "Bubblegum Beanie", slot: "hat", model: "hat_beanie", price: 1500, available: true });
  db.seed("catalog/hat_midnight_cap", { id: "hat_midnight_cap", name: "Cap", slot: "hat", model: "hat_cap", price: 900, available: true });
  db.seed("users/ben/inventory/hat_midnight_cap", { itemId: "hat_midnight_cap", slot: "hat" });

  const { leagueId, code } = await makeLeague("ann");
  await call(joinLeague, "ben", { code });

  // Ben takes a bank loan and loses almost everything -> margin call + bailout.
  await call(takeBankLoan, "ben", { leagueId, amount: 500, idempotencyKey: key() });
  seedGame("g_bust");
  await call(placeLeagueBet, "ben", { leagueId, gameId: "g_bust", side: "away", stake: 1450, idempotencyKey: key() });
  finishGame("g_bust", 20, 10);
  await settleLeagueBetsForGame("g_bust");
  assert.ok(notifications("ben").some((n) => n.type === "margin_call"));

  // Ben has 50 tokens left (< 100) and requests a peer loan; Ann funds -> bailout row.
  const { loanId } = await call<{ loanId: string }>(requestPeerLoan, "ben", {
    leagueId,
    amount: 200,
    rate: 10,
    idempotencyKey: key(),
  });
  await call(peerLoanAction, "ann", { leagueId, loanId, action: "fund" });
  assert.ok(sub(leagueId, "activity").some((a) => a.type === "bailout"));

  // End season -> Ann gets champion trophy, Ben gets 7-day punishment lock.
  await sweepLeagues(START + 35 * DAY);
  assert.ok(db.read(`users/ann/trophies/champ_${leagueId}`));
  assert.ok(db.read(`users/ben/trophies/last_${leagueId}`));
  await rejects(call(equipItem, "ben", { slot: "hat", itemId: "hat_midnight_cap" }), /punishment/i);
});

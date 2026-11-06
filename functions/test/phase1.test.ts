import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { addPal, balance, call, clock, db, key, notifications, rejects, seedGame, seedUser } from "./helpers";
import { placeBet } from "../src/callable/bets";
import { createLeague, placeLeagueBet } from "../src/callable/leagues";
import { joinBeforeStart as joinLeague } from "./helpers";
import { registerPushToken } from "../src/callable/push";
import { settleLeagueBetsForGame } from "../src/scheduled/settleBets";
import { extractMoneylines, priceMarket } from "../src/lib/sportsProvider";
import { buildPushMessages, isExpoPushToken, mergeToken, MAX_TOKENS_PER_USER } from "../src/lib/push";
import { notificationRoute } from "../src/lib/notifyModel";
import { finishGame } from "./helpers";

const START = Date.UTC(2026, 9, 1, 12);
const DAY = 86_400_000;

beforeEach(() => {
  db.reset();
  clock.set(START);
});

async function league(owner: string, over: Record<string, unknown> = {}) {
  return call<{ leagueId: string; code: string }>(createLeague, owner, {
    idempotencyKey: key(),
    name: "Office",
    startingLeagueTokens: 1000,
    duration: "1 Month",
    sports: ["NBA", "NFL"],
    buyIn: 0,
    prizePreset: "winner-all",
    bankLoanEnabled: false,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
    ...over,
  });
}

const leagueDoc = (id: string) => db.read(`leagues/${id}`)!;
const tokens = (id: string, uid: string) => (leagueDoc(id).members as Record<string, { leagueTokens: number }>)[uid]!.leagueTokens;
const leagueBet = (id: string, betId: string) => db.read(`leagues/${id}/leagueBets/${betId}`)!;

// ---------------------------------------------------------------------------
// No hash-priced games
// ---------------------------------------------------------------------------

test("priceMarket needs both moneylines and never invents a price", () => {
  assert.equal(priceMarket(null, -150), null);
  assert.equal(priceMarket(130, null), null);
  assert.equal(priceMarket(null, null), null);
  const p = priceMarket(-150, 130)!;
  assert.ok(p.home > 1 && p.away > 1);
  assert.ok(p.home < p.away, "the favourite pays less");
});

test("moneylines are read from every ESPN odds shape, and OFF / missing lines stay unpriced", () => {
  assert.deepEqual(extractMoneylines({ homeTeamOdds: { moneyLine: -150 }, awayTeamOdds: { moneyLine: 130 } }), { home: -150, away: 130 });
  assert.deepEqual(
    extractMoneylines({ moneyline: { home: { close: { odds: "-238" }, open: { odds: "-205" } }, away: { close: { odds: "+195" } } } }),
    { home: -238, away: 195 }
  );
  assert.deepEqual(extractMoneylines({ moneyline: { home: { open: { odds: "EVEN" } }, away: { open: { odds: "-110" } } } }), { home: 100, away: -110 });
  assert.deepEqual(extractMoneylines({ moneyline: { home: { close: { odds: "OFF" } }, away: { close: { odds: "+120" } } } }), { home: null, away: 120 });
  assert.deepEqual(extractMoneylines(undefined), { home: null, away: null });
  const { home, away } = extractMoneylines({ moneyline: { home: { close: { odds: "OFF" } }, away: { close: { odds: "+120" } } } });
  assert.equal(priceMarket(home, away), null);
});

test("placeBet refuses an unpriced game and a legacy game with no priced flag, and moves no credits", async () => {
  seedUser("amy", 1000);
  seedGame("nl", { priced: false, homeTeam: { name: "A", abbreviation: "A", color: "#111111", odds: null }, awayTeam: { name: "B", abbreviation: "B", color: "#222222", odds: null } });
  seedGame("legacy", { priced: undefined });
  await rejects(call(placeBet, "amy", { gameId: "nl", side: "home", stake: 100, idempotencyKey: key() }), /No line yet/);
  await rejects(call(placeBet, "amy", { gameId: "legacy", side: "home", stake: 100, idempotencyKey: key() }), /No line yet/);
  assert.equal(balance("amy"), 1000);
  seedGame("ok");
  await call(placeBet, "amy", { gameId: "ok", side: "home", stake: 100, idempotencyKey: key() });
  assert.equal(balance("amy"), 900);
});

test("placeLeagueBet refuses an unpriced game and leaves league tokens alone", async () => {
  seedUser("ann", 1000);
  const { leagueId } = await league("ann");
  await addPal(leagueId);
  seedGame("nl", { priced: false });
  await rejects(call(placeLeagueBet, "ann", { leagueId, gameId: "nl", side: "away", stake: 100, idempotencyKey: key() }), /No line yet/);
  assert.equal(tokens(leagueId, "ann"), 1000);
});

// ---------------------------------------------------------------------------
// One-month minimum
// ---------------------------------------------------------------------------

test("leagues run at least a month, in whole weeks", async () => {
  seedUser("ann", 1000);
  await rejects(league("ann", { duration: "1 Week" }), /Invalid enum value|invalid/i);
  await rejects(league("ann", { duration: "2 Weeks" }), /Invalid enum value|invalid/i);
  const { leagueId } = await league("ann");
  const l = leagueDoc(leagueId);
  assert.equal(l.endsAt, START + 28 * DAY);
  assert.equal(l.durationWeeks, 4);
  const long = await league("ann", { duration: "3 Months" });
  assert.equal(leagueDoc(long.leagueId).endsAt, START + 91 * DAY);
  assert.equal(leagueDoc(long.leagueId).durationWeeks, 13);
});

// ---------------------------------------------------------------------------
// Tail / fade
// ---------------------------------------------------------------------------

async function threeInALeague() {
  seedUser("ann", 1000, "Ann");
  seedUser("bob", 1000, "Bob");
  seedUser("cat", 1000, "Cat");
  const { leagueId, code } = await league("ann");
  await call(joinLeague, "bob", { code });
  await call(joinLeague, "cat", { code });
  seedGame("g");
  const src = await call<{ betId: string }>(placeLeagueBet, "ann", { leagueId, gameId: "g", side: "home", stake: 300, idempotencyKey: key() });
  return { leagueId, sourceId: src.betId };
}

test("a tail copies the side, bumps the counter once, posts to the feed and notifies the original bettor", async () => {
  const { leagueId, sourceId } = await threeInALeague();
  const res = await call<{ betId: string }>(placeLeagueBet, "bob", {
    leagueId, gameId: "g", side: "home", stake: 300, idempotencyKey: key(), tailOf: sourceId,
  });
  const mine = leagueBet(leagueId, res.betId);
  assert.equal(mine.tailOf, sourceId);
  assert.equal(mine.fadeOf, null);
  assert.equal(mine.followOfName, "Ann");
  const src = leagueBet(leagueId, sourceId);
  assert.equal(src.tails, 1);
  assert.equal(src.fades, 0);
  assert.deepEqual(src.followers, { bob: "tail" });
  assert.equal(tokens(leagueId, "bob"), 700);

  const feed = db.read(`leagues/${leagueId}/activity/bet_${res.betId}`)!;
  assert.equal(feed.type, "bet_tailed");
  assert.match(feed.text as string, /Bob tailed Ann on BOS/);

  const notes = notifications("ann").filter((n) => n.type === "bet_tailed");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.id, `tail_${res.betId}`);
  assert.equal(notes[0]!.leagueId, leagueId);
  assert.equal(notificationRoute(notes[0] as never), `/league/${leagueId}?tab=bets`);

  await rejects(
    call(placeLeagueBet, "bob", { leagueId, gameId: "g", side: "home", stake: 50, idempotencyKey: key(), tailOf: sourceId }),
    /already tailed/
  );
  assert.equal(leagueBet(leagueId, sourceId).tails, 1, "a second attempt doesn't count");
});

test("a fade must take the other side; tails must take the same one", async () => {
  const { leagueId, sourceId } = await threeInALeague();
  await rejects(
    call(placeLeagueBet, "cat", { leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key(), fadeOf: sourceId }),
    /other side/
  );
  await rejects(
    call(placeLeagueBet, "cat", { leagueId, gameId: "g", side: "away", stake: 100, idempotencyKey: key(), tailOf: sourceId }),
    /same side/
  );
  const res = await call<{ betId: string }>(placeLeagueBet, "cat", {
    leagueId, gameId: "g", side: "away", stake: 100, idempotencyKey: key(), fadeOf: sourceId,
  });
  assert.equal(leagueBet(leagueId, res.betId).fadeOf, sourceId);
  assert.equal(leagueBet(leagueId, sourceId).fades, 1);
  assert.equal(db.read(`leagues/${leagueId}/activity/bet_${res.betId}`)!.type, "bet_faded");
  assert.equal(notifications("ann").filter((n) => n.type === "bet_faded").length, 1);
});

test("you can't follow your own bet, a settled bet, a bet on another game, or both at once", async () => {
  const { leagueId, sourceId } = await threeInALeague();
  await rejects(
    call(placeLeagueBet, "ann", { leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key(), tailOf: sourceId }),
    /your own bet/
  );
  seedGame("other");
  await rejects(
    call(placeLeagueBet, "bob", { leagueId, gameId: "other", side: "home", stake: 100, idempotencyKey: key(), tailOf: sourceId }),
    /different game/
  );
  await rejects(
    call(placeLeagueBet, "bob", { leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key(), tailOf: sourceId, fadeOf: sourceId }),
    /tail or fade, not both/
  );
  await rejects(
    call(placeLeagueBet, "bob", { leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key(), tailOf: "nope" }),
    /isn't in this league/
  );
  assert.equal(tokens(leagueId, "bob"), 1000, "every refusal leaves tokens alone");

  finishGame("g", 3, 1);
  await settleLeagueBetsForGame("g");
  seedGame("g", { status: "upcoming" });
  await rejects(
    call(placeLeagueBet, "bob", { leagueId, gameId: "g", side: "home", stake: 100, idempotencyKey: key(), tailOf: sourceId }),
    /already settled/
  );
});

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

test("push tokens are stored privately, deduped, moved between accounts and removable", async () => {
  seedUser("amy");
  seedUser("ben");
  await rejects(call(registerPushToken, "amy", { token: "not-a-token" }), /Expo push token/);
  await call(registerPushToken, "amy", { token: TOKEN_A });
  await call(registerPushToken, "amy", { token: TOKEN_A });
  await call(registerPushToken, "amy", { token: TOKEN_B });
  const amyTokens = () => ((db.read("users/amy/private/push")?.pushTokens as Array<{ token: string }>) ?? []).map((t) => t.token);
  assert.deepEqual(amyTokens().sort(), [TOKEN_A, TOKEN_B].sort());
  assert.equal(db.read("users/amy")!.pushTokens, undefined, "never on the world-readable user doc");

  // Same phone, different account: the token follows the person signed in.
  await call(registerPushToken, "ben", { token: TOKEN_A });
  assert.deepEqual(amyTokens(), [TOKEN_B]);
  assert.deepEqual(((db.read("users/ben/private/push")!.pushTokens as Array<{ token: string }>)).map((t) => t.token), [TOKEN_A]);

  await call(registerPushToken, "amy", { token: TOKEN_B, enabled: false });
  assert.deepEqual(amyTokens(), []);
});

test("push payloads carry the in-app route and skip malformed tokens", () => {
  const msgs = buildPushMessages(
    { id: "lsettle_L_b1", type: "bet_won", title: "DET came through", body: "+500", leagueId: "L", wallet: "league", data: null },
    [TOKEN_A, "junk"],
    3
  );
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]!.to, TOKEN_A);
  assert.equal(msgs[0]!.badge, 3);
  assert.equal(msgs[0]!.data.url, "/league/L?tab=bets");
  assert.equal(msgs[0]!.data.notificationId, "lsettle_L_b1");
  assert.equal(
    notificationRoute({ type: "league_invite", leagueId: "L", wallet: "credits", data: { code: "AB3CD7" } }),
    "/join/AB3CD7"
  );
  assert.equal(notificationRoute({ type: "bet_lost", leagueId: null, wallet: "credits", data: null }), "/bets");
  assert.ok(isExpoPushToken(TOKEN_A));
  assert.ok(!isExpoPushToken("ExponentPushToken[]"));
});

test("mergeToken keeps the newest tokens, one entry each", () => {
  let list: ReturnType<typeof mergeToken> = [];
  for (let i = 0; i < MAX_TOKENS_PER_USER + 3; i++) list = mergeToken(list, `ExponentPushToken[token${String(i).padStart(10, "0")}]`, i);
  assert.equal(list.length, MAX_TOKENS_PER_USER);
  assert.equal(list[0]!.updatedAt, MAX_TOKENS_PER_USER + 2);
  list = mergeToken(list, list[5]!.token, 999);
  assert.equal(list.length, MAX_TOKENS_PER_USER);
  assert.equal(list[0]!.updatedAt, 999);
});

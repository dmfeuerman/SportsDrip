import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, clock, db, finishGame, key, seedGame, seedUser } from "./helpers";
import { createLeague } from "../src/callable/leagues";
import { joinBeforeStart as joinLeague } from "./helpers";
import { makePick, settlePicksForGame } from "../src/callable/picks";
import { sweepLeagues } from "../src/scheduled/leagues";
import { rankByMode, rankMembers } from "../src/lib/loanMath";

const START = Date.UTC(2026, 9, 5, 16);
const HOUR = 3_600_000;
beforeEach(() => {
  db.reset();
  clock.set(START);
});

// Item 15: pick'em end to end — create → pick → settle → standings → season end.
test("pick'em: live standings and season-end results rank on pick points", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  const { leagueId, code } = await call<{ leagueId: string; code: string }>(createLeague, "ann", {
    idempotencyKey: key(),
    name: "Pickers",
    startingLeagueTokens: 10_000,
    duration: "1 Month",
    sports: ["NBA"],
    buyIn: 0,
    prizePreset: "winner-all",
    mode: "pickem",
    bankLoanEnabled: false,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
  });
  await call(joinLeague, "ben", { code });
  seedGame("pk1", { startsAt: START + 2 * HOUR });
  seedGame("pk2", { startsAt: START + 3 * HOUR });
  // Ben ("b…" sorts after "a…") wins both, Ann wins none.
  await call(makePick, "ann", { leagueId, gameId: "pk1", side: "away" });
  await call(makePick, "ben", { leagueId, gameId: "pk1", side: "home" });
  await call(makePick, "ann", { leagueId, gameId: "pk2", side: "away" });
  await call(makePick, "ben", { leagueId, gameId: "pk2", side: "home" });
  finishGame("pk1", 100, 90);
  finishGame("pk2", 100, 90);
  await settlePicksForGame("pk1");
  await settlePicksForGame("pk2");

  const league = db.read(`leagues/${leagueId}`)!;
  const members = league.members as Record<string, { uid: string; leagueTokens: number; joinedAt: number; pickPoints?: number }>;
  assert.equal(members.ben!.pickPoints, 2);
  const live = rankByMode(
    rankMembers(Object.values(members).map((m) => ({ uid: m.uid, leagueTokens: m.leagueTokens, joinedAt: m.joinedAt })), [], START),
    "pickem",
    () => undefined,
    (u) => members[u]
  );
  assert.equal(live[0]!.uid, "ben");

  clock.set((league.endsAt as number) + HOUR);
  await sweepLeagues((league.endsAt as number) + HOUR);
  const results = db.read(`leagues/${leagueId}`)!.results as Array<{ memberId: string; rank: number }>;
  assert.equal(results[0]!.memberId, "ben");
});

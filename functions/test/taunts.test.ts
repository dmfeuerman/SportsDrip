import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, clock, db, key, rejects, seedUser } from "./helpers";
import { createLeague } from "../src/callable/leagues";
import { joinBeforeStart as joinLeague } from "./helpers";
import { sendTaunt, setMuteTaunts } from "../src/callable/taunts";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 9, 5, 16));
});

test("taunts: owned move, matchup opponent only, one per matchup per day, mute respected", async () => {
  seedUser("ann", 1000, "Ann");
  seedUser("ben", 1000, "Ben");
  seedUser("cat", 1000, "Cat");
  const { leagueId, code } = await call<{ leagueId: string; code: string }>(createLeague, "ann", {
    idempotencyKey: key(),
    name: "Taunts",
    startingLeagueTokens: 1000,
    duration: "1 Month",
    sports: ["NBA"],
    buyIn: 0,
    prizePreset: "winner-all",
    bankLoanEnabled: false,
    bankInterestRate: 10,
    bankInterestIntervalHours: 24,
  });
  await call(joinLeague, "ben", { code });
  await call(joinLeague, "cat", { code });
  await db.doc(`leagues/${leagueId}/matchups/2026-10-05`).set({ pairs: [{ aUid: "ann", bUid: "ben" }, { aUid: "cat", bUid: null }] });

  const base = { scope: "league", leagueId, matchupId: "2026-10-05" };
  await rejects(call(sendTaunt, "ann", { ...base, receiverUid: "ben", moveId: "moonwalk" }), /don't own/);
  await rejects(call(sendTaunt, "ann", { ...base, receiverUid: "cat", moveId: "cheer" }), /matchup opponent/);
  await call(sendTaunt, "ann", { ...base, receiverUid: "ben", moveId: "cheer" });
  const msgs = db.list(`leagues/${leagueId}/messages/`).filter((m) => m.data.kind === "taunt");
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]!.data.moveId, "cheer");
  await rejects(call(sendTaunt, "ann", { ...base, receiverUid: "ben", moveId: "fist_pump" }), /One taunt/);

  await call(setMuteTaunts, "ann", { mute: true });
  await rejects(call(sendTaunt, "ben", { ...base, receiverUid: "ann", moveId: "cheer" }), /muted/);
});

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_ELO,
  blendedRating,
  eloUpdate,
  homeWinProbability,
  modelConfidence,
  priceFromProbability,
  recordRating,
} from "../src/lib/oddsModel";
import { modelPrices, withModelPrices, applyResultToRatings } from "../src/lib/ratings";
import { db, seedGame } from "./helpers";

test("record prior: better record rates higher, small samples shrink toward average", () => {
  const good = recordRating("NFL", { record: "9-2" })!;
  const bad = recordRating("NFL", { record: "2-9" })!;
  assert.ok(good.rating > BASE_ELO && bad.rating < BASE_ELO);
  const early = recordRating("NFL", { record: "1-0" })!;
  assert.ok(Math.abs(early.rating - BASE_ELO) < Math.abs(good.rating - BASE_ELO));
  assert.equal(recordRating("NFL", { record: null }), null);
  // Points for/against pull a lucky record back.
  const lucky = recordRating("NBA", { record: "10-0", pointsFor: 100, pointsAgainst: 104 })!;
  const real = recordRating("NBA", { record: "10-0", pointsFor: 115, pointsAgainst: 100 })!;
  assert.ok(real.rating > lucky.rating);
});

test("probability and prices: home edge, neutral sites, margin, bounds", () => {
  const even = homeWinProbability("NBA", 1500, 1500);
  assert.ok(even > 0.55 && even < 0.65);
  assert.equal(homeWinProbability("NBA", 1500, 1500, true), 0.5);
  const p = priceFromProbability(0.5);
  assert.equal(p.home, p.away);
  assert.ok(1 / p.home + 1 / p.away > 1.05); // house margin
  const lopsided = priceFromProbability(0.99);
  assert.ok(lopsided.home >= 1.15 && lopsided.away <= 6);
});

test("Elo: winner gains what the loser loses; upsets move more; blowouts more than squeakers", () => {
  const a = eloUpdate("NFL", 1500, 1500, 24, 21);
  assert.ok(a.home > 1500 && a.away < 1500);
  assert.ok(Math.abs(a.home - 1500 - (1500 - a.away)) < 1e-9);
  const upset = eloUpdate("NFL", 1400, 1600, 24, 21);
  assert.ok(upset.delta > a.delta);
  const blowout = eloUpdate("NFL", 1500, 1500, 45, 3);
  assert.ok(blowout.delta > a.delta);
  const draw = eloUpdate("Soccer", 1500, 1500, 1, 1);
  assert.ok(draw.delta < 0); // home was expected to win
});

test("blend: record prior early, Elo once there's enough of it; confidence grows with games", () => {
  const rec = { record: "8-2" };
  const prior = recordRating("NFL", rec)!.rating;
  assert.equal(blendedRating("NFL", null, rec), prior);
  assert.equal(blendedRating("NFL", { elo: 1400, games: 20, updatedAt: 0 }, rec), 1400);
  const half = blendedRating("NFL", { elo: 1400, games: 4, updatedAt: 0 }, rec);
  assert.ok(half > 1400 && half < prior);
  assert.equal(modelConfidence("NFL", 0, 0), "low");
  assert.equal(modelConfidence("NFL", 10, 12), "high");
});

test("unpriced games get the shared model line; book lines are left alone; results update ratings once", async () => {
  const base = (id: string, priced: boolean) => ({
    id,
    sport: "NFL",
    status: "upcoming",
    startsAt: Date.now() + 86_400_000,
    priced,
    disrupted: null,
    neutralSite: false,
    oddsProvider: priced ? "ESPN BET" : null,
    homeTeam: { name: "Chiefs", abbreviation: "KC", color: "#E31837", odds: priced ? 1.5 : null, record: "9-2" },
    awayTeam: { name: "Jets", abbreviation: "NYJ", color: "#125740", odds: priced ? 2.6 : null, record: "2-9" },
  });
  const out = await withModelPrices([base("NFL:1", false), base("NFL:2", true)] as never);
  const model = out[0] as unknown as { priced: boolean; oddsSource: string; homeTeam: { odds: number }; awayTeam: { odds: number } };
  assert.equal(model.priced, true);
  assert.equal(model.oddsSource, "model");
  assert.ok(model.homeTeam.odds < model.awayTeam.odds);
  const book = out[1] as unknown as { oddsSource: string; homeTeam: { odds: number } };
  assert.equal(book.oddsSource, "book");
  assert.equal(book.homeTeam.odds, 1.5);

  const pBefore = (await modelPrices([base("NFL:3", false)] as never)).get("NFL:3")!.pHome;
  seedGame("NFL:9", {
    sport: "NFL",
    status: "final",
    homeScore: 10,
    awayScore: 31,
    homeTeam: { name: "Chiefs", abbreviation: "KC", color: "#E31837", odds: 1.5, record: "9-2" },
    awayTeam: { name: "Jets", abbreviation: "NYJ", color: "#125740", odds: 2.6, record: "2-9" },
  });
  assert.equal(await applyResultToRatings("NFL:9"), true);
  assert.equal(await applyResultToRatings("NFL:9"), false);
  const teams = (db.read("ratings/NFL") as { teams: Record<string, { elo: number; games: number }> }).teams;
  assert.equal(teams.KC!.games, 1);
  assert.ok(teams.NYJ!.elo > recordRating("NFL", { record: "2-9" })!.rating);

  // The upset lowers KC's chances in the next model price.
  const pAfter = (await modelPrices([base("NFL:3", false)] as never)).get("NFL:3")!.pHome;
  assert.ok(pAfter < pBefore);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSummary, periodLabel, ttlFor } from "../src/lib/gameInsights";

const header = (state: "pre" | "in" | "post", name: string, extra: Record<string, unknown> = {}) => ({
  competitions: [
    {
      date: "2026-10-27T23:00Z",
      status: { type: { name, state, detail: "detail" } },
      competitors: [
        { homeAway: "home", id: "12", team: { id: "12", abbreviation: "KC" }, linescores: [{ displayValue: "7" }, { displayValue: "3" }], ...extra },
        { homeAway: "away", id: "2", team: { id: "2", abbreviation: "BUF" }, linescores: [{ displayValue: "0" }, { displayValue: "14" }] },
      ],
    },
  ],
});

test("live NFL: linescore, scoring newest-first, win probability, game leaders", () => {
  const out = normalizeSummary(
    {
      header: header("in", "STATUS_IN_PROGRESS"),
      scoringPlays: [
        { id: "a", text: "TD pass", type: { text: "Passing Touchdown" }, period: { number: 1 }, clock: { displayValue: "4:12" }, team: { id: "12" }, homeScore: 7, awayScore: 0 },
        { id: "b", text: "Rush TD", period: { number: 2 }, clock: { displayValue: "0:30" }, team: { abbreviation: "BUF" }, homeScore: 10, awayScore: 14 },
      ],
      winprobability: [{ homeWinPercentage: 0.6 }, { homeWinPercentage: 0.41, tiePercentage: 0 }],
      leaders: [
        { team: { id: "12" }, leaders: [{ displayName: "Passing Yards", leaders: [{ displayValue: "212 YDS", athlete: { shortName: "P. Mahomes", position: { abbreviation: "QB" } } }] }] },
      ],
      boxscore: {
        teams: [
          { team: { id: "12" }, statistics: [{ label: "1st Downs", displayValue: "12" }, { label: "Only home", displayValue: "1" }] },
          { team: { id: "2" }, statistics: [{ label: "1st Downs", displayValue: "15" }] },
        ],
      },
    },
    { gameId: "NFL:1", sport: "NFL", now: 5 }
  );
  assert.equal(out.status, "live");
  assert.deepEqual(out.linescore, { periods: ["Q1", "Q2"], home: [7, 3], away: [0, 14] });
  assert.deepEqual(out.scoring.map((s) => [s.id, s.side, s.periodLabel]), [["b", "away", "Q2"], ["a", "home", "Q1"]]);
  assert.deepEqual(out.winProbability, { home: 0.41, tie: 0 });
  assert.equal(out.leaders.scope, "game");
  assert.equal(out.leaders.home[0]?.athlete, "P. Mahomes");
  assert.deepEqual(out.teamStats, [{ label: "1st Downs", home: "12", away: "15" }]);
});

test("upcoming: form, head-to-head before kickoff only, injuries ordered, predictor normalised, no undefined", () => {
  const out = normalizeSummary(
    {
      header: header("pre", "STATUS_SCHEDULED"),
      predictor: { homeTeam: { gameProjection: "60" }, awayTeam: { gameProjection: "40" } },
      lastFiveGames: [
        {
          team: { id: "12", abbreviation: "KC" },
          events: [
            { gameDate: "2026-10-12T00:00Z", homeTeamId: "12", homeTeamScore: "21", awayTeamScore: "17", gameResult: "W", opponent: { abbreviation: "DEN" } },
            { gameDate: "2026-10-19T00:00Z", homeTeamId: "9", homeTeamScore: "30", awayTeamScore: "10", gameResult: "L", opponent: { abbreviation: "LV" }, atVs: "@" },
          ],
        },
      ],
      headToHeadGames: [
        {
          team: { id: "12", abbreviation: "KC" },
          events: [
            { gameDate: "2025-12-01T00:00Z", homeTeamId: "2", homeTeamScore: 20, awayTeamScore: 24, gameResult: "W", opponent: { abbreviation: "BUF" } },
            { gameDate: "2026-10-27T23:00Z", homeTeamId: "12", homeTeamScore: 0, awayTeamScore: 0, gameResult: "", opponent: { abbreviation: "BUF" } },
          ],
        },
      ],
      injuries: [
        { team: { id: "2" }, injuries: [{ status: "Questionable", athlete: { displayName: "A" } }, { status: "Out", athlete: { displayName: "B" }, details: { type: "Knee" } }] },
      ],
    },
    { gameId: "NFL:2", sport: "NFL", now: 5 }
  );
  assert.equal(out.status, "upcoming");
  assert.equal(out.linescore, null);
  assert.deepEqual(out.scoring, []);
  assert.deepEqual(out.predictor, { home: 0.6, away: 0.4 });
  assert.deepEqual(out.recent.home.map((g) => [g.opponent, g.result, g.score, g.venue]), [["LV", "L", "10-30", "away"], ["DEN", "W", "21-17", "home"]]);
  assert.equal(out.headToHead.games.length, 1);
  assert.deepEqual(out.headToHead.games[0], { date: Date.parse("2025-12-01T00:00Z"), homeAbbr: "BUF", awayAbbr: "KC", homeScore: 20, awayScore: 24, winnerAbbr: "KC" });
  assert.deepEqual(out.injuries.away.map((i) => [i.athlete, i.status, i.detail]), [["B", "Out", "Knee"], ["A", "Questionable", null]]);
  assert.equal(out.leaders.scope, "season");
  assert.ok(!JSON.stringify(out, (_k, v) => (v === undefined ? "__undef__" : v)).includes("__undef__"));
});

test("soccer: key events get a running score; empty payload never throws", () => {
  const out = normalizeSummary(
    {
      header: header("post", "STATUS_FULL_TIME"),
      keyEvents: [
        { id: "1", type: { text: "Goal" }, scoringPlay: true, team: { id: "12" }, clock: { displayValue: "12'" }, period: { number: 1 } },
        { id: "2", type: { text: "Yellow Card" }, team: { id: "2" } },
        { id: "3", type: { text: "Goal - Header" }, scoringPlay: true, team: { id: "2" }, period: { number: 2 } },
        { id: "4", type: { text: "Substitution" }, team: { id: "2" } },
      ],
    },
    { gameId: "Soccer:3", sport: "Soccer", now: 5 }
  );
  assert.equal(out.status, "final");
  assert.deepEqual(out.scoring.map((s) => [s.id, s.homeScore, s.awayScore]), [["3", 1, 1], ["2", 1, 0], ["1", 1, 0]]);
  assert.doesNotThrow(() => normalizeSummary({}, { gameId: "NBA:1", sport: "NBA", now: 1 }));
  assert.doesNotThrow(() => normalizeSummary(null, { gameId: "NBA:1", sport: "NBA", now: 1 }));
});

test("period labels and cache TTLs", () => {
  assert.equal(periodLabel("NBA", 5), "OT");
  assert.equal(periodLabel("NCAAB", 2), "2H");
  assert.equal(periodLabel("NHL", 5), "SO");
  assert.equal(periodLabel("MLB", 11), "11");
  assert.equal(ttlFor("live", 0, 0), 20_000);
  assert.equal(ttlFor("upcoming", 3_600_000, 0), 5 * 60_000);
  assert.equal(ttlFor("upcoming", 10 * 3_600_000, 0), 30 * 60_000);
});

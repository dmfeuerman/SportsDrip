import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endsAtFor, SEASONS, seasonEndFor, sportSeasonEnd } from "../src/lib/leagueConfig";
import { isPeriodStart, matchupPeriodKey } from "../src/lib/weekly";

const day = (s: string) => new Date(s).toISOString().slice(0, 10);

test("full season: a sport over half done counts from its next season", () => {
  const april = Date.parse("2026-04-15T12:00:00Z");
  assert.equal(day(new Date(sportSeasonEnd("MLB", april).end).toISOString()), "2026-11-04");
  // NBA is in its last two months: the league follows the 2026–27 season.
  assert.equal(day(new Date(sportSeasonEnd("NBA", april).end).toISOString()), "2027-06-22");
  assert.equal(day(new Date(seasonEndFor(["MLB", "NBA"], april)).toISOString()), "2027-06-22");
});

test("full season: an in-progress season with most of it left is used as is", () => {
  const oct = Date.parse("2026-10-31T12:00:00Z");
  assert.equal(day(new Date(seasonEndFor(["NFL"], oct)).toISOString()), "2027-02-10");
  assert.equal(endsAtFor("1 Month", ["NFL"], oct), oct + 28 * 86_400_000);
});

test("client and server agree on season windows", () => {
  const client = readFileSync(join(process.cwd(), "..", "artifacts", "mobile", "constants", "seasons.ts"), "utf8");
  for (const [sport, w] of Object.entries(SEASONS)) {
    assert.ok(
      client.includes(`${sport}: { start: [${w.start.join(", ")}], end: [${w.end.join(", ")}], finale: "${w.finale}" }`),
      `${sport} season differs in artifacts/mobile/constants/seasons.ts`
    );
  }
});

test("matchup periods: weekly, twice-weekly and daily keys and start days", () => {
  const thu = Date.parse("2026-10-29T14:00:00Z"); // Thursday, New York
  const mon = Date.parse("2026-10-26T14:00:00Z");
  assert.equal(matchupPeriodKey("weekly", thu), "2026-10-26");
  assert.equal(matchupPeriodKey("twice-weekly", mon), "2026-10-26-a");
  assert.equal(matchupPeriodKey("twice-weekly", thu), "2026-10-26-b");
  assert.equal(matchupPeriodKey("daily", thu), "2026-10-29");
  assert.equal(isPeriodStart("weekly", thu), false);
  assert.equal(isPeriodStart("weekly", mon), true);
  assert.equal(isPeriodStart("twice-weekly", thu), true);
  assert.equal(isPeriodStart("daily", thu), true);
});

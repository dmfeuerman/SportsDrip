/**
 * Guards for the work that moved from Cloud Functions to the phone: the
 * insights parser the app runs must be the server's, the league paths must
 * match, and the team-info helpers behind the crests are pure and tested here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providerPathsFor, toStatus, type Sport } from "../src/lib/sportsProvider";
import { crestStyle, formRecord, nickname, pickTrim, splitOnly, streakOf, winPct } from "../../artifacts/mobile/lib/teamIdentity";

const root = process.cwd();
const mobile = (...p: string[]) => readFileSync(join(root, "..", "artifacts", "mobile", ...p), "utf8");

test("on-device insights parser is the server parser", () => {
  const server = readFileSync(join(root, "src", "lib", "gameInsights.ts"), "utf8").replace('from "./sportsProvider";', 'from "./provider";');
  assert.equal(mobile("lib", "insights", "espnSummary.ts"), server, "artifacts/mobile/lib/insights/espnSummary.ts has drifted from functions/src/lib/gameInsights.ts");
});

test("on-device provider paths and statuses match the server", () => {
  const src = mobile("lib", "insights", "provider.ts");
  const client = new Map<string, string[]>();
  for (const m of src.matchAll(/\["(\w+)", "([^"]+)"\]/g)) client.set(m[1]!, [...(client.get(m[1]!) ?? []), m[2]!]);
  for (const sport of ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"] as Sport[]) {
    assert.deepEqual(client.get(sport), providerPathsFor(sport), `${sport} paths`);
  }
  for (const name of ["STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_FIRST_HALF", "STATUS_SECOND_HALF", "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FINAL_PEN"]) {
    assert.ok(src.includes(`"${name}"`), `${name} handled on device`);
    assert.notEqual(toStatus(name), "upcoming");
  }
});

test("streakOf reads the current run, newest first", () => {
  assert.deepEqual(streakOf(["W", "W", "L", "W"]), { kind: "W", count: 2 });
  assert.deepEqual(streakOf(["L", "L", "L"]), { kind: "L", count: 3 });
  assert.deepEqual(streakOf(["D", "W"]), { kind: "D", count: 1 });
  assert.equal(streakOf([]), null);
  assert.equal(streakOf(null), null);
});

test("records and splits parse", () => {
  assert.equal(formRecord(["W", "W", "L", "W", "L"]), "3-2");
  assert.equal(formRecord(["W", "D", "L"]), "1-1-1");
  assert.equal(formRecord(null), null);
  assert.equal(winPct("9-3"), 0.75);
  assert.equal(winPct("1-1-2"), 0.5);
  assert.equal(winPct("0-0"), null);
  assert.equal(winPct("n/a"), null);
  assert.equal(splitOnly("5-1 Home"), "5-1");
  assert.equal(splitOnly(null), null);
  assert.equal(nickname("Detroit Lions", "Detroit"), "Lions");
  assert.equal(nickname("LAFC", "LAFC"), "LAFC");
});

test("crests are stable per team and trims stay readable", () => {
  assert.deepEqual(crestStyle("DET", "NFL"), crestStyle("det", "NFL"));
  const shapes = new Set(["DET", "KC", "GB", "DAL", "SF", "BUF", "PHI", "MIA"].map((a) => crestStyle(a, "NFL").shape));
  assert.ok(shapes.size >= 3, "teams spread across silhouettes");
  assert.equal(pickTrim("#0076B6", "#0077B7", null), "#FFFFFF", "a near-identical alternate is rejected");
  assert.equal(pickTrim("#0076B6", null, "#B0B7BC"), "#B0B7BC");
  assert.equal(pickTrim("#FFB612"), "#0B1220", "light base falls back to dark trim");
});

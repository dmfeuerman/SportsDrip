import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSeason, type SeasonDef } from "../src/lib/seasonPass";

const base: SeasonDef = {
  id: "s1",
  startsAt: 1,
  endsAt: 2,
  tiers: [
    { xp: 10, reward: { kind: "credits", amount: 100 } },
    { xp: 20, reward: { kind: "item", id: "hat" } },
  ],
};

test("season config: a pass can never pay for the next pass", () => {
  validateSeason(base);
  validateSeason({ ...base, premium: { price: 1000, tiers: [{ xp: 15, reward: { kind: "credits", amount: 899 } }] } });
  assert.throws(
    () => validateSeason({ ...base, premium: { price: 1000, tiers: [{ xp: 15, reward: { kind: "credits", amount: 900 } }] } }),
    /buys the next/
  );
  assert.throws(() => validateSeason({ ...base, tiers: [base.tiers[1]!, base.tiers[0]!] }), /strictly increase/);
});

test("every checked-in season config passes the validator", () => {
  const cfg = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "config", "seasons.placeholder.json"), "utf8")) as { seasons: SeasonDef[] };
  for (const s of cfg.seasons) validateSeason(s);
});

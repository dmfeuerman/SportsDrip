import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { balance, call, clock, db, ledger, notifications, rejects, seedUser } from "./helpers";
import { BIRTHDAY_GIFT, nyMonthYear, sendBirthdayGifts } from "../src/scheduled/birthdays";
import { createProfile } from "../src/callable/profile";
import { blockUser, unblockUser } from "../src/callable/account";
import { isObjectionable, maskObjectionable } from "../src/lib/moderation";

beforeEach(() => {
  db.reset();
  clock.set(Date.UTC(2026, 2, 1, 14)); // Mar 1, 09:00 ET
});

test("signup: age 18+, birth month and terms are required; the birthday index is written", async () => {
  await rejects(call(createProfile, "kid", { username: "kid_1", displayName: "Kid", age: 16, birthMonth: 3, acceptedTerms: true }), /18 or older/);
  await rejects(call(createProfile, "nt", { username: "nt_1", displayName: "Nt", age: 30, birthMonth: 3 }), /Terms|Required|true/);
  await call(createProfile, "ann", { username: "ann_1", displayName: "Ann", age: 30, birthMonth: 3, acceptedTerms: true });
  assert.deepEqual(db.read("birthdays/ann"), { uid: "ann", month: 3, lastGiftYear: 0 });
  assert.equal(db.read("users/ann")!.birthMonth, undefined, "never on the public profile");
  assert.equal(db.read("users/ann")!.termsVersion, 1);
});

test("birthday gift: 500 credits on the 1st of the birth month, once per year", async () => {
  assert.deepEqual(nyMonthYear(clock.get()), { month: 3, year: 2026 });
  seedUser("mar", 100);
  seedUser("apr", 100);
  db.seed("birthdays/mar", { uid: "mar", month: 3, lastGiftYear: 0 });
  db.seed("birthdays/apr", { uid: "apr", month: 4, lastGiftYear: 0 });
  db.seed("birthdays/gone", { uid: "gone", month: 3, lastGiftYear: 0 });

  assert.equal(await sendBirthdayGifts(clock.get()), 1);
  assert.equal(balance("mar"), 100 + BIRTHDAY_GIFT);
  assert.equal(balance("apr"), 100);
  assert.equal(ledger("mar").filter((l) => l.type === "birthday_gift").length, 1);
  assert.equal(notifications("mar")[0]!.type, "birthday_gift");
  assert.equal(db.read("birthdays/gone"), undefined, "deleted accounts are cleaned up");

  // A rerun the same month pays nothing.
  assert.equal(await sendBirthdayGifts(clock.get()), 0);
  assert.equal(balance("mar"), 100 + BIRTHDAY_GIFT);

  // Next year pays again.
  clock.set(Date.UTC(2027, 2, 1, 14));
  assert.equal(await sendBirthdayGifts(clock.get()), 1);
  assert.equal(balance("mar"), 100 + 2 * BIRTHDAY_GIFT);
});

test("block: unfriends both ways and can be undone", async () => {
  seedUser("a");
  seedUser("b");
  db.seed("friendships/a_b", { users: ["a", "b"] });
  await call(blockUser, "a", { otherUid: "b" });
  assert.ok(db.read("users/a/blocks/b"));
  assert.equal(db.read("friendships/a_b"), undefined);
  await call(unblockUser, "a", { otherUid: "b" });
  assert.equal(db.read("users/a/blocks/b"), undefined);
});

test("moderation: catches slurs and leetspeak, leaves ordinary words alone", () => {
  assert.ok(isObjectionable("you f4gg0t"));
  assert.ok(isObjectionable("kys"));
  assert.ok(!isObjectionable("Scunthorpe class assassin cocktail"));
  assert.equal(maskObjectionable("what a cunt lol"), "what a **** lol");
});

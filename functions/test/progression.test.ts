import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { balance, call, db, key, ledger, notifications, rejects, seedUser } from "./helpers";
import {
  levelFromXp,
  levelUpCredits,
  MAX_LEVEL,
  progressOf,
  REFERRAL,
  totalXpForLevel,
  XP,
  xpForLedger,
  xpForNext,
} from "../src/lib/progression";
import { grantXp } from "../src/lib/xp";
import { purchaseItem } from "../src/callable/shop";
import { purchaseBackground, setBackground } from "../src/callable/backgrounds";
import { checkReferralCode, getReferralCode, syncProgression } from "../src/callable/referrals";
import { createProfile } from "../src/callable/profile";
import * as clientBg from "../../artifacts/mobile/constants/backgrounds";

const ROOT = join(__dirname, "..", "..", "..", "..");
const esm = new Function("p", "return import(p)") as (p: string) => Promise<any>;

beforeEach(() => {
  db.reset();
  db.seed("catalog/hat_rookie_cap", { name: "Rookie Cap", slot: "hat", price: 0, levelReward: 3, available: true });
  db.seed("catalog/top_level_up_tee", { name: "Level Up Tee", slot: "top", price: 0, levelReward: 7, available: true });
  db.seed("catalog/shoes_pro_highs", { name: "Pro Hightops", slot: "shoes", price: 7800, levelRequired: 5, available: true });
  db.seed("catalog/hat_plain", { name: "Plain Cap", slot: "hat", price: 900, available: true });
  db.seed("backgrounds/night_stadium", { name: "Night Game", price: 1200, available: true, levelRequired: null, levelReward: null });
  db.seed("backgrounds/neon_city", { name: "Neon City", price: 7500, available: true, levelRequired: 4, levelReward: null });
  db.seed("backgrounds/confetti_podium", { name: "Podium", price: 9000, available: true, levelRequired: null, levelReward: 5 });
});

const owns = (uid: string, path: string) => !!db.read(`users/${uid}/${path}`);

test("the level curve is monotonic, round-trips, and caps at MAX_LEVEL", () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(-5), 1);
  assert.equal(levelFromXp(undefined), 1);
  assert.equal(xpForNext(1), 250);
  for (let l = 1; l <= MAX_LEVEL; l++) {
    assert.equal(levelFromXp(totalXpForLevel(l)), l);
    if (l > 1) assert.equal(levelFromXp(totalXpForLevel(l) - 1), l - 1);
    if (l < MAX_LEVEL) assert.equal(totalXpForLevel(l + 1) - totalXpForLevel(l), xpForNext(l));
  }
  assert.equal(levelFromXp(10_000_000), MAX_LEVEL);
  const p = progressOf(totalXpForLevel(4) + 100);
  assert.equal(p.level, 4);
  assert.equal(p.into, 100);
  assert.equal(p.needed, xpForNext(4));
  assert.ok(progressOf(10_000_000).maxed);
});

test("ledger XP: wins, buys and boxes earn; stakes, refunds and level rewards don't", () => {
  assert.equal(xpForLedger("bet_payout", 1910, 1000), XP.betWin + 9);
  assert.equal(xpForLedger("bet_payout", 100_000, 1000), XP.betWin + XP.betWinBonusCap);
  assert.equal(xpForLedger("purchase", -1500), 30);
  assert.equal(xpForLedger("purchase", -100), XP.purchaseMin);
  assert.equal(xpForLedger("purchase", -1_000_000), XP.purchaseMax);
  assert.equal(xpForLedger("prize_box", 50), XP.prizeBox);
  for (const t of ["bet_stake", "bet_refund", "level_reward", "referral_bonus", "signup_grant", "challenge_refund"]) {
    assert.equal(xpForLedger(t, 500), 0, t);
  }
});

test("grantXp is idempotent per key, pays level credits once, and grants level rewards", async () => {
  seedUser("amy", 1000);
  const toFive = totalXpForLevel(5);
  const r1 = await grantXp("amy", toFive, "k1", "test");
  assert.equal(r1.applied, true);
  assert.equal(r1.level, 5);
  assert.equal(r1.levelsGained, 4);
  const credits = [2, 3, 4, 5].reduce((s, l) => s + levelUpCredits(l), 0);
  assert.equal(r1.credits, credits);
  assert.equal(balance("amy"), 1000 + credits);
  assert.equal(db.read("users/amy")!.level, 5);
  assert.ok(owns("amy", "inventory/hat_rookie_cap"), "level 3 item");
  assert.ok(!owns("amy", "inventory/top_level_up_tee"), "level 7 item not yet");
  assert.ok(owns("amy", "backgrounds/confetti_podium"), "level 5 background");
  assert.equal(ledger("amy").filter((l) => l.type === "level_reward").length, 4);
  const n = notifications("amy").find((x) => x.type === "level_up")!;
  assert.equal(n.title, "Level 5 reached");

  const replay = await grantXp("amy", toFive, "k1", "test");
  assert.equal(replay.applied, false);
  assert.equal(db.read("users/amy")!.xp, toFive);
  assert.equal(balance("amy"), 1000 + credits);
});

test("level-exclusive items can't be bought; level-gated ones need the level", async () => {
  seedUser("bo", 50_000);
  await rejects(call(purchaseItem, "bo", { itemId: "hat_rookie_cap", idempotencyKey: key() }), /unlocked by reaching level 3/);
  await rejects(call(purchaseItem, "bo", { itemId: "shoes_pro_highs", idempotencyKey: key() }), /Reach level 5/);
  await grantXp("bo", totalXpForLevel(5), "k", "test");
  await call(purchaseItem, "bo", { itemId: "shoes_pro_highs", idempotencyKey: key() });
  assert.ok(owns("bo", "inventory/shoes_pro_highs"));
  await call(purchaseItem, "bo", { itemId: "hat_plain", idempotencyKey: key() });
});

test("backgrounds: buy, auto-select, level gates, and only owned ones can be set", async () => {
  seedUser("cy", 20_000);
  const r = await call<{ balance: number }>(purchaseBackground, "cy", { backgroundId: "night_stadium", idempotencyKey: key() });
  assert.equal(r.balance, 18_800);
  assert.equal(db.read("users/cy")!.background, "night_stadium");
  await rejects(call(purchaseBackground, "cy", { backgroundId: "night_stadium", idempotencyKey: key() }), /already own/);
  await rejects(call(purchaseBackground, "cy", { backgroundId: "neon_city", idempotencyKey: key() }), /Reach level 4/);
  await rejects(call(setBackground, "cy", { backgroundId: "confetti_podium" }), /don't own/);
  await call(setBackground, "cy", { backgroundId: null });
  assert.equal(db.read("users/cy")!.background, "locker_room");
});

test("invite codes: both players get credits, become friends, and a code can't be reused by its owner", async () => {
  seedUser("ref", 1000, "Ref");
  const { code } = await call<{ code: string }>(getReferralCode, "ref", {});
  assert.match(code, /^[A-Z2-9]{6}$/);
  const again = await call<{ code: string }>(getReferralCode, "ref", {});
  assert.equal(again.code, code);

  const check = await call<{ valid: boolean; displayName?: string }>(checkReferralCode, "newbie", { code: code.toLowerCase() });
  assert.equal(check.valid, true);
  assert.equal(check.displayName, "Ref");
  assert.equal((await call<{ valid: boolean }>(checkReferralCode, "ref", { code })).valid, false);

  await rejects(call(createProfile, "nope", { username: "nope_1", displayName: "Nope", age: 25, birthMonth: 3, acceptedTerms: true, referralCode: "ZZZZZZ" }), /isn't valid/);
  assert.equal(db.read("users/nope"), undefined);

  const res = await call<{ referred: boolean }>(createProfile, "newbie", { username: "newbie_1", displayName: "Newbie", age: 25, birthMonth: 3, acceptedTerms: true, referralCode: code });
  assert.equal(res.referred, true);
  assert.equal(balance("newbie"), 1000 + REFERRAL.newUserCredits);
  assert.equal(balance("ref"), 1000 + REFERRAL.referrerCredits + levelUpCredits(2));
  assert.equal(db.read("users/newbie")!.referredBy, "ref");
  assert.equal(db.read("users/ref")!.referralCount, 1);
  assert.ok(db.read("friendships/newbie_ref"));
  assert.ok(notifications("ref").some((n) => n.type === "referral_bonus"));
  assert.equal(db.read("users/ref")!.xp, XP.referrer);
  assert.equal(db.read("users/newbie")!.xp, XP.referred);
  assert.ok(db.read("users/newbie")!.referralCode, "new players get a code of their own");
});

test("syncProgression seeds XP for old accounts without back-paying level credits", async () => {
  seedUser("old", 1000);
  const u = db.read("users/old")!;
  db.seed("users/old", { ...u, stats: { ...(u.stats as object), betsWon: 10, betsPlaced: 30 } });
  const r = await call<{ xp: number; level: number }>(syncProgression, "old", {});
  assert.equal(r.xp, 10 * XP.betWin + 30 * 5);
  assert.equal(r.level, levelFromXp(r.xp));
  assert.equal(balance("old"), 1000);
  assert.ok(db.read("users/old")!.referralCode);
  if (r.level >= 3) assert.ok(owns("old", "inventory/hat_rookie_cap"));
  const again = await call<{ xp: number }>(syncProgression, "old", {});
  assert.equal(again.xp, r.xp);
});

test("app copies of the level curve and background list match the server and seed data", async () => {
  const body = (p: string) => readFileSync(p, "utf8").split(" */\n").slice(1).join(" */\n");
  assert.equal(
    body(join(ROOT, "artifacts", "mobile", "constants", "progression.ts")),
    body(join(ROOT, "functions", "src", "lib", "progression.ts"))
  );
  const { BACKGROUNDS } = await esm(join(ROOT, "scripts", "background-data.mjs"));
  const listed = clientBg.BACKGROUND_LIBRARY.filter((b) => !clientBg.isFreeBackground(b.id));
  assert.deepEqual(
    listed.map((b) => [b.id, b.price, b.rarity, b.levelRequired, b.levelReward]),
    BACKGROUNDS.map((b: any) => [b.id, b.price, b.rarity, b.levelRequired, b.levelReward])
  );
});

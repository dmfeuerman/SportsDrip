import "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { balance, call, clock, db, ledger, seedUser } from "./helpers";
import { resetKeyCache, SsvError, verifySsv } from "../src/lib/admobSsv";
import { claimAdReward, grantAdReward } from "../src/http/adReward";
import { AD_REWARD } from "../src/lib/economy";

const START = Date.UTC(2026, 9, 1, 12);
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KEY_ID = "3335741209";
const fetchKeys = async () => [{ keyId: KEY_ID, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }];

function signedQuery(over: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    ad_network: "5450213213286189855",
    ad_unit: "1234567890",
    custom_data: "credits",
    reward_amount: "1",
    reward_item: "Reward",
    timestamp: String(clock.get()),
    transaction_id: `tx${Math.random().toString(16).slice(2)}`,
    user_id: "alice",
    ...over,
  });
  const message = params.toString();
  const signature = sign("sha256", Buffer.from(message), privateKey).toString("base64url");
  return `${message}&signature=${signature}&key_id=${KEY_ID}`;
}

async function grant(query: string) {
  return grantAdReward(await verifySsv(query, { fetchKeys }));
}

beforeEach(() => {
  db.reset();
  clock.set(START);
  resetKeyCache();
});

test("a verified callback credits once, and a retried callback is a no-op", async () => {
  seedUser("alice", 1000);
  const q = signedQuery({ transaction_id: "abc123" });
  assert.equal(await grant(q), "granted");
  assert.equal(await grant(q), "duplicate");
  assert.equal(balance("alice"), 1000 + AD_REWARD.credits);
  assert.equal(ledger("alice").filter((e) => e.type === "ad_reward").length, 1);
  assert.equal(db.read("users/alice/private/ads")!.count, 1);
});

test("tampering with any signed field is rejected", async () => {
  seedUser("alice", 1000);
  const q = signedQuery().replace("user_id=alice", "user_id=mallory");
  await assert.rejects(verifySsv(q, { fetchKeys }), SsvError);
  await assert.rejects(verifySsv("user_id=alice&transaction_id=x", { fetchKeys }), SsvError);
});

test("the daily cap holds, and resets on the next UTC day", async () => {
  seedUser("alice", 0);
  for (let i = 0; i < AD_REWARD.dailyLimit; i++) assert.equal(await grant(signedQuery()), "granted");
  assert.equal(await grant(signedQuery()), "capped");
  assert.equal(balance("alice"), AD_REWARD.dailyLimit * AD_REWARD.credits);

  clock.advanceHours(24);
  assert.equal(await grant(signedQuery()), "granted");
  assert.equal(db.read("users/alice/private/ads")!.count, 1);
});

test("stale callbacks, unknown users and foreign reward types mint nothing", async () => {
  seedUser("alice", 500);
  const old = signedQuery({ timestamp: String(START - AD_REWARD.maxCallbackAgeMs - 1) });
  assert.equal(await grant(old), "stale");
  assert.equal(await grant(signedQuery({ user_id: "ghost" })), "no_user");
  assert.equal(await grant(signedQuery({ custom_data: "gold_box" })), "unknown_reward");
  assert.equal(balance("alice"), 500);
});

test("the app's claim and the SSV callback for the same view credit once", async () => {
  seedUser("alice", 0);
  const claim = (nonce: string) => call<{ result: string }>(claimAdReward, "alice", { nonce });
  assert.equal((await claim("view_0001")).result, "granted");
  assert.equal(await grant(signedQuery({ custom_data: "credits:view_0001" })), "duplicate");
  assert.equal((await claim("view_0001")).result, "duplicate");
  assert.equal(balance("alice"), AD_REWARD.credits);
  assert.equal(db.read("users/alice/private/ads")!.count, 1);

  clock.advanceHours(1);
  assert.equal(await grant(signedQuery({ custom_data: "credits:view_0002" })), "granted");
  assert.equal((await claim("view_0002")).result, "duplicate");
  assert.equal(db.read("users/alice/private/ads")!.count, 2);
});

test("app claims respect the daily cap and the minimum gap", async () => {
  seedUser("alice", 0);
  const claim = (nonce: string) => call<{ result: string }>(claimAdReward, "alice", { nonce });
  assert.equal((await claim("gap_00001")).result, "granted");
  assert.equal((await claim("gap_00002")).result, "too_soon");
  for (let i = 3; i <= AD_REWARD.dailyLimit + 1; i++) {
    clock.advanceHours(0.01);
    assert.equal((await claim(`gap_0000${i}`)).result, "granted");
  }
  clock.advanceHours(0.01);
  assert.equal((await claim("gap_99999")).result, "capped");
  assert.equal(balance("alice"), AD_REWARD.dailyLimit * AD_REWARD.credits);
  await assert.rejects(claim("x"));
});

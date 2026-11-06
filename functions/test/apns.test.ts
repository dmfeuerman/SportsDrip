import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { activityPayload, providerToken } from "../src/lib/apns";

test("APNs provider token is a verifiable ES256 JWT; payloads stay under 4 KB", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = providerToken(1_700_000_000_000, { key, keyId: "KEY123", teamId: "TEAM45" });
  const [h, c, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h!, "base64url").toString()), { alg: "ES256", kid: "KEY123" });
  assert.equal(JSON.parse(Buffer.from(c!, "base64url").toString()).iss, "TEAM45");
  const v = createVerify("SHA256");
  v.update(`${h}.${c}`);
  assert.ok(v.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url")));

  const p = JSON.parse(activityPayload({ homeScore: 1, awayScore: 2, clock: "Q4 2:00", status: "live" }, "update", 1_700_000_000_000));
  assert.equal(p.aps.event, "update");
  assert.equal(p.aps["content-state"].awayScore, 2);
  assert.throws(() => activityPayload({ homeScore: 1, awayScore: 2, clock: "x".repeat(5000), status: "live" }, "update"), /4 KB/);
});

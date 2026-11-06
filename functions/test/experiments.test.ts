import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignArm, bucket, fnv1a, inHoldout, type ExperimentsDoc } from "../src/lib/experiments";

test("fnv1a matches reference vectors", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("client and server bucketing source stay identical", () => {
  const root = join(__dirname, "..", "..", "..", "..");
  const server = readFileSync(join(root, "functions/src/lib/experiments.ts"), "utf8");
  const client = readFileSync(join(root, "artifacts/mobile/lib/experiments.ts"), "utf8");
  const fn = (src: string, name: string) => {
    const i = src.indexOf(`export function ${name}(`);
    assert.ok(i >= 0, name);
    return src.slice(i, src.indexOf("\n}\n", i));
  };
  for (const name of ["fnv1a", "bucket", "inHoldout"]) assert.equal(fn(client, name), fn(server, name), name);
});

test("assignment is deterministic, unit-aware and respects holdout / inactive", () => {
  const cfg: ExperimentsDoc = {
    globalHoldout: 0,
    experiments: [
      { id: "social", unit: "leagueId", splits: { control: 50, treatment: 50 }, active: true },
      { id: "off", unit: "uid", splits: { treatment: 100 }, active: false },
      { id: "all", unit: "uid", splits: { treatment: 100 }, active: true },
    ],
  };
  // League-unit: every member of one league shares an arm.
  const arms = new Set(["u1", "u2", "u3", "u4"].map((uid) => assignArm(cfg, "social", { uid, leagueId: "L1" })));
  assert.equal(arms.size, 1);
  assert.equal(assignArm(cfg, "social", { uid: "u1" }), "control"); // no league -> control
  assert.equal(assignArm(cfg, "off", { uid: "u1" }), "control");
  assert.equal(assignArm(cfg, "missing", { uid: "u1" }), "control");
  assert.equal(assignArm(cfg, "all", { uid: "u1" }), "treatment");
  assert.equal(assignArm(null, "all", { uid: "u1" }), "control");

  const held = Array.from({ length: 400 }, (_, i) => `user${i}`).filter((u) => inHoldout(u, 5));
  assert.ok(held.length > 5 && held.length < 40, `holdout size ${held.length}`);
  assert.equal(assignArm({ ...cfg, globalHoldout: 5 }, "all", { uid: held[0]! }), "control");
  assert.ok(bucket("x", "y") >= 0 && bucket("x", "y") < 100);
});

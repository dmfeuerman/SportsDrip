import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_QUEUE,
  STALE_POPUP_MS,
  current,
  dismiss,
  dismissAll,
  enqueue,
  prune,
  type QueueItem,
} from "../../artifacts/mobile/lib/notificationQueue";

const n = (id: string, at: number, over: Partial<QueueItem> = {}): QueueItem => ({ id, popup: true, read: false, createdAtMs: at, ...over });
const NOW = 1_000_000_000;

test("results that land together are shown one at a time, oldest first", () => {
  let s = enqueue(EMPTY_QUEUE, [n("c", NOW - 1), n("a", NOW - 3), n("b", NOW - 2)], NOW);
  assert.deepEqual(s.queue, ["a", "b", "c"]);
  assert.equal(current(s), "a");
  s = dismiss(s, "a");
  assert.equal(current(s), "b");
});

test("a replayed snapshot never queues or re-shows the same result", () => {
  let s = enqueue(EMPTY_QUEUE, [n("a", NOW), n("b", NOW)], NOW);
  s = enqueue(s, [n("a", NOW), n("b", NOW)], NOW);
  assert.deepEqual(s.queue, ["a", "b"]);
  s = dismiss(s, "a");
  s = enqueue(s, [n("a", NOW), n("b", NOW), n("c", NOW + 1)], NOW);
  assert.deepEqual(s.queue, ["b", "c"]);
});

test("read, non-popup and stale items are skipped", () => {
  const s = enqueue(
    EMPTY_QUEUE,
    [n("read", NOW, { read: true }), n("feed", NOW, { popup: false }), n("old", NOW - STALE_POPUP_MS - 1), n("ok", NOW)],
    NOW
  );
  assert.deepEqual(s.queue, ["ok"]);
});

test("reading on another device removes it from the queue", () => {
  let s = enqueue(EMPTY_QUEUE, [n("a", NOW), n("b", NOW + 1)], NOW + 1);
  s = prune(s, [n("a", NOW, { read: true }), n("b", NOW + 1)]);
  assert.deepEqual(s.queue, ["b"]);
  s = enqueue(s, [n("a", NOW, { read: false })], NOW + 1);
  assert.deepEqual(s.queue, ["b"], "a pruned item counts as done");
});

test("dismiss all clears the queue and remembers everything", () => {
  let s = enqueue(EMPTY_QUEUE, [n("a", NOW), n("b", NOW)], NOW);
  s = dismissAll(s);
  assert.equal(current(s), null);
  assert.deepEqual(enqueue(s, [n("a", NOW), n("b", NOW)], NOW).queue, []);
});

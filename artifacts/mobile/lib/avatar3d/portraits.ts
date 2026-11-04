/**
 * Small avatars (lists, leaderboards, headers) are still images rendered from
 * the real 3D rig by one offscreen studio, then cached by look. A screen of 40
 * friends costs 40 image views and one WebGL context, not 40 contexts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { AvatarConfig } from "../../types/avatar";
import type { OutfitPiece, ResolvedOutfit } from "./outfit";
import { hash, lookKey } from "./outfit";
import type { Framing } from "./spec";
import { withTimeout } from "../devtrace";

/** Bump when lighting/camera/assets change in a way that should re-render every cached portrait. */
export const RENDER_VERSION = 5;

export type PortraitJob =
  | { kind: "avatar"; key: string; avatar: AvatarConfig; outfit: ResolvedOutfit; framing: Framing }
  | { kind: "item"; key: string; piece: OutfitPiece };

export const avatarJob = (avatar: AvatarConfig, outfit: ResolvedOutfit, framing: Framing): PortraitJob => ({
  kind: "avatar",
  key: `v${RENDER_VERSION}:${lookKey(avatar, outfit, framing)}`,
  avatar,
  outfit,
  framing,
});

export const itemJob = (piece: OutfitPiece): PortraitJob => ({
  kind: "item",
  key: `v${RENDER_VERSION}:item#${hash(`${piece.template ?? piece.url}@${piece.version ?? ""}|${piece.primary}|${piece.secondary ?? ""}`)}`,
  piece,
});

type Worker = (job: PortraitJob) => Promise<string>;

// The store alone is 100+ item icons; with friends' portraits on top, 240
// evicted icons that were still on screen and they re-rendered in a loop.
const MAX = 600;
/** Per-render cap. Asset loads share one native queue with the live stage, so this includes waiting for it. */
const RENDER_TIMEOUT_MS = 45_000;
/** Renders per key before giving up for the session (slot glyph from then on). */
const MAX_ATTEMPTS = 3;
const images = new Map<string, string>(); // insertion order = LRU order
const failed = new Set<string>();
const attempts = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const queue: PortraitJob[] = [];
const queued = new Set<string>();
let worker: Worker | null = null;
let running = false;

const STORE = "sd.avatarPortraits.v1";
const persist = Platform.OS !== "web";
let hydrated: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function hydrate() {
  if (!persist) return Promise.resolve();
  hydrated ??= AsyncStorage.getItem(STORE)
    .then((raw) => {
      if (!raw) return;
      for (const [k, v] of JSON.parse(raw) as [string, string][]) if (!images.has(k)) images.set(k, v);
      // Over a copy: a listener reads the image back (getPortrait), which moves
      // its key to the end of the Map, and a live keys() iterator would visit
      // it again — forever. That loop froze the app at launch on iOS.
      for (const k of [...images.keys()]) emit(k);
    })
    .catch(() => {});
  return hydrated;
}

function save() {
  if (!persist) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORE, JSON.stringify([...images.entries()].slice(-MAX))).catch(() => {});
  }, 800);
}

function emit(key: string) {
  const set = listeners.get(key);
  if (set) for (const fn of [...set]) fn();
}

function remember(key: string, uri: string) {
  images.delete(key);
  images.set(key, uri);
  while (images.size > MAX) images.delete(images.keys().next().value!);
  save();
}

export function getPortrait(key: string): string | undefined {
  const v = images.get(key);
  if (v) {
    images.delete(key);
    images.set(key, v);
  }
  return v;
}

export function portraitFailed(key: string) {
  return failed.has(key);
}

/** An image the OS cleared from its cache: forget it and render again. */
export function invalidatePortrait(job: PortraitJob) {
  images.delete(job.key);
  failed.delete(job.key);
  save();
  requestPortrait(job);
}

export function subscribePortrait(key: string, fn: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(key);
  };
}

export function requestPortrait(job: PortraitJob) {
  if (images.has(job.key) || queued.has(job.key) || failed.has(job.key)) return;
  queued.add(job.key);
  // Newest first: what just scrolled into view matters more than what left it.
  queue.unshift(job);
  void pump();
}

/** Called by the mounted studio. Returns an unregister function. */
export function registerPortraitWorker(w: Worker) {
  worker = w;
  // A new studio gets a fresh shot at anything the last one couldn't draw.
  failed.clear();
  attempts.clear();
  void pump();
  return () => {
    if (worker === w) worker = null;
  };
}

async function pump() {
  await hydrate();
  if (running || !worker) return;
  running = true;
  try {
    while (queue.length && worker) {
      const job = queue.shift()!;
      if (images.has(job.key)) {
        queued.delete(job.key);
        emit(job.key);
        continue;
      }
      const render = worker(job);
      try {
        remember(job.key, await withTimeout(render, RENDER_TIMEOUT_MS, `portrait ${job.key}`));
        attempts.delete(job.key);
      } catch (e) {
        // The worker shares one rig and one GL context across jobs: never start
        // the next render while a timed-out one may still be drawing.
        await Promise.race([render.catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
        const n = (attempts.get(job.key) ?? 0) + 1;
        attempts.set(job.key, n);
        if (n < MAX_ATTEMPTS) {
          // Back of the queue: whatever is on screen now goes first.
          queue.push(job);
          console.warn(`[avatar] portrait render failed (attempt ${n}), retrying`, e);
          await new Promise((r) => setTimeout(r, 250 * n));
          continue;
        }
        failed.add(job.key);
        console.warn("[avatar] portrait render failed", e);
      }
      queued.delete(job.key);
      emit(job.key);
      // Yield so a burst of 30 portraits doesn't freeze scrolling.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}

/** Test hook. */
export function _resetPortraits() {
  images.clear();
  failed.clear();
  attempts.clear();
  queue.length = 0;
  queued.clear();
  worker = null;
  running = false;
}

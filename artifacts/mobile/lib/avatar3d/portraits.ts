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
export const RENDER_VERSION = 4;

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

const MAX = 240;
const images = new Map<string, string>(); // insertion order = LRU order
const failed = new Set<string>();
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
      try {
        remember(job.key, await withTimeout(worker(job), 20000, `portrait ${job.key}`));
      } catch (e) {
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
  queue.length = 0;
  queued.clear();
  worker = null;
  running = false;
}

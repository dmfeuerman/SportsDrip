import { Platform } from "react-native";

/**
 * Turn-taking for creating GL contexts on iOS / Android.
 *
 * expo-gl can deadlock while a context is being set up: the GL thread waits
 * on the main thread (to allocate the view's drawable), the JS thread waits
 * on the GL thread (three.js's blocking setup calls), and the main thread
 * waits on JS (Fabric flushes some view updates synchronously). Launch is
 * when the main thread waits on JS most, and two contexts starting together
 * make it likelier. So: no context until launch has settled, then one at a
 * time, each finishing its setup before the next starts.
 */
const LAUNCH_QUIET_MS = 3500;
const GAP_MS = 300;
/** A turn that never reports back (unmounted mid-setup) is released anyway. */
const TURN_TIMEOUT_MS = 8000;

const NATIVE = Platform.OS !== "web";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let tail: Promise<void> = NATIVE ? sleep(LAUNCH_QUIET_MS) : Promise.resolve();

export interface GlTurn {
  /** Resolves when this caller may create its context. */
  ready: Promise<void>;
  /** Call once the renderer exists (or the caller gave up). Idempotent. */
  done: () => void;
}

export function takeGlTurn(): GlTurn {
  if (!NATIVE) return { ready: Promise.resolve(), done: () => {} };
  let release!: () => void;
  const finished = new Promise<void>((r) => (release = r));
  const ready = tail;
  tail = ready.then(() => Promise.race([finished, sleep(TURN_TIMEOUT_MS)])).then(() => sleep(GAP_MS));
  return { ready, done: release };
}

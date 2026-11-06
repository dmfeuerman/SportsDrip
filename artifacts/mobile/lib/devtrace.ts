/**
 * Dev-only boot and performance trace. Lines are prefixed so a Metro log can
 * be grepped: `[boot]`, `[firestore]`, `[avatar]`, `[perf]`.
 */
const t0 = Date.now();
const DEV = typeof __DEV__ !== "undefined" && __DEV__;

export function trace(tag: string, ...args: unknown[]) {
  // Monitor logs are off. Uncomment to see [boot] / [firestore] / [avatar] / [app] traces in Metro.
  // if (DEV) console.log(`[${tag}] +${Date.now() - t0}ms`, ...args);
  void tag;
  void args;
}

let watching = false;

/** Logs whenever the JS thread was blocked for more than 1.5 s. */
export function startStallWatch() {
  if (!DEV || watching) return;
  watching = true;
  // An inactive app (system alert, Control Center) pauses timers, so a gap
  // next to one of these is not a real stall.
  const { AppState } = require("react-native") as typeof import("react-native");
  AppState.addEventListener("change", (s) => trace("app", s));
  let last = Date.now();
  // Heartbeat for the first minute: if these stop, the JS thread is stuck
  // (a stalled request alone wouldn't stop them).
  // Heartbeat off. Uncomment to log [alive] every 3 s for the first minute.
  // const beat = setInterval(() => {
  //   const up = Date.now() - t0;
  //   console.log(`[alive] +${up}ms`);
  //   if (up > 60_000) clearInterval(beat);
  // }, 3000);
  setInterval(() => {
    const now = Date.now();
    const gap = now - last - 500;
    if (gap > 1500) console.warn(`[perf] JS thread was blocked for ${gap}ms`);
    last = now;
  }, 500);
}

/**
 * A deadline for a listener's first answer, so a stalled connection shows an
 * error instead of a spinner forever. `hit()` on the first snapshot or error.
 */
export function firstAnswer(name: string, onTimeout: () => void, ms = 15000) {
  const start = Date.now();
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    console.warn(`[firestore] ${name}: no response after ${ms / 1000}s`);
    onTimeout();
  }, ms);
  return {
    hit() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      trace("firestore", `${name} answered in ${Date.now() - start}ms`);
    },
    cancel() {
      done = true;
      clearTimeout(timer);
    },
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

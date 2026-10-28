import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Runs `task` every `intervalMs` while the app is in the foreground, and once
 * immediately whenever it comes back to the foreground.
 *
 * This is the safety net under the Firestore listeners. On React Native the
 * listen channel runs over long polling and can stall or die without calling
 * the error callback, and a listener that errored once never re-attaches. A
 * cheap periodic one-shot read means a missed snapshot is late by at most one
 * interval instead of missing until the next cold start.
 *
 * `task` is read through a ref, so callers can pass an inline function without
 * restarting the timer on every render.
 */
export function usePolling(task: () => unknown, intervalMs: number, enabled = true) {
  const ref = useRef(task);
  ref.current = task;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await ref.current();
      } catch {
        // A failed poll is just a skipped tick.
      } finally {
        inFlight = false;
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === "active" || AppState.currentState == null) start();

    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        void run();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs, enabled]);
}

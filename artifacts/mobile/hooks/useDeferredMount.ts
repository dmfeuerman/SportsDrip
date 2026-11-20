import { useEffect, useState, startTransition } from "react";

/**
 * Keeps page transitions and filter taps instantaneous:
 * renders the screen shell (header + backdrop + lightweight glass skeleton)
 * on frame 0 so navigation/button feedback never stalls, then mounts heavy
 * content on the next animation frame inside a non-blocking transition.
 */
export function useDeferredMount(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      startTransition(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

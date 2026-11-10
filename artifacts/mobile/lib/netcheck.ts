import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const PROBE_URL = "https://www.gstatic.com/generate_204";

/** True when a tiny public endpoint answers within the timeout. */
export async function probeOnline(timeoutMs = 6000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${PROBE_URL}?t=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** null until the first probe answers. Re-checks on foreground; polls faster while offline. */
export function useOnline() {
  const [online, setOnline] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aliveRef = useRef(true);

  const run = useCallback(async () => {
    clearTimeout(timer.current);
    const ok = await probeOnline();
    if (!aliveRef.current) return;
    setOnline(ok);
    timer.current = setTimeout(run, ok ? 30_000 : 4_000);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void run();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void run();
    });
    return () => {
      aliveRef.current = false;
      clearTimeout(timer.current);
      sub.remove();
    };
  }, [run]);

  return { online, recheck: run };
}

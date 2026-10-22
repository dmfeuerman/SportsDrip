import { useEffect, useState } from "react";

/**
 * A clock that ticks every `intervalMs`. Loan balances and countdowns are pure
 * functions of time, so screens re-derive them from this instead of anything
 * writing interest on a timer.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

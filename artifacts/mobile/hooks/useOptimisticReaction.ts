import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Outcome = unknown;
/** A send failed when it resolves to an error string or `false`, or throws. */
const failed = (r: Outcome) => typeof r === "string" || r === false;

/**
 * My one emoji reaction on an item, shown the instant it's tapped. The server
 * write runs behind it; the local value yields once the snapshot agrees and
 * rolls back if the write fails. Tapping the same emoji again clears it.
 */
export function useOptimisticReaction(
  reactors: Record<string, string> | undefined,
  uid: string | null | undefined,
  reactions?: Record<string, number>
) {
  const [pending, setPending] = useState<{ v: string | null } | null>(null);
  const serverMine = uid ? reactors?.[uid] ?? null : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pending && serverMine === pending.v) setPending(null);
  }, [serverMine, pending]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const mine = pending ? pending.v : serverMine;

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (reactions && Object.keys(reactions).length) Object.assign(out, reactions);
    else for (const e of Object.values(reactors ?? {})) out[e] = (out[e] ?? 0) + 1;
    if (pending) {
      if (serverMine) out[serverMine] = Math.max(0, (out[serverMine] ?? 1) - 1);
      if (pending.v) out[pending.v] = (out[pending.v] ?? 0) + 1;
    }
    return out;
  }, [reactions, reactors, pending, serverMine]);

  const toggle = useCallback(
    async (emoji: string, send: (emoji: string) => Promise<Outcome> | Outcome) => {
      const next = mine === emoji ? null : emoji;
      setPending({ v: next });
      // Never hold a stale local value forever if the snapshot never lands.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPending(null), 15_000);
      try {
        if (failed(await send(emoji))) setPending(null);
      } catch {
        setPending(null);
      }
    },
    [mine]
  );

  return { mine, counts, toggle };
}

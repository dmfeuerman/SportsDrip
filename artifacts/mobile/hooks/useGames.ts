import { collection, orderBy, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { sharedCached } from "@/lib/cachedQuery";
import type { Game, GameStatus } from "@/types/game";
import { getDb } from "@/lib/firebase";
import { firstAnswer } from "@/lib/devtrace";
import { DEMO, demoGames } from "@/lib/demo";
import { useNow } from "@/hooks/useNow";

const HOUR = 3_600_000;

/**
 * Whether a game still belongs on the board. The server cache only changes
 * when the provider reports a game, so one it stops reporting (postponed, or
 * a sync that wasn't running) can sit at "upcoming" or "live" for weeks.
 * An upcoming game more than 3 hours past its start, or a live one more than
 * 8 hours in, is stale.
 */
export function isCurrent(g: Pick<Game, "status" | "startsAt" | "expired">, now = Date.now()) {
  if (g.expired) return false;
  if (g.status === "upcoming") return g.startsAt > now - 3 * HOUR;
  if (g.status === "live") return g.startsAt > now - 8 * HOUR;
  return true;
}

/**
 * Reads the server-maintained games cache.
 *
 * Replaces the old hook, which had every device polling ESPN directly for five
 * sports every 30 seconds and silently substituting `constants/games.ts` mock
 * data on failure (AUDIT A1, A3). Users could place real-credit bets against
 * fabricated games whose ids would never appear in a settle pass.
 *
 * Now: one Firestore listener. The scheduled `syncGames` function is the only
 * thing that talks to the provider, and it does so once every two minutes for
 * the entire user base. Firestore's offline cache means a cold, disconnected
 * launch still shows the last known board instead of a spinner.
 *
 * There is deliberately no mock fallback. If the board is empty, the UI says so.
 */
const noop = () => () => {};

/**
 * The board, cached on the phone (lib/cachedQuery.ts). Opening the app shows
 * the last board instantly and then reads only games changed since — the
 * server stamps updatedAt on every write and only writes games that changed.
 * Finished or stale games drop out locally.
 */
function gamesStore(statusKey: string) {
  const statuses = statusKey.split(",") as GameStatus[];
  const db = getDb()!;
  return sharedCached<Game & { id: string }>({
    key: `sd.cache.games.${statusKey}`,
    version: 1,
    cursorType: "number",
    fullEveryMs: 12 * HOUR,
    full: () =>
      query(
        collection(db, "games"),
        where("status", "in", statuses),
        // Nothing that started more than a day ago is still upcoming or live.
        where("startsAt", ">=", Date.now() - 24 * HOUR),
        orderBy("startsAt", "asc")
      ),
    delta: (after) => query(collection(db, "games"), where("updatedAt", ">", after)),
    cursorOf: (g) => (typeof g.updatedAt === "number" ? g.updatedAt : null),
    keep: (list) => {
      const now = Date.now();
      return list
        .filter((g) => statuses.includes(g.status) && g.startsAt >= now - 24 * HOUR && isCurrent(g, now))
        .sort((a, b) => a.startsAt - b.startsAt);
    },
  });
}

export function useGames(statuses: GameStatus[] = ["upcoming", "live"]) {
  // Stable dependency — a fresh array literal on every render would resubscribe
  // on every render.
  const statusKey = statuses.join(",");
  const now = useNow(60_000);
  const store = useMemo(() => (DEMO ? null : gamesStore(statusKey)), [statusKey]);
  const snap = useSyncExternalStore(store?.subscribe ?? noop, () => store?.get() ?? null, () => store?.get() ?? null);

  useEffect(() => {
    if (!store) return;
    store.acquire();
    return () => store.release();
  }, [store]);

  // Stalled first load: say so rather than spin forever.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!store || snap?.items) return;
    const answer = firstAnswer("games", () => setTimedOut(true));
    return () => answer.cancel();
  }, [store, snap?.items]);

  const games = useMemo(() => (DEMO ? demoGames : ((snap?.items as Game[] | null) ?? [])), [snap?.items]);
  const loading = !DEMO && !snap?.items && !snap?.error && !timedOut;
  const error = snap?.error?.message ?? (timedOut && !snap?.items ? "Can't reach the server. Check your connection." : null);
  const syncedAt = DEMO ? Date.now() : snap?.syncedAt ?? null;

  const { live, upcoming } = useMemo(
    () => ({
      live: games.filter((g) => g.status === "live" && isCurrent(g, now)),
      upcoming: games.filter((g) => g.status === "upcoming" && isCurrent(g, now)),
    }),
    [games, now]
  );

  return { games, live, upcoming, loading, error, syncedAt };
}

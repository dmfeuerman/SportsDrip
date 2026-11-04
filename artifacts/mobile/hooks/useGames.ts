import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
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
export function useGames(statuses: GameStatus[] = ["upcoming", "live"]) {
  const [games, setGames] = useState<Game[]>(DEMO ? demoGames : []);
  const [loading, setLoading] = useState(!DEMO);
  const [error, setError] = useState<string | null>(null);
  /** When the server last delivered a fresh (non-cache) board. */
  const [syncedAt, setSyncedAt] = useState<number | null>(DEMO ? Date.now() : null);

  // Stable dependency — a fresh array literal on every render would resubscribe
  // on every render.
  const statusKey = statuses.join(",");
  const now = useNow(60_000);
  // Re-subscribe once an hour so the window below moves with the clock.
  const windowHour = Math.floor(now / HOUR);

  useEffect(() => {
    if (DEMO) return;
    const db = getDb();
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    const answer = firstAnswer("games", () => {
      setError("Can't reach the server. Check your connection.");
      setLoading(false);
    });
    const unsub = onSnapshot(
      query(
        collection(db, "games"),
        where("status", "in", statusKey.split(",")),
        // Nothing that started more than a day ago is still upcoming or live: a
        // game the provider stopped reporting would otherwise stay on the board.
        where("startsAt", ">=", (windowHour - 24) * HOUR),
        orderBy("startsAt", "asc")
      ),
      (snap) => {
        answer.hit();
        if (!snap.metadata.fromCache) setSyncedAt(Date.now());
        setGames(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Game));
        setError(null);
        setLoading(false);
      },
      (err) => {
        answer.hit();
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      answer.cancel();
      unsub();
    };
  }, [statusKey, windowHour]);

  const { live, upcoming } = useMemo(
    () => ({
      live: games.filter((g) => g.status === "live" && isCurrent(g, now)),
      upcoming: games.filter((g) => g.status === "upcoming" && isCurrent(g, now)),
    }),
    [games, now]
  );

  return { games, live, upcoming, loading, error, syncedAt };
}

import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import type { Game, GameStatus } from "@/types/game";
import { getDb } from "@/lib/firebase";
import { DEMO, demoGames } from "@/lib/demo";

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

  // Stable dependency — a fresh array literal on every render would resubscribe
  // on every render.
  const statusKey = statuses.join(",");

  useEffect(() => {
    if (DEMO) return;
    const db = getDb();
    if (!db) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }

    const unsub = onSnapshot(
      query(
        collection(db, "games"),
        where("status", "in", statusKey.split(",")),
        orderBy("startsAt", "asc")
      ),
      (snap) => {
        setGames(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Game));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return unsub;
  }, [statusKey]);

  const { live, upcoming } = useMemo(
    () => ({
      live: games.filter((g) => g.status === "live"),
      upcoming: games.filter((g) => g.status === "upcoming"),
    }),
    [games]
  );

  return { games, live, upcoming, loading, error };
}

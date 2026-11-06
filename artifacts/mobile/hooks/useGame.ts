import { doc, getDoc, onSnapshot, type DocumentSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { DEMO, demoGames } from "@/lib/demo";
import { usePolling } from "@/hooks/usePolling";
import type { Game } from "@/types/game";

/**
 * One game document, live.
 *
 * The board only subscribes to upcoming and live games from the last day, so
 * a bet on a game that just went final (or one opened from a notification)
 * isn't in it. This reads games/{id} directly: one listener, and a 30-second
 * one-shot read while the game is live in case the RN listen channel stalls.
 */
export function useGame(gameId: string | null) {
  const [game, setGame] = useState<Game | null>(() => (DEMO && gameId ? demoGames.find((g) => g.id === gameId) ?? null : null));
  const [loading, setLoading] = useState(!DEMO && !!gameId);
  const [missing, setMissing] = useState(false);

  const apply = (snap: DocumentSnapshot) => {
    if (!snap.exists()) {
      setGame(null);
      setMissing(true);
      return;
    }
    const next = { id: snap.id, ...snap.data() } as Game;
    setGame((prev) => (prev && prev.updatedAt === next.updatedAt && prev.status === next.status ? prev : next));
    setMissing(false);
  };

  useEffect(() => {
    if (DEMO || !gameId) {
      setLoading(false);
      setMissing(DEMO && !!gameId && !demoGames.some((g) => g.id === gameId));
      return;
    }
    const db = getDb();
    if (!db) {
      setLoading(false);
      setMissing(true);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, "games", gameId),
      (snap) => {
        apply(snap);
        setLoading(false);
      },
      () => setLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  usePolling(
    async () => {
      const db = getDb();
      if (!db || !gameId) return;
      apply(await getDoc(doc(db, "games", gameId)));
    },
    90_000,
    !DEMO && !!gameId && game?.status === "live"
  );

  return { game, loading, missing };
}

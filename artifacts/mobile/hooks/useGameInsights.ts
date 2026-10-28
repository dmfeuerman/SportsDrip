import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import { DEMO, demoGames } from "@/lib/demo";
import { demoInsights } from "@/lib/demoInsights";
import { usePolling } from "@/hooks/usePolling";
import type { GameStatus } from "@/types/game";
import type { GameInsights } from "@/types/insights";

/**
 * Deep stats for one game, from the getGameInsights callable.
 *
 * Session cache keyed by game, shared by every screen, so the board sheet,
 * the bet slip and the game center opened in sequence cost one call. In-flight
 * requests are shared too. While a game is live the hook re-polls every 30s;
 * the server serves a cached copy younger than 20s, so polling never reaches
 * the provider more than that.
 */
const cache = new Map<string, { at: number; data: GameInsights }>();
const inflight = new Map<string, Promise<GameInsights>>();

const LIVE_POLL = 30_000;

function freshFor(status: GameStatus): number {
  if (status === "live") return 20_000;
  if (status === "final") return 30 * 60_000;
  return 5 * 60_000;
}

function fetchInsights(gameId: string): Promise<GameInsights> {
  const running = inflight.get(gameId);
  if (running) return running;
  const p = (
    DEMO
      ? Promise.resolve(demoInsights(demoGames.find((g) => g.id === gameId) ?? null, gameId))
      : api.getGameInsights({ gameId }).then((r) => r.insights)
  )
    .then((data) => {
      cache.set(gameId, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(gameId));
  inflight.set(gameId, p);
  return p;
}

/** Warm the cache, e.g. when a bet slip opens, so the sheet paints with data. */
export function prefetchGameInsights(gameId: string) {
  const hit = cache.get(gameId);
  if (hit && Date.now() - hit.at < freshFor(hit.data.status)) return;
  fetchInsights(gameId).catch(() => {});
}

export function useGameInsights(gameId: string | null | undefined, status?: GameStatus) {
  const id = gameId ?? null;
  const [data, setData] = useState<GameInsights | null>(() => (id ? cache.get(id)?.data ?? null : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!id) return;
      const hit = cache.get(id);
      if (!force && hit && Date.now() - hit.at < freshFor(status ?? hit.data.status)) {
        setData(hit.data);
        return;
      }
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchInsights(id);
        if (mine === seq.current) setData(res);
      } catch (e) {
        if (mine === seq.current) setError(api.friendlyError(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [id, status]
  );

  useEffect(() => {
    setData(id ? cache.get(id)?.data ?? null : null);
    void load();
  }, [id, load]);

  usePolling(() => load(), LIVE_POLL, !!id && status === "live");

  return { data, loading, error, reload: () => load(true) };
}

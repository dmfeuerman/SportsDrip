import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useLeague } from "@/context/LeagueContext";
import { useGames } from "@/hooks/useGames";
import { useNow } from "@/hooks/useNow";
import type { Game } from "@/types/game";

export const BET_PROMPT_MS = 60 * 60_000;

/** Upcoming games starting within the hour that the player hasn't bet on, soonest first. */
export function useKickoffSoon(): { games: Game[]; now: number } {
  const { bets } = useApp();
  const { myLeagueBets } = useLeague();
  const { upcoming } = useGames(["upcoming", "live"]);
  const now = useNow(30_000);

  const games = useMemo(() => {
    const betOn = new Set(bets.map((b) => b.gameId));
    for (const list of Object.values(myLeagueBets)) for (const b of list) betOn.add(b.gameId);
    return upcoming
      .filter((g) => g.startsAt > now && g.startsAt - now <= BET_PROMPT_MS && !betOn.has(g.id))
      .sort((a, b) => a.startsAt - b.startsAt);
  }, [bets, myLeagueBets, upcoming, now]);

  return { games, now };
}

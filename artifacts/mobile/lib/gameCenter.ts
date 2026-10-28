import { router } from "expo-router";

/** Opens the game center for a fixture. Bets, cards and sheets all route through here. */
export function openGameCenter(gameId: string, tab?: "live" | "matchup") {
  router.push({ pathname: "/game/[id]", params: tab ? { id: gameId, tab } : { id: gameId } });
}

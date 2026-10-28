import type { GameStatus, Side, Sport } from "@/types/game";

/**
 * Shape returned by the getGameInsights callable. Mirrors
 * functions/src/lib/gameInsights.ts — every field is a value or null, and a
 * section the provider doesn't carry for a sport is an empty list.
 */
export interface RecentGame {
  date: number | null;
  opponent: string;
  opponentName: string | null;
  venue: Side | null;
  result: "W" | "L" | "D" | null;
  /** This team's score first. */
  score: string | null;
}

export interface H2HGame {
  date: number | null;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerAbbr: string | null;
}

export interface PlayerLeader {
  category: string;
  athlete: string;
  position: string | null;
  headshot: string | null;
  value: string;
}

export interface Injury {
  athlete: string;
  position: string | null;
  status: string;
  detail: string | null;
}

export interface StatRow {
  label: string;
  home: string;
  away: string;
}

export interface ScoringEvent {
  id: string;
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  side: Side | null;
  kind: string | null;
  text: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface GameInsights {
  gameId: string;
  sport: Sport;
  status: GameStatus;
  statusDetail: string | null;
  fetchedAt: number;
  linescore: { periods: string[]; home: Array<number | null>; away: Array<number | null> } | null;
  scoring: ScoringEvent[];
  winProbability: { home: number; tie: number } | null;
  predictor: { home: number; away: number } | null;
  leaders: { scope: "season" | "game"; home: PlayerLeader[]; away: PlayerLeader[] };
  teamStats: StatRow[];
  recent: { home: RecentGame[]; away: RecentGame[] };
  headToHead: { summary: string | null; games: H2HGame[] };
  injuries: { home: Injury[]; away: Injury[] };
  venue: { name: string | null; city: string | null; attendance: number | null; weather: string | null };
}

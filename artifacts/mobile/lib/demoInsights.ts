import type { Game, Side, Sport } from "@/types/game";
import type { GameInsights, PlayerLeader, RecentGame } from "@/types/insights";

/**
 * Fixture insights for demo mode (EXPO_PUBLIC_DEMO=1). Deterministic per game
 * so screenshots are stable. Player names are placeholders, not real people.
 */

const H = 3_600_000;
const D = 24 * H;

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const PERIODS: Record<Sport, number> = { NFL: 4, NCAAF: 4, NBA: 4, NCAAB: 2, NHL: 3, MLB: 9, Soccer: 2 };
const LABEL = (sport: Sport, n: number) =>
  sport === "NCAAB" || sport === "Soccer" ? `${n}H` : sport === "NHL" || sport === "MLB" ? String(n) : `Q${n}`;
const CATEGORIES: Record<Sport, Array<[string, string, (r: () => number) => string]>> = {
  NFL: [["Passing Yards", "QB", (r) => `${Math.round(1400 + r() * 900)} YDS`], ["Rushing Yards", "RB", (r) => `${Math.round(380 + r() * 400)} YDS`], ["Receiving Yards", "WR", (r) => `${Math.round(400 + r() * 380)} YDS`]],
  NCAAF: [["Passing Yards", "QB", (r) => `${Math.round(1200 + r() * 900)} YDS`], ["Rushing Yards", "RB", (r) => `${Math.round(300 + r() * 400)} YDS`]],
  NBA: [["Points", "F", (r) => `${(18 + r() * 12).toFixed(1)} PPG`], ["Rebounds", "C", (r) => `${(7 + r() * 6).toFixed(1)} RPG`], ["Assists", "G", (r) => `${(5 + r() * 5).toFixed(1)} APG`]],
  NCAAB: [["Points", "G", (r) => `${(14 + r() * 8).toFixed(1)} PPG`], ["Rebounds", "F", (r) => `${(6 + r() * 4).toFixed(1)} RPG`]],
  NHL: [["Goals", "C", (r) => `${Math.round(4 + r() * 8)} G`], ["Assists", "D", (r) => `${Math.round(6 + r() * 9)} A`], ["Save %", "G", (r) => `.${Math.round(895 + r() * 30)}`]],
  MLB: [["Batting Avg", "SS", (r) => `.${Math.round(260 + r() * 60)}`], ["Home Runs", "RF", (r) => `${Math.round(20 + r() * 25)} HR`], ["ERA", "SP", (r) => (2.6 + r() * 1.6).toFixed(2)]],
  Soccer: [["Goals", "FW", (r) => `${Math.round(3 + r() * 7)} G`], ["Assists", "MF", (r) => `${Math.round(2 + r() * 5)} A`]],
};
const OPPONENTS = ["ATL", "CHI", "DAL", "DEN", "MIA", "PHX", "SEA", "LAL", "MIN", "HOU"];

export function demoInsights(game: Game | null, gameId: string): GameInsights {
  const now = Date.now();
  const sport: Sport = game?.sport ?? "NBA";
  const r = seeded(gameId);
  const status = game?.status ?? "final";
  const abbr: Record<Side, string> = { home: game?.homeTeam.abbreviation ?? "HOM", away: game?.awayTeam.abbreviation ?? "AWY" };
  const scale = sport === "NBA" || sport === "NCAAB" ? 110 : sport === "NFL" || sport === "NCAAF" ? 24 : sport === "MLB" ? 4.5 : 3;

  const recent = (side: Side): RecentGame[] =>
    Array.from({ length: 5 }, (_, i) => {
      let mine = Math.round(scale * (0.7 + r() * 0.6));
      const theirs = Math.round(scale * (0.7 + r() * 0.6));
      if (sport !== "Soccer" && mine === theirs) mine += 1;
      return {
        date: now - (i + 1) * (sport === "NFL" ? 7 : 2) * D,
        opponent: OPPONENTS[Math.floor(r() * OPPONENTS.length)]!,
        opponentName: null,
        venue: r() > 0.5 ? "home" : "away",
        result: mine > theirs ? "W" : mine < theirs ? "L" : "D",
        score: `${mine}-${theirs}`,
      };
    });

  const leaders = (side: Side): PlayerLeader[] =>
    CATEGORIES[sport].map(([category, position, value], i) => ({
      category,
      athlete: `${abbr[side]} ${position}${i + 1}`,
      position,
      headshot: null,
      value: value(r),
    }));

  // Linescore and a scoring timeline that add up to the score on the card.
  let linescore: GameInsights["linescore"] = null;
  const scoring: GameInsights["scoring"] = [];
  if (status !== "upcoming" && game && game.homeScore !== null && game.awayScore !== null) {
    const played = Math.max(1, Math.min(PERIODS[sport], game.period ?? PERIODS[sport]));
    const split = (total: number) => {
      const parts = Array.from({ length: played }, () => r() + 0.2);
      const sum = parts.reduce((a, b) => a + b, 0);
      const out = parts.map((p) => Math.floor((p / sum) * total));
      out[played - 1]! += total - out.reduce((a, b) => a + b, 0);
      return out;
    };
    const h = split(game.homeScore);
    const a = split(game.awayScore);
    linescore = { periods: Array.from({ length: played }, (_, i) => LABEL(sport, i + 1)), home: h, away: a };
    let hs = 0;
    let as = 0;
    for (let p = 0; p < played; p++) {
      for (const side of ["away", "home"] as Side[]) {
        const pts = side === "home" ? h[p]! : a[p]!;
        if (!pts) continue;
        if (side === "home") hs += pts;
        else as += pts;
        scoring.push({
          id: `${p}-${side}`,
          period: p + 1,
          periodLabel: LABEL(sport, p + 1),
          clock: `${Math.floor(r() * 12)}:${String(Math.floor(r() * 60)).padStart(2, "0")}`,
          side,
          kind: sport === "NBA" || sport === "NCAAB" ? "Scoring run" : "Score",
          text: `${abbr[side]} add ${pts} in ${LABEL(sport, p + 1)}`,
          homeScore: hs,
          awayScore: as,
        });
      }
    }
    scoring.reverse();
  }

  const lead = game && game.homeScore !== null && game.awayScore !== null ? game.homeScore - game.awayScore : 0;
  const homeWp = Math.min(0.97, Math.max(0.03, 0.5 + lead / (scale * 0.6)));

  return {
    gameId,
    sport,
    status,
    statusDetail: game?.clock ?? null,
    fetchedAt: now,
    linescore,
    scoring,
    winProbability: status === "live" ? { home: homeWp, tie: 0 } : null,
    predictor: (() => {
      const home = 0.4 + r() * 0.25;
      return { home, away: 1 - home };
    })(),
    leaders: { scope: status === "upcoming" ? "season" : "game", home: leaders("home"), away: leaders("away") },
    teamStats: [
      { label: sport === "MLB" ? "Runs / game" : "Points / game", home: (scale * (0.9 + r() * 0.2)).toFixed(1), away: (scale * (0.9 + r() * 0.2)).toFixed(1) },
      { label: "Allowed / game", home: (scale * (0.9 + r() * 0.2)).toFixed(1), away: (scale * (0.9 + r() * 0.2)).toFixed(1) },
      { label: "Home record", home: "5-1", away: "3-3" },
      { label: "Road record", home: "4-2", away: "4-2" },
    ],
    recent: { home: recent("home"), away: recent("away") },
    headToHead: {
      summary: `${abbr.home} lead the series 3-2`,
      games: Array.from({ length: 4 }, (_, i) => {
        const hs = Math.round(scale * (0.7 + r() * 0.6));
        const as = Math.round(scale * (0.7 + r() * 0.6)) + (i % 2);
        const flip = i % 2 === 0;
        return {
          date: now - (i + 1) * 120 * D,
          homeAbbr: flip ? abbr.home : abbr.away,
          awayAbbr: flip ? abbr.away : abbr.home,
          homeScore: hs,
          awayScore: as,
          winnerAbbr: hs === as ? null : hs > as ? (flip ? abbr.home : abbr.away) : flip ? abbr.away : abbr.home,
        };
      }),
    },
    injuries: {
      home: [{ athlete: `${abbr.home} ${CATEGORIES[sport][1]?.[1] ?? "F"}2`, position: CATEGORIES[sport][1]?.[1] ?? null, status: "Questionable", detail: "Ankle" }],
      away: [
        { athlete: `${abbr.away} ${CATEGORIES[sport][0]?.[1] ?? "G"}3`, position: null, status: "Out", detail: "Hamstring" },
        { athlete: `${abbr.away} ${CATEGORIES[sport][2]?.[1] ?? "C"}4`, position: null, status: "Day-To-Day", detail: null },
      ],
    },
    venue: { name: game?.venue ?? null, city: game?.city ?? null, attendance: status === "upcoming" ? null : 18_204, weather: null },
  };
}

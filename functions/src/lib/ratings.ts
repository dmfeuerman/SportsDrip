import { logger } from "firebase-functions";
import { db, FieldValue } from "./economy";
import {
  BASE_ELO,
  blendedRating,
  eloUpdate,
  homeWinProbability,
  MODEL_VERSION,
  modelConfidence,
  priceFromProbability,
  recordRating,
  type ModelSport,
  type TeamRating,
} from "./oddsModel";
import type { NormalizedGame } from "./sportsProvider";

/**
 * ratings/{sport}: { teams: { [abbr]: TeamRating }, model, updatedAt }.
 * Written only here (rules: read-only to clients).
 */
export const ratingsRef = (sport: string) => db.collection("ratings").doc(sport);
type RatingsDoc = { teams?: Record<string, TeamRating> };

const MODEL_SPORTS = new Set<ModelSport>(["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"]);
const isModelSport = (s: unknown): s is ModelSport => MODEL_SPORTS.has(s as ModelSport);

/**
 * Folds one final into both teams' Elo, exactly once (games/{id}.rated).
 * Starting Elo for a team we've never rated is its record prior, so the
 * first update doesn't drag a 10-2 team back to average.
 */
export async function applyResultToRatings(gameId: string): Promise<boolean> {
  const gameRef = db.collection("games").doc(gameId);
  return db.runTransaction(async (tx) => {
    const game = await tx.get(gameRef);
    if (!game.exists || game.get("status") !== "final" || game.get("rated") === true) return false;
    const sport = game.get("sport");
    const hs = game.get("homeScore");
    const as = game.get("awayScore");
    if (!isModelSport(sport) || typeof hs !== "number" || typeof as !== "number" || game.get("disrupted")) return false;
    const home = game.get("homeTeam") as { abbreviation: string; record?: string | null; pointsFor?: number | null; pointsAgainst?: number | null };
    const away = game.get("awayTeam") as typeof home;
    const ref = ratingsRef(sport);
    const snap = await tx.get(ref);
    const teams = ((snap.data() as RatingsDoc | undefined)?.teams ?? {}) as Record<string, TeamRating>;
    const start = (t: typeof home) => {
      const have = teams[t.abbreviation];
      if (have) return have;
      // The feed's record already includes this game; that's fine for a starting prior.
      return { elo: recordRating(sport, t)?.rating ?? BASE_ELO, games: 0, updatedAt: 0 };
    };
    const h = start(home);
    const a = start(away);
    const next = eloUpdate(sport, h.elo, a.elo, hs, as, Boolean(game.get("neutralSite")));
    const now = Date.now();
    tx.set(
      ref,
      {
        model: MODEL_VERSION,
        updatedAt: now,
        teams: {
          [home.abbreviation]: { elo: Math.round(next.home * 10) / 10, games: h.games + 1, updatedAt: now },
          [away.abbreviation]: { elo: Math.round(next.away * 10) / 10, games: a.games + 1, updatedAt: now },
        },
      },
      { merge: true }
    );
    tx.set(gameRef, { rated: true, ratedAt: now, eloDelta: Math.round(next.delta * 10) / 10 }, { merge: true });
    return true;
  });
}

/** Catches finals the trigger missed (cold deploys, dropped events). */
export async function rateRecentFinals(now = Date.now()): Promise<number> {
  const snap = await db
    .collection("games")
    .where("status", "==", "final")
    .where("startsAt", ">", now - 4 * 86_400_000)
    .limit(300)
    .get();
  let n = 0;
  for (const d of snap.docs) {
    if (d.get("rated") === true) continue;
    if (await applyResultToRatings(d.id).catch((err) => (logger.warn("rating failed", { gameId: d.id, error: String(err) }), false))) n++;
  }
  return n;
}

export interface ModelPrice {
  home: number;
  away: number;
  pHome: number;
  confidence: "low" | "medium" | "high";
}

/** Model prices for upcoming games the feed hasn't priced. One ratings read per sport. */
export async function modelPrices(games: NormalizedGame[]): Promise<Map<string, ModelPrice>> {
  const need = games.filter((g) => !g.priced && g.status === "upcoming" && !g.disrupted && isModelSport(g.sport));
  const out = new Map<string, ModelPrice>();
  if (!need.length) return out;
  const sports = [...new Set(need.map((g) => g.sport as ModelSport))];
  const docs = await Promise.all(sports.map((s) => ratingsRef(s).get().then((d) => [s, (d.data() as RatingsDoc | undefined)?.teams ?? {}] as const)));
  const bySport = new Map(docs);
  for (const g of need) {
    const sport = g.sport as ModelSport;
    const teams = bySport.get(sport) ?? {};
    const he = teams[g.homeTeam.abbreviation];
    const ae = teams[g.awayTeam.abbreviation];
    const hr = blendedRating(sport, he, g.homeTeam);
    const ar = blendedRating(sport, ae, g.awayTeam);
    const p = homeWinProbability(sport, hr, ar, g.neutralSite);
    const prices = priceFromProbability(p);
    const games = (t: typeof g.homeTeam, e: TeamRating | undefined) => Math.max(e?.games ?? 0, recordRating(sport, t)?.games ?? 0);
    out.set(g.id, { ...prices, pHome: Math.round(p * 1000) / 1000, confidence: modelConfidence(sport, games(g.homeTeam, he), games(g.awayTeam, ae)) });
  }
  return out;
}

/**
 * Fills in model prices on unpriced games (in place) and tags every game with
 * where its price came from. Book prices are never touched.
 */
export async function withModelPrices(games: NormalizedGame[]): Promise<NormalizedGame[]> {
  const prices = await modelPrices(games).catch((err) => {
    logger.warn("model pricing failed", { error: String(err) });
    return new Map<string, ModelPrice>();
  });
  const priced = games.map((g) => {
    const m = prices.get(g.id);
    if (g.priced) return { ...g, oddsSource: "book", model: null } as NormalizedGame;
    if (!m) return { ...g, oddsSource: null, model: null } as NormalizedGame;
    return {
      ...g,
      homeTeam: { ...g.homeTeam, odds: m.home },
      awayTeam: { ...g.awayTeam, odds: m.away },
      priced: true,
      oddsProvider: "SportDrip Model",
      oddsSource: "model",
      model: { pHome: m.pHome, confidence: m.confidence, version: MODEL_VERSION, pricedAt: Date.now() },
    } as NormalizedGame;
  });
  return withClosingLines(priced).catch((err) => {
    logger.warn("closing lines failed", { error: String(err) });
    return priced;
  });
}

/**
 * ESPN drops a game's odds and spread/total once it starts. Without this the
 * next sync merges nulls over the pregame prices and live games read "No Line".
 * A started game keeps the last line it had before kickoff (its closing line).
 */
async function withClosingLines(games: NormalizedGame[]): Promise<NormalizedGame[]> {
  const need = games.filter((g) => g.status !== "upcoming" && (!g.priced || !g.line));
  if (!need.length) return games;
  const refs = need.map((g) => db.collection("games").doc(g.id));
  const snaps: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 100) snaps.push(...(await db.getAll(...refs.slice(i, i + 100))));
  const stored = new Map(snaps.filter((d) => d.exists).map((d) => [d.id, d.data()!]));
  return games.map((g) => {
    const prev = stored.get(g.id);
    if (!prev || g.status === "upcoming") return g;
    let out = g;
    if (!g.priced && prev.priced && prev.homeTeam?.odds && prev.awayTeam?.odds) {
      out = {
        ...out,
        homeTeam: { ...out.homeTeam, odds: prev.homeTeam.odds },
        awayTeam: { ...out.awayTeam, odds: prev.awayTeam.odds },
        priced: true,
        oddsProvider: prev.oddsProvider ?? null,
        oddsSource: prev.oddsSource ?? null,
        model: prev.model ?? null,
      } as NormalizedGame;
    }
    if (!g.line && prev.line) out = { ...out, line: prev.line };
    return out;
  });
}

export { FieldValue };

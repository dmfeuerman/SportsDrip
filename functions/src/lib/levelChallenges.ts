import { xpForNext, xpMultiplier } from "./progression";
/**
 * Level challenges. Every level has its own set, all shown at once; claimed
 * ones stay, marked done. The set's XP adds up to CHALLENGE_XP_RATIO x what the
 * level needs, so a player can skip the ones they don't like and still level
 * up. XP alone moves you up (challenges are a menu, not a gate).
 *
 * Level 1 is "learn the app" (one-off explore challenges, lifetime counts).
 * Level 2+ are goals counted from a baseline taken when the set is dealt
 * ("Win 3 bets" means 3 more wins this level). Higher levels offer more
 * challenges with bigger targets.
 */

export type ChallengeMetric =
  | "bets"
  | "boxes"
  | "videos"
  | "referrals"
  | "wins"
  | "parlays"
  | "friends"
  | "leagues"
  | "items"
  | "ownedHat"
  | "ownedTop"
  | "ownedShoes"
  | "moves"
  | "freeBets"
  | "favoriteTeams"
  | "scene"
  // Reported by the app (recordChallengeAction): things only the device sees.
  | "theme"
  | "oddsFormat"
  | "levelsViewed"
  | "avatarSaved"
  | "danced"
  | "tutorial";

/** Metrics the app may report. Each counts once per call; challenges using them are one-offs or small. */
export const CLIENT_ACTIONS = ["theme", "oddsFormat", "levelsViewed", "avatarSaved", "danced", "tutorial"] as const;
export type ClientAction = (typeof CLIENT_ACTIONS)[number];

export interface ChallengeDef {
  id: string;
  /** Lowest level that can be dealt this challenge. */
  minLevel: number;
  metric: ChallengeMetric;
  target: number;
  xp: number;
  title: string;
  /** App route that does it. */
  to?: string;
  /** Learn-the-app challenge (level 1). Counts lifetime totals. */
  explore?: boolean;
  /** Counts the lifetime total, not progress since the level's set was dealt. */
  lifetime?: boolean;
}

/** The set pays this much more than the level needs, so it's pick-and-choose. */
export const CHALLENGE_XP_RATIO = 1.6;

/** Paid straight away the first time the app color changes (recordChallengeAction). */
export const THEME_CHALLENGE_ID = "x_theme";

type Def = Omit<ChallengeDef, "xp"> & { weight: number };

const EXPLORE: Def[] = [
  { id: "x_freebet", minLevel: 1, metric: "freeBets", target: 1, weight: 1.2, title: "Lock in your Daily Free Bet", to: "/(tabs)", explore: true },
  { id: "x_bet", minLevel: 1, metric: "bets", target: 1, weight: 1.2, title: "Place your first bet", to: "/(tabs)/games", explore: true },
  { id: "x_hat", minLevel: 1, metric: "ownedHat", target: 1, weight: 1.2, title: "Buy a hat in the Drip Shop", to: "/customize?category=hat", explore: true },
  { id: "x_friend", minLevel: 1, metric: "friends", target: 1, weight: 1.2, title: "Add a friend", to: "/(tabs)/leagues?seg=friends", explore: true },
  { id: "x_theme", minLevel: 1, metric: "theme", target: 1, weight: 0.8, title: "Change the app color in your Locker", to: "/(tabs)/avatar", explore: true },
  { id: "x_teams", minLevel: 1, metric: "favoriteTeams", target: 1, weight: 0.8, title: "Pick your favorite teams in Settings", to: "/settings", explore: true },
  { id: "x_avatar", minLevel: 1, metric: "avatarSaved", target: 1, weight: 0.8, title: "Save a new look for your character", to: "/customize?category=body", explore: true },
  { id: "x_odds", minLevel: 1, metric: "oddsFormat", target: 1, weight: 0.6, title: "Try another odds format in Settings", to: "/settings", explore: true },
  { id: "x_levels", minLevel: 1, metric: "levelsViewed", target: 1, weight: 0.6, title: "Check out the Levels page", to: "/levels", explore: true },
  { id: "x_dance", minLevel: 1, metric: "danced", target: 1, weight: 0.6, title: "Show off a dance move in your Locker", to: "/(tabs)/avatar", explore: true },
  { id: "x_tour", minLevel: 1, metric: "tutorial", target: 1, weight: 0.6, title: "Finish a tutorial from the ? menu", to: "/(tabs)", explore: true },
];

/**
 * Level 2+ goals. `when` picks the levels that offer it. Most count from the
 * level's baseline ("Win 3 bets" = 3 more this level); `lifetime` ones count
 * the total ("Have 4 friends").
 */
type Goal = { key: string; metric: ChallengeMetric; weight: number; to: string; when: (l: number) => boolean; target: (l: number) => number; title: (n: number) => string; lifetime?: boolean };
const FRIENDS = "/(tabs)/leagues?seg=friends";
const GOALS: Goal[] = [
  { key: "bets", metric: "bets", weight: 1, to: "/(tabs)/games", when: () => true, target: (l) => 3 + l, title: (n) => `Place ${n} bets` },
  { key: "wins", metric: "wins", weight: 1.5, to: "/(tabs)/games", when: () => true, target: (l) => 1 + Math.ceil(l / 2), title: (n) => `Win ${n} bet${n > 1 ? "s" : ""}` },
  { key: "freeBets", metric: "freeBets", weight: 1, to: "/(tabs)", when: () => true, target: (l) => Math.min(7, 2 + Math.floor(l / 3)), title: (n) => `Use ${n} Daily Free Bets` },
  { key: "boxes", metric: "boxes", weight: 0.8, to: "/(tabs)", when: () => true, target: (l) => 2 + Math.floor(l / 3), title: (n) => `Open ${n} prize boxes` },
  { key: "parlays", metric: "parlays", weight: 1.3, to: "/(tabs)/games", when: (l) => l % 2 === 0, target: (l) => 1 + Math.floor(l / 4), title: (n) => `Place ${n} parlay${n > 1 ? "s" : ""}` },
  { key: "items", metric: "items", weight: 1, to: "/customize?category=hat", when: () => true, target: (l) => 1 + Math.floor(l / 6), title: (n) => `Buy ${n} Drip Shop item${n > 1 ? "s" : ""}` },
  { key: "videos", metric: "videos", weight: 0.6, to: "/(tabs)", when: (l) => l % 2 === 1, target: (l) => 1 + Math.floor(l / 5), title: (n) => `Watch ${n} bonus video${n > 1 ? "s" : ""}` },
  { key: "addFriend", metric: "friends", weight: 1.3, to: FRIENDS, when: (l) => l % 3 === 2, target: () => 1, title: () => "Add a new friend" },
  { key: "haveFriends", metric: "friends", weight: 1.3, to: FRIENDS, when: (l) => l % 3 === 0, target: (l) => 1 + Math.floor(l / 3), title: (n) => `Have ${n} friends`, lifetime: true },
  { key: "invite", metric: "referrals", weight: 2, to: FRIENDS, when: (l) => l % 4 === 0, target: () => 1, title: () => "Invite a friend with your code" },
  { key: "moves", metric: "moves", weight: 1.2, to: "/customize?category=moves", when: (l) => l % 4 === 2, target: () => 1, title: () => "Unlock a new dance move" },
  { key: "leagues", metric: "leagues", weight: 1.5, to: "/(tabs)/leagues", when: (l) => l % 5 === 0, target: () => 1, title: () => "Join or start a new league" },
];

/** XP (before grantXp's level multiplier) the whole set pays. */
export function setXpBudget(level: number): number {
  return Math.ceil((CHALLENGE_XP_RATIO * xpForNext(level)) / xpMultiplier(level));
}

function priced(defs: Def[], level: number): ChallengeDef[] {
  const budget = setXpBudget(level);
  const total = defs.reduce((s, d) => s + d.weight, 0) || 1;
  return defs.map(({ weight, ...d }) => ({ ...d, xp: Math.max(5, Math.ceil((budget * weight) / total)) }));
}

/** Every challenge `level` offers, XP split by weight. */
export function levelSet(level: number): ChallengeDef[] {
  const l = Math.max(1, Math.floor(level));
  if (l === 1) return priced(EXPLORE, 1);
  const defs: Def[] = GOALS.filter((g) => g.when(l)).map((g) => {
    const n = g.target(l);
    return { id: `l${l}_${g.key}`, minLevel: l, metric: g.metric, target: n, weight: g.weight, title: g.title(n), to: g.to, ...(g.lifetime ? { lifetime: true } : {}) };
  });
  return priced(defs, l);
}

/** A challenge by id; level-2+ ids carry their level (`l<level>_<metric>`). */
export function challengeById(id: string): ChallengeDef | undefined {
  const m = /^l(\d+)_/.exec(id);
  return levelSet(m ? Number(m[1]) : 1).find((c) => c.id === id);
}

/** Display only — never gates levelling. */
export function levelSetComplete(active: readonly string[], claimed: Record<string, boolean>): boolean {
  return active.every((id) => !!claimed[id]);
}

/** Levels follow XP; challenges never gate. Never down. */
export function gatedLevel(xpLevel: number, current: number, _setDone?: boolean): number {
  return Math.max(current, xpLevel);
}

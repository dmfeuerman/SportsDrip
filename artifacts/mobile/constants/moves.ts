/**
 * Dance moves ("Moves"). The animations are built in the app from the rig
 * (lib/avatar3d/dances.ts), so this library is the list of moves this build
 * can perform. The store listing — price, rarity, availability — comes from
 * Firestore `moves/{id}` (hooks/useMoves.ts), falling back to the defaults
 * here, and purchases are priced server-side (functions/src/callable/moves.ts).
 *
 * Mirrors functions/src/lib/moves.ts for FREE_MOVES, DEFAULT_LOADOUT and
 * MAX_LOADOUT (a functions test keeps them in step). No React Native imports:
 * the functions test suite compiles this file.
 */

export type MoveRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface MoveInfo {
  id: string;
  name: string;
  description: string;
  /** MaterialCommunityIcons glyph. */
  icon: string;
  rarity: MoveRarity;
  /** Default store price (Firestore overrides). 0 = everyone has it. */
  price: number;
  /** Seconds, for the store card. */
  seconds: number;
}

/** Everyone has these; they are never sold. */
export const FREE_MOVES = ["cheer", "fist_pump"] as const;

/** What the dance button does for someone who has never set a loadout. */
export const DEFAULT_LOADOUT: string[] = [...FREE_MOVES];

/** Moves on the dance button at once. */
export const MAX_LOADOUT = 4;

/**
 * Prices are set against the economy like the clothing (scripts/catalog-data.mjs):
 * one prize box buys at most a common move.
 */
export const MOVE_LIBRARY: MoveInfo[] = [
  { id: "cheer", name: "Cheer", description: "Both arms up. The classic.", icon: "human-handsup", rarity: "common", price: 0, seconds: 1.7 },
  { id: "fist_pump", name: "Fist Pump", description: "A hop, arms in a V, then three big pumps.", icon: "arm-flex", rarity: "common", price: 0, seconds: 2.7 },
  { id: "two_step", name: "Two-Step", description: "Step, touch, step, touch — loose arms, easy groove.", icon: "shoe-sneaker", rarity: "common", price: 15000, seconds: 6 },
  { id: "hype_clap", name: "Hype Clap", description: "Bounce and clap, then take it over your head.", icon: "hand-clap", rarity: "common", price: 18000, seconds: 5 },
  { id: "shoulder_shimmy", name: "Shoulder Shimmy", description: "Low stance, fists up, shoulders popping on the beat.", icon: "music", rarity: "uncommon", price: 32000, seconds: 4.6 },
  { id: "raise_the_roof", name: "Raise the Roof", description: "Palms up and push it — every beat.", icon: "home-roof", rarity: "uncommon", price: 38000, seconds: 4.8 },
  { id: "the_dab", name: "The Dab", description: "Two bounces, hit it right, switch, hit it left.", icon: "lightning-bolt", rarity: "uncommon", price: 45000, seconds: 4.4 },
  { id: "sprinkler", name: "The Sprinkler", description: "Hand behind the head, tick-tick-tick across, sweep back.", icon: "sprinkler", rarity: "rare", price: 75000, seconds: 3.9 },
  { id: "disco_point", name: "Disco Point", description: "Point to the sky, point to the floor, hips on the beat.", icon: "star-four-points", rarity: "rare", price: 85000, seconds: 5 },
  { id: "the_robot", name: "The Robot", description: "Locked joints, hard stops, a little mechanical ring.", icon: "robot", rarity: "epic", price: 160000, seconds: 4.8 },
  { id: "the_floss", name: "The Floss", description: "Arms swinging front and back, hips the other way.", icon: "swap-horizontal", rarity: "epic", price: 180000, seconds: 4.6 },
  { id: "champion_spin", name: "Champion Spin", description: "Wind up, jump into a full turn, land it, point to the sky.", icon: "trophy", rarity: "legendary", price: 400000, seconds: 4.4 },
];

export const MOVES_BY_ID = new Map(MOVE_LIBRARY.map((m) => [m.id, m]));

export const isFreeMove = (id: string) => (FREE_MOVES as readonly string[]).includes(id);

/** A stored loadout made safe to play: known moves only, no repeats, at most four; the default if empty. */
export function loadoutOf(stored: unknown): string[] {
  if (!Array.isArray(stored)) return DEFAULT_LOADOUT;
  const ids = [...new Set(stored.filter((x): x is string => typeof x === "string" && MOVES_BY_ID.has(x)))].slice(0, MAX_LOADOUT);
  return ids.length ? ids : DEFAULT_LOADOUT;
}

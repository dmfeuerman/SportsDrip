/**
 * Dance moves ("Moves"): emotes a player buys once and keeps, and up to
 * MAX_LOADOUT of which sit in their loadout — what the dance button on their
 * character offers.
 *
 *  moves/{moveId}                 store listing: name, price, rarity, available, releaseAt
 *  users/{uid}/moves/{moveId}     ownership (server-written, like inventory)
 *  users/{uid}.moves: string[]    the loadout, in button order
 *
 * The animations ship in the app (artifacts/mobile/lib/avatar3d/dances.ts), so
 * a listing only does anything once the app knows the id; prices and
 * availability live in Firestore so they can change without a release.
 * Mirrored on the client in artifacts/mobile/constants/moves.ts.
 */

/** Everyone has these; they are never sold. */
export const FREE_MOVES = ["cheer", "fist_pump"] as const;

/** A player who has never set a loadout dances these. */
export const DEFAULT_LOADOUT: string[] = [...FREE_MOVES];

export const MAX_LOADOUT = 4;

/**
 * Built-in listings for every move the app can animate (mirrors
 * scripts/move-data.mjs). A moves/{id} doc overrides these; without one the
 * move still sells at this price, so an unseeded store isn't empty.
 */
export const DEFAULT_MOVE_LISTINGS: Record<string, { name: string; price: number }> = {
  two_step: { name: "Two-Step", price: 15000 },
  hype_clap: { name: "Hype Clap", price: 18000 },
  shoulder_shimmy: { name: "Shoulder Shimmy", price: 32000 },
  raise_the_roof: { name: "Raise the Roof", price: 38000 },
  the_dab: { name: "The Dab", price: 45000 },
  sprinkler: { name: "The Sprinkler", price: 75000 },
  disco_point: { name: "Disco Point", price: 85000 },
  the_robot: { name: "The Robot", price: 160000 },
  the_floss: { name: "The Floss", price: 180000 },
  champion_spin: { name: "Champion Spin", price: 400000 },
};

export const MOVE_ID_RE = /^[a-z0-9_]{2,40}$/;

export const isFreeMove = (id: string) => (FREE_MOVES as readonly string[]).includes(id);

/** The stored loadout, or the default for profiles that predate moves. */
export function loadoutOf(stored: unknown): string[] {
  if (!Array.isArray(stored)) return DEFAULT_LOADOUT;
  const ids = stored.filter((x): x is string => typeof x === "string" && MOVE_ID_RE.test(x));
  return ids.length ? [...new Set(ids)].slice(0, MAX_LOADOUT) : DEFAULT_LOADOUT;
}

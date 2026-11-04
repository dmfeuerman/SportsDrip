/**
 * Backgrounds: the scene behind a player's character on Home and their
 * profile. Bought once and kept, like moves.
 *
 *  backgrounds/{id}                    store listing: name, price, rarity, available,
 *                                      releaseAt, levelRequired, levelReward
 *  users/{uid}/backgrounds/{id}        ownership (server-written)
 *  users/{uid}.background              the one in use (absent = DEFAULT_BACKGROUND)
 *
 * The scenes are drawn in the app (artifacts/mobile/constants/backgrounds.ts),
 * so a new id ships with an app release; price and gating live in Firestore.
 *
 *  levelRequired  can only be bought at or above this level
 *  levelReward    never sold: granted free on reaching this level
 */

export const FREE_BACKGROUNDS = ["locker_room"] as const;
export const DEFAULT_BACKGROUND = "locker_room";
export const BACKGROUND_ID_RE = /^[a-z0-9_]{2,40}$/;

export const isFreeBackground = (id: string) => (FREE_BACKGROUNDS as readonly string[]).includes(id);

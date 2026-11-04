"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFreeBackground = exports.BACKGROUND_ID_RE = exports.DEFAULT_BACKGROUND = exports.FREE_BACKGROUNDS = void 0;
exports.FREE_BACKGROUNDS = ["locker_room"];
exports.DEFAULT_BACKGROUND = "locker_room";
exports.BACKGROUND_ID_RE = /^[a-z0-9_]{2,40}$/;
const isFreeBackground = (id) => exports.FREE_BACKGROUNDS.includes(id);
exports.isFreeBackground = isFreeBackground;
//# sourceMappingURL=backgrounds.js.map
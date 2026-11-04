"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFreeMove = exports.MOVE_ID_RE = exports.MAX_LOADOUT = exports.DEFAULT_LOADOUT = exports.FREE_MOVES = void 0;
exports.loadoutOf = loadoutOf;
/** Everyone has these; they are never sold. */
exports.FREE_MOVES = ["cheer", "fist_pump"];
/** A player who has never set a loadout dances these. */
exports.DEFAULT_LOADOUT = [...exports.FREE_MOVES];
exports.MAX_LOADOUT = 4;
exports.MOVE_ID_RE = /^[a-z0-9_]{2,40}$/;
const isFreeMove = (id) => exports.FREE_MOVES.includes(id);
exports.isFreeMove = isFreeMove;
/** The stored loadout, or the default for profiles that predate moves. */
function loadoutOf(stored) {
    if (!Array.isArray(stored))
        return exports.DEFAULT_LOADOUT;
    const ids = stored.filter((x) => typeof x === "string" && exports.MOVE_ID_RE.test(x));
    return ids.length ? [...new Set(ids)].slice(0, exports.MAX_LOADOUT) : exports.DEFAULT_LOADOUT;
}
//# sourceMappingURL=moves.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentEmptyDays = recentEmptyDays;
exports.resetEmptyDaysCache = resetEmptyDaysCache;
const economy_1 = require("./economy");
const streak_1 = require("./streak");
/**
 * Recent days with no featured game (dailyPick/{day}.empty). Read outside the
 * caller's transaction (these docs are effectively immutable) and cached per
 * instance, so a streak never breaks across a no-game day.
 */
const LOOKBACK_DAYS = 8;
const TTL_MS = 10 * 60_000;
let cache = null;
async function recentEmptyDays(now = Date.now()) {
    const today = (0, streak_1.nyDay)(now);
    if (cache && cache.day === today && now - cache.at < TTL_MS)
        return cache.set;
    const refs = Array.from({ length: LOOKBACK_DAYS }, (_, i) => economy_1.db.collection("dailyPick").doc((0, streak_1.nyDay)(now - (i + 1) * 86_400_000)));
    const set = new Set();
    try {
        const snaps = await economy_1.db.getAll(...refs);
        for (const s of snaps)
            if (s.exists && s.get("empty") === true)
                set.add(s.id);
    }
    catch {
        return set;
    }
    cache = { at: now, day: today, set };
    return set;
}
/** Test hook. */
function resetEmptyDaysCache() {
    cache = null;
}
//# sourceMappingURL=streakDays.js.map
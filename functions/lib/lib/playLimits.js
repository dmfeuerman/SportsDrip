"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPlayLimits = checkPlayLimits;
const https_1 = require("firebase-functions/v2/https");
const streak_1 = require("./streak");
/**
 * Optional, player-set limits (users/{uid}.limits). Limit-setters stay active
 * longer, so these are offered, never imposed:
 *   dailyPicks  max picks per America/New_York day (null = no limit)
 *   breakUntil  epoch ms; no picks until then ("take a break")
 * Placement counts live in users/{uid}.picksToday = { day, count }.
 */
function checkPlayLimits(user, now) {
    const breakUntil = user.get("limits.breakUntil");
    if (breakUntil && breakUntil > now) {
        throw new https_1.HttpsError("failed-precondition", "You're on a break. Picks open again when it ends.");
    }
    const day = (0, streak_1.nyDay)(now);
    const prev = user.get("picksToday");
    const count = prev?.day === day ? Math.max(0, prev.count ?? 0) : 0;
    const cap = user.get("limits.dailyPicks");
    if (typeof cap === "number" && cap > 0 && count >= cap) {
        throw new https_1.HttpsError("failed-precondition", `You've hit your daily limit of ${cap} picks. It resets at midnight ET.`);
    }
    return { picksToday: { day, count: count + 1 } };
}
//# sourceMappingURL=playLimits.js.map
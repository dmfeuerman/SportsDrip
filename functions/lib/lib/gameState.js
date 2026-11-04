"use strict";
/**
 * Disrupted game handling (postponed / cancelled) and live clutch detection.
 * Pure functions so both scheduled jobs and unit tests can evaluate game state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSTPONED_GRACE_MS = void 0;
exports.voidReason = voidReason;
exports.isClutch = isClutch;
exports.POSTPONED_GRACE_MS = 24 * 3_600_000;
/**
 * Determines whether open bets on a game should be voided and refunded:
 *  - Cancelled games void immediately ("canceled").
 *  - Postponed games void if not played within 24h of the original start ("postponed").
 *  - Games marked expired by syncGames void after 24h past original start ("expired").
 */
function voidReason(game, now) {
    if (!game)
        return null;
    if (game.status === "final")
        return null;
    if (game.disrupted === "canceled")
        return "canceled";
    const startsAt = typeof game.startsAt === "number" ? game.startsAt : 0;
    if (game.disrupted === "postponed") {
        if (!startsAt || now - startsAt >= exports.POSTPONED_GRACE_MS)
            return "postponed";
        return null;
    }
    if (game.expired === true && startsAt > 0 && now - startsAt >= exports.POSTPONED_GRACE_MS) {
        return "expired";
    }
    return null;
}
function parseClockSeconds(clock, explicitSec) {
    if (typeof explicitSec === "number" && Number.isFinite(explicitSec) && explicitSec >= 0) {
        return explicitSec;
    }
    if (!clock)
        return null;
    const m = /(\d{1,2}):(\d{2})/.exec(clock);
    if (m)
        return Number(m[1]) * 60 + Number(m[2]);
    return null;
}
/**
 * True when a live game enters its final 5 minutes (or 9th inning in MLB)
 * within one score.
 */
function isClutch(game) {
    if (game.status !== "live")
        return false;
    if (typeof game.homeScore !== "number" || typeof game.awayScore !== "number")
        return false;
    const diff = Math.abs(game.homeScore - game.awayScore);
    const period = game.period ?? 0;
    const sec = parseClockSeconds(game.clock, game.clockSec);
    const sport = game.sport ?? "NBA";
    switch (sport) {
        case "MLB":
            return period >= 9 && diff <= 2;
        case "NFL":
        case "NCAAF":
            return period >= 4 && sec !== null && sec <= 300 && diff <= 8;
        case "NBA":
        case "NCAAB":
            return period >= 2 && (sport === "NCAAB" ? period >= 2 : period >= 4) && sec !== null && sec <= 300 && diff <= 5;
        case "NHL":
            return period >= 3 && sec !== null && sec <= 300 && diff <= 1;
        case "Soccer":
            return period >= 2 && diff <= 1 && (sec === null || sec <= 300 || sec >= 85 * 60);
        default:
            return period >= 4 && sec !== null && sec <= 300 && diff <= 5;
    }
}
//# sourceMappingURL=gameState.js.map
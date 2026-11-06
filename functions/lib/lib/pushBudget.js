"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TZ = exports.DEFAULT_QUIET_END = exports.DEFAULT_QUIET_START = exports.DEFAULT_DAILY_CAP = exports.RECENT_LOSS_MS = exports.LOSS_TYPES = exports.BET_PROMPT_TYPES = void 0;
exports.classifyPush = classifyPush;
exports.isValidTz = isValidTz;
exports.localDay = localDay;
exports.inQuietHours = inQuietHours;
exports.decidePush = decidePush;
const ENGAGEMENT = new Set([
    "sweat_alert",
    "clutch_alert",
    "lock_reminder",
    "team_reminder",
    "reaction",
    "achievement",
    "level_up",
    "bet_tailed",
    "bet_faded",
    "league_report",
    "win_back",
]);
/** Types whose copy invites a new pick. Never sent after a recent loss. */
exports.BET_PROMPT_TYPES = new Set(["lock_reminder", "team_reminder"]);
exports.LOSS_TYPES = ["bet_lost", "challenge_lost"];
exports.RECENT_LOSS_MS = 12 * 3600_000;
exports.DEFAULT_DAILY_CAP = 4;
exports.DEFAULT_QUIET_START = 23;
exports.DEFAULT_QUIET_END = 8;
exports.DEFAULT_TZ = "America/New_York";
function classifyPush(type) {
    return ENGAGEMENT.has(type) ? "engagement" : "transactional";
}
function isValidTz(tz) {
    if (typeof tz !== "string" || tz.length === 0 || tz.length > 64)
        return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
function parts(now, tz) {
    const zone = isValidTz(tz) ? tz : exports.DEFAULT_TZ;
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
/** The user's local calendar day — the budget counter's doc id. */
function localDay(now, tz) {
    return parts(now, tz ?? exports.DEFAULT_TZ).day;
}
function inQuietHours(now, tz, start = exports.DEFAULT_QUIET_START, end = exports.DEFAULT_QUIET_END) {
    const { hour } = parts(now, tz ?? exports.DEFAULT_TZ);
    return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}
function decidePush(i) {
    if (classifyPush(i.type) === "transactional")
        return { send: true, counts: false };
    if (i.breakUntil && i.breakUntil > i.now)
        return { send: false, reason: "on_break" };
    if (i.atDailyLimit)
        return { send: false, reason: "daily_limit" };
    if (exports.BET_PROMPT_TYPES.has(i.type) && i.recentLoss)
        return { send: false, reason: "recent_loss" };
    if (i.quietHours !== false && inQuietHours(i.now, i.tz))
        return { send: false, reason: "quiet_hours" };
    if (i.sentToday >= (i.cap ?? exports.DEFAULT_DAILY_CAP))
        return { send: false, reason: "budget" };
    return { send: true, counts: true };
}
//# sourceMappingURL=pushBudget.js.map
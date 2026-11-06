"use strict";
/**
 * League rules. Mirrors artifacts/mobile/constants/leagueTypes.ts, but this is
 * the copy that is enforced — the client's copy only drives the pickers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMBER_COLORS = exports.MAX_OPEN_REQUESTS = exports.PEER_RATE_MAX = exports.PEER_LOAN_MAX_PCT = exports.BANK_PRINCIPAL_CAP_MULTIPLIER = exports.BANK_INTERVAL_MAX_H = exports.BANK_INTERVAL_MIN_H = exports.BANK_RATE_MAX = exports.BANK_RATE_MIN = exports.MIN_LEAGUE_STAKE = exports.MAX_MEMBERS = exports.PRIZE_PRESETS = exports.BUY_IN_OPTIONS = exports.TOKEN_START_OPTIONS = exports.STIMULUS_COOLDOWN_MS = exports.STIMULUS_TTL_MS = exports.STIMULUS_PCTS = exports.CADENCE_DAYS = exports.MATCHUP_CADENCES = exports.durationWeeks = exports.weeksBetween = exports.leagueStarted = exports.MIN_LEAGUE_PLAYERS = exports.MAX_START_LEAD_MS = exports.MIN_START_LEAD_MS = exports.FULL_SEASON_SPORTS = exports.SEASONS = exports.MAX_SEASON_DAYS = exports.MAX_DURATION_DAYS = exports.MIN_DURATION_DAYS = exports.DURATION_KEYS = exports.FULL_SEASON = exports.DURATIONS = exports.LEAGUE_MODES = exports.SPORTS = void 0;
exports.sportSeasonEnd = sportSeasonEnd;
exports.seasonEndFor = seasonEndFor;
exports.endsAtFor = endsAtFor;
exports.leagueStartsAt = leagueStartsAt;
exports.peerLoanRequestsEnabled = peerLoanRequestsEnabled;
exports.randomCode = randomCode;
exports.SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"];
/** "matchups": a bankroll league ranked by head-to-head record instead of net worth. */
exports.LEAGUE_MODES = ["bankroll", "pickem", "survivor", "matchups", "bracket"];
/**
 * Season lengths in days. One month (4 weeks) is the floor: short leagues
 * never built enough history for standings, rivalries or the weekly ritual to
 * mean anything. Every option is a whole number of weeks so weekly head-to-head
 * matchups divide the season evenly (4+ week regular season, then a final week).
 */
exports.DURATIONS = { "1 Month": 28, "6 Weeks": 42, "2 Months": 56, "3 Months": 91 };
/** "Full Season": runs until the last chosen sport's season ends (seasonEndFor). */
exports.FULL_SEASON = "Full Season";
exports.DURATION_KEYS = ["1 Month", "6 Weeks", "2 Months", "3 Months", exports.FULL_SEASON];
exports.MIN_DURATION_DAYS = 28;
exports.MAX_DURATION_DAYS = 91;
/** A full-season league can span two sports' seasons (e.g. MLB + next NBA season). */
exports.MAX_SEASON_DAYS = 500;
const DAY = 86_400_000;
// ---------------------------------------------------------------------------
// Sport seasons. Approximate regular season start → last game of the
// playoffs, as [month, day]. An end before the start means the next year.
// Mirrored in artifacts/mobile/constants/seasons.ts for the create screen.
// ---------------------------------------------------------------------------
exports.SEASONS = {
    NFL: { start: [9, 4], end: [2, 10], finale: "Super Bowl" },
    NCAAF: { start: [8, 23], end: [1, 21], finale: "CFP title game" },
    NBA: { start: [10, 21], end: [6, 22], finale: "NBA Finals" },
    NCAAB: { start: [11, 3], end: [4, 8], finale: "Final Four" },
    NHL: { start: [10, 7], end: [6, 24], finale: "Stanley Cup Final" },
    MLB: { start: [3, 26], end: [11, 4], finale: "World Series" },
    Soccer: { start: [8, 15], end: [5, 31], finale: "end of the European season" },
};
/**
 * End of the season a new league should cover for one sport: the one in
 * progress if at least half of it is left, otherwise the next full one.
 */
function sportSeasonEnd(sport, now) {
    const w = exports.SEASONS[sport];
    const year = new Date(now).getUTCFullYear();
    const at = (y, [m, d]) => Date.UTC(y, m - 1, d, 23, 59);
    const spans = [year - 1, year, year + 1].map((y) => {
        const start = at(y, w.start);
        const endYear = w.end[0] < w.start[0] || (w.end[0] === w.start[0] && w.end[1] < w.start[1]) ? y + 1 : y;
        return { start, end: at(endYear, w.end) };
    });
    const i = spans.findIndex((s) => s.end > now);
    const cur = spans[i];
    if (now > cur.start && cur.end - now < (cur.end - cur.start) / 2 && spans[i + 1])
        return spans[i + 1];
    return cur;
}
/** A full-season league covers exactly one sport's season. */
exports.FULL_SEASON_SPORTS = 1;
/** When a full-season league with these sports ends: the latest of their seasons. */
function seasonEndFor(sports, now) {
    const end = Math.max(...sports.map((s) => sportSeasonEnd(s, now).end), now + exports.MIN_DURATION_DAYS * DAY);
    return Math.min(end, now + exports.MAX_SEASON_DAYS * DAY);
}
/** League end for a duration choice, counted from `from` (creation time). */
function endsAtFor(d, sports, from) {
    return d === exports.FULL_SEASON ? seasonEndFor(sports, from) : from + exports.DURATIONS[d] * DAY;
}
// ---------------------------------------------------------------------------
// Start date: a league starts now or at least a day out (so friends can join).
// Nobody new can join once it has started.
// ---------------------------------------------------------------------------
/** A scheduled start must be at least this far out. */
exports.MIN_START_LEAD_MS = DAY;
/** ...and no further than this. */
exports.MAX_START_LEAD_MS = 60 * DAY;
/** When the league starts; leagues created before scheduled starts began at creation. */
function leagueStartsAt(league) {
    return league.get("startsAt") ?? league.get("createdAt") ?? 0;
}
/** A league needs at least this many players to start; until then it stays open to join. */
exports.MIN_LEAGUE_PLAYERS = 2;
/**
 * Started: its start time has come AND it has at least two players. A league
 * nobody else has joined stays in preseason (still joinable) past its start
 * time; the second player to join starts it (joinLeague).
 */
const leagueStarted = (league, now) => now >= leagueStartsAt(league) && (league.get("memberIds")?.length ?? 0) >= exports.MIN_LEAGUE_PLAYERS;
exports.leagueStarted = leagueStarted;
/** Whole weeks between start and end (for the playoff week / report cadence). */
const weeksBetween = (from, to) => Math.max(4, Math.ceil((to - from) / (7 * DAY)));
exports.weeksBetween = weeksBetween;
const durationWeeks = (d) => exports.DURATIONS[d] / 7;
exports.durationWeeks = durationWeeks;
// ---------------------------------------------------------------------------
// Head-to-head matchups
// ---------------------------------------------------------------------------
/** How often matchups turn over: Mondays; Mondays + Thursdays; every day. */
exports.MATCHUP_CADENCES = ["weekly", "twice-weekly", "daily"];
exports.CADENCE_DAYS = { weekly: 7, "twice-weekly": 3.5, daily: 1 };
// ---------------------------------------------------------------------------
// Bank stimulus: members vote for the bank to hand everyone extra tokens.
// ---------------------------------------------------------------------------
/** Percent of the league's starting tokens each member gets if a vote passes. */
exports.STIMULUS_PCTS = [10, 25, 50];
/** An unanswered request lapses after this long. */
exports.STIMULUS_TTL_MS = 48 * 3_600_000;
/** Minimum gap between two approved stimulus payments. */
exports.STIMULUS_COOLDOWN_MS = 7 * DAY;
exports.TOKEN_START_OPTIONS = [1_000, 5_000, 10_000, 25_000, 50_000];
exports.BUY_IN_OPTIONS = [0, 100, 250, 500, 1_000];
exports.PRIZE_PRESETS = {
    "winner-all": { firstPct: 100, secondPct: 0, thirdPct: 0 },
    "top-2": { firstPct: 70, secondPct: 30, thirdPct: 0 },
    "top-3": { firstPct: 60, secondPct: 30, thirdPct: 10 },
};
exports.MAX_MEMBERS = 50;
exports.MIN_LEAGUE_STAKE = 10;
/** Bank: rate is percent of outstanding principal per interval. */
exports.BANK_RATE_MIN = 0.5;
exports.BANK_RATE_MAX = 50;
exports.BANK_INTERVAL_MIN_H = 1;
exports.BANK_INTERVAL_MAX_H = 168;
/**
 * Total outstanding bank principal a member may carry, as a multiple of the
 * league's starting tokens. Unlimited borrowing turned the bank into infinite
 * leverage: borrow a billion, bet it, keep the win.
 */
exports.BANK_PRINCIPAL_CAP_MULTIPLIER = 1;
/** Peer loans: the request form always said "Max 50% of starting tokens". */
exports.PEER_LOAN_MAX_PCT = 0.5;
exports.PEER_RATE_MAX = 50;
exports.MAX_OPEN_REQUESTS = 3;
/**
 * Peer ("friend") loan requests are on by default. Read per call so they can be
 * switched off by env (PEER_LOAN_REQUESTS_ENABLED=false) without a code change.
 * Existing open requests can still be funded, countered or withdrawn either way.
 */
function peerLoanRequestsEnabled() {
    return process.env.PEER_LOAN_REQUESTS_ENABLED !== "false";
}
exports.MEMBER_COLORS = [
    "#E2564A", "#43C67F", "#5AA9E6", "#A57BE0", "#FFB03A",
    "#E07BB5", "#4FC1B9", "#C4703B", "#8FA0E6", "#B8C94A",
];
/** No 0/O/1/I — codes get read aloud and typed from screenshots. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len = 6) {
    let out = "";
    for (let i = 0; i < len; i++)
        out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
}
//# sourceMappingURL=leagueConfig.js.map
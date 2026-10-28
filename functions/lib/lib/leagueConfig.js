"use strict";
/**
 * League rules. Mirrors artifacts/mobile/constants/leagueTypes.ts, but this is
 * the copy that is enforced — the client's copy only drives the pickers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMBER_COLORS = exports.MAX_OPEN_REQUESTS = exports.PEER_RATE_MAX = exports.PEER_LOAN_MAX_PCT = exports.BANK_PRINCIPAL_CAP_MULTIPLIER = exports.BANK_INTERVAL_MAX_H = exports.BANK_INTERVAL_MIN_H = exports.BANK_RATE_MAX = exports.BANK_RATE_MIN = exports.MIN_LEAGUE_STAKE = exports.MAX_MEMBERS = exports.PRIZE_PRESETS = exports.BUY_IN_OPTIONS = exports.TOKEN_START_OPTIONS = exports.DURATIONS = exports.SPORTS = void 0;
exports.peerLoanRequestsEnabled = peerLoanRequestsEnabled;
exports.randomCode = randomCode;
exports.SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"];
exports.DURATIONS = { "1 Week": 7, "2 Weeks": 14, "1 Month": 30, "3 Months": 90 };
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
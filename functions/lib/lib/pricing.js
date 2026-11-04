"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NEAR_KICKOFF_STALE_MS = exports.NEAR_KICKOFF_WINDOW_MS = exports.MAX_LINE_DRIFT = exports.MAX_ADVERSE_DRIFT = exports.SPREAD_TOTAL_ODDS = exports.NO_LINE_MESSAGE = void 0;
exports.formatSpreadNumber = formatSpreadNumber;
exports.assertGameNotDisruptedAndFresh = assertGameNotDisruptedAndFresh;
exports.requirePricedSide = requirePricedSide;
exports.assertNoAdverseDrift = assertNoAdverseDrift;
exports.assertNoLineDrift = assertNoLineDrift;
exports.requirePricedMarket = requirePricedMarket;
const https_1 = require("firebase-functions/v2/https");
exports.NO_LINE_MESSAGE = "No line yet for this game. Check back closer to kickoff.";
/** Standard -110 juice in decimal for spread and total markets when ESPN omits price juice. */
exports.SPREAD_TOTAL_ODDS = 1.91;
/** Drift against the bettor larger than this fails loudly instead of shrinking the payout. */
exports.MAX_ADVERSE_DRIFT = 0.05;
/** Maximum spread or total points a line may move from expectedLine before freezing/rejecting. */
exports.MAX_LINE_DRIFT = 0.5;
/** Within 30 minutes of kickoff, reject bets if an explicit updatedAt timestamp is stale (> 2 min). */
exports.NEAR_KICKOFF_WINDOW_MS = 30 * 60_000;
exports.MAX_NEAR_KICKOFF_STALE_MS = 2 * 60_000;
function validOdds(x) {
    return typeof x === "number" && Number.isFinite(x) && x > 1;
}
function formatSpreadNumber(line) {
    const clean = Object.is(line, -0) ? 0 : line;
    return clean > 0 ? `+${clean}` : `${clean}`;
}
function assertGameNotDisruptedAndFresh(game, now = Date.now()) {
    const disrupted = game.get("disrupted");
    if (disrupted === "postponed" || disrupted === "canceled") {
        throw new https_1.HttpsError("failed-precondition", `This game is ${disrupted} — betting is closed.`);
    }
    if (game.get("expired") === true) {
        throw new https_1.HttpsError("failed-precondition", "Betting is closed for this game.");
    }
    const startsAt = game.get("startsAt") ?? 0;
    const updatedAt = game.get("updatedAt");
    if (typeof updatedAt === "number" &&
        startsAt > now &&
        startsAt - now <= exports.NEAR_KICKOFF_WINDOW_MS &&
        now - updatedAt > exports.MAX_NEAR_KICKOFF_STALE_MS) {
        throw new https_1.HttpsError("aborted", "Odds are refreshing before kickoff. Try again in a moment.");
    }
}
/**
 * The picked side and its opponent, or a `failed-precondition` when the feed
 * had no moneyline. `priced` must be explicitly true: documents written by the
 * old sync (hash-priced) have no flag and are refused until the next sync
 * rewrites them.
 */
function requirePricedSide(game, side) {
    assertGameNotDisruptedAndFresh(game);
    const team = game.get(side === "home" ? "homeTeam" : "awayTeam");
    const opponent = game.get(side === "home" ? "awayTeam" : "homeTeam");
    if (game.get("priced") !== true || !team || !validOdds(team.odds)) {
        throw new https_1.HttpsError("failed-precondition", exports.NO_LINE_MESSAGE);
    }
    return {
        team: {
            name: team.name ?? side,
            abbreviation: team.abbreviation ?? side.toUpperCase(),
            color: team.color ?? "#4A90D9",
            odds: team.odds,
        },
        opponent: { abbreviation: opponent?.abbreviation ?? "TBD", name: opponent?.name ?? "Opponent" },
    };
}
/**
 * Prices track a real moneyline, so they move between syncs. Drift in the
 * user's favour applies silently; drift against them past MAX_ADVERSE_DRIFT
 * is an `aborted` the client can retry at the new price.
 */
function assertNoAdverseDrift(odds, expectedOdds) {
    if (expectedOdds && odds < expectedOdds * (1 - exports.MAX_ADVERSE_DRIFT)) {
        throw new https_1.HttpsError("aborted", `The price moved to ${odds.toFixed(2)}x before this went through. Tap again to take it.`);
    }
}
/**
 * Line freeze guard for spread and total markets: rejects when the current line
 * moved by more than 0.5 points from `expectedLine`.
 */
function assertNoLineDrift(currentLine, expectedLine) {
    if (expectedLine !== undefined && Math.abs(currentLine - expectedLine) > exports.MAX_LINE_DRIFT) {
        throw new https_1.HttpsError("aborted", `The line moved from ${expectedLine} to ${currentLine} before this went through. Tap again to take the new number.`);
    }
}
/**
 * Resolves and validates any of the three markets ("ml" | "spread" | "total").
 * Backwards-compatible with callers that pass `{ side: "home" | "away" }` only.
 */
function requirePricedMarket(game, input) {
    assertGameNotDisruptedAndFresh(game);
    const market = input.market ?? "ml";
    const selection = input.selection ?? input.side;
    if (!selection) {
        throw new https_1.HttpsError("invalid-argument", "Pick a side or total selection.");
    }
    const home = game.get("homeTeam") ?? {};
    const away = game.get("awayTeam") ?? {};
    const homeAbbr = home.abbreviation ?? "HOME";
    const awayAbbr = away.abbreviation ?? "AWAY";
    if (market === "ml") {
        if (selection !== "home" && selection !== "away") {
            throw new https_1.HttpsError("invalid-argument", "Moneyline bets must pick home or away.");
        }
        const { team, opponent } = requirePricedSide(game, selection);
        assertNoAdverseDrift(team.odds, input.expectedOdds);
        return {
            market: "ml",
            selection,
            side: selection,
            line: null,
            odds: team.odds,
            label: team.abbreviation,
            teamName: team.name,
            teamAbbr: team.abbreviation,
            teamColor: team.color,
            opponentAbbr: opponent.abbreviation,
        };
    }
    if (market === "spread") {
        if (selection !== "home" && selection !== "away") {
            throw new https_1.HttpsError("invalid-argument", "Spread bets must pick home or away.");
        }
        const lineObj = game.get("line");
        const spreadHome = lineObj?.spreadHome;
        if (typeof spreadHome !== "number" || !Number.isFinite(spreadHome)) {
            throw new https_1.HttpsError("failed-precondition", "No spread line yet for this game.");
        }
        const rawLine = selection === "home" ? spreadHome : -spreadHome;
        const line = Object.is(rawLine, -0) ? 0 : rawLine;
        assertNoLineDrift(line, input.expectedLine);
        assertNoAdverseDrift(exports.SPREAD_TOTAL_ODDS, input.expectedOdds);
        const picked = selection === "home" ? home : away;
        const opp = selection === "home" ? away : home;
        const abbr = picked.abbreviation ?? selection.toUpperCase();
        const label = `${abbr} ${formatSpreadNumber(line)}`;
        return {
            market: "spread",
            selection,
            side: selection,
            line,
            odds: exports.SPREAD_TOTAL_ODDS,
            label,
            teamName: picked.name ?? abbr,
            teamAbbr: abbr,
            teamColor: picked.color ?? "#4A90D9",
            opponentAbbr: opp.abbreviation ?? "OPP",
        };
    }
    // market === "total"
    if (selection !== "over" && selection !== "under") {
        throw new https_1.HttpsError("invalid-argument", "Total bets must pick over or under.");
    }
    const lineObj = game.get("line");
    const overUnder = lineObj?.overUnder;
    if (typeof overUnder !== "number" || !Number.isFinite(overUnder) || overUnder <= 0) {
        throw new https_1.HttpsError("failed-precondition", "No total line yet for this game.");
    }
    assertNoLineDrift(overUnder, input.expectedLine);
    assertNoAdverseDrift(exports.SPREAD_TOTAL_ODDS, input.expectedOdds);
    const prefix = selection === "over" ? "Over" : "Under";
    const label = `${prefix} ${overUnder}`;
    return {
        market: "total",
        selection,
        side: null,
        line: overUnder,
        odds: exports.SPREAD_TOTAL_ODDS,
        label,
        teamName: `${awayAbbr} @ ${homeAbbr} ${label}`,
        teamAbbr: `${selection === "over" ? "O" : "U"} ${overUnder}`,
        teamColor: selection === "over" ? (home.color ?? "#43C67F") : (away.color ?? "#5AA9E6"),
        opponentAbbr: `${awayAbbr}@${homeAbbr}`,
    };
}
//# sourceMappingURL=pricing.js.map
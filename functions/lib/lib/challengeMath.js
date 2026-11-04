"use strict";
/**
 * Head-to-head friend challenges: the pure money rules. No Firestore imports,
 * so the app can mirror it (artifacts/mobile/lib/challengeMath.ts) and the
 * tests can pin both copies to the same numbers.
 *
 * Two formats:
 *  - "pot"   both players put the same amount in; the winner takes the lot.
 *  - "odds"  the challenger names their price. Backing a team at 2.50x for 100
 *            means the challenger escrows 100, the friend escrows the 150 that
 *            covers the win, and the winner of the game takes the 250 pot.
 *
 * Either way both stakes sit in escrow before kickoff, so nobody can bet 100
 * and then spend it before the game is played.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHALLENGE_MAX_MESSAGE = exports.CHALLENGE_MAX_ODDS = exports.CHALLENGE_MIN_ODDS = exports.CHALLENGE_MAX_STAKE = exports.CHALLENGE_MIN_STAKE = void 0;
exports.roundOdds = roundOdds;
exports.counterOdds = counterOdds;
exports.challengeTerms = challengeTerms;
exports.challengePayouts = challengePayouts;
exports.CHALLENGE_MIN_STAKE = 10;
exports.CHALLENGE_MAX_STAKE = 100_000;
exports.CHALLENGE_MIN_ODDS = 1.1;
exports.CHALLENGE_MAX_ODDS = 10;
exports.CHALLENGE_MAX_MESSAGE = 80;
function roundOdds(x) {
    return Math.round(x * 100) / 100;
}
/** The price the friend is effectively getting on the other side. */
function counterOdds(terms) {
    return terms.opponentStake > 0 ? roundOdds(terms.pot / terms.opponentStake) : 0;
}
/**
 * Turns what the challenger asked for into exact escrow amounts, or explains
 * why it can't be offered. The server is the only caller whose answer counts.
 */
function challengeTerms(mode, stake, odds) {
    if (!Number.isInteger(stake) || stake < exports.CHALLENGE_MIN_STAKE) {
        return { ok: false, reason: `The minimum stake is ${exports.CHALLENGE_MIN_STAKE}.` };
    }
    if (stake > exports.CHALLENGE_MAX_STAKE) {
        return { ok: false, reason: `The maximum stake is ${exports.CHALLENGE_MAX_STAKE.toLocaleString("en-US")}.` };
    }
    if (mode === "pot") {
        return { ok: true, terms: { mode, odds: 2, creatorStake: stake, opponentStake: stake, pot: stake * 2 } };
    }
    if (odds === undefined || !Number.isFinite(odds))
        return { ok: false, reason: "Set the odds for this challenge." };
    const price = roundOdds(odds);
    if (price < exports.CHALLENGE_MIN_ODDS || price > exports.CHALLENGE_MAX_ODDS) {
        return { ok: false, reason: `Odds must be between ${exports.CHALLENGE_MIN_ODDS.toFixed(2)}x and ${exports.CHALLENGE_MAX_ODDS.toFixed(2)}x.` };
    }
    const opponentStake = Math.round(stake * (price - 1));
    if (opponentStake < exports.CHALLENGE_MIN_STAKE) {
        return { ok: false, reason: `At ${price.toFixed(2)}x your friend would only put in ${opponentStake}. Raise the stake or the odds.` };
    }
    if (opponentStake > exports.CHALLENGE_MAX_STAKE) {
        return { ok: false, reason: "Your friend's side would be over the maximum stake. Lower the stake or the odds." };
    }
    return { ok: true, terms: { mode, odds: price, creatorStake: stake, opponentStake, pot: stake + opponentStake } };
}
/** What each player gets back from the pot once the game is final. */
function challengePayouts(outcome, terms) {
    if (outcome === "creator")
        return { creator: terms.pot, opponent: 0 };
    if (outcome === "opponent")
        return { creator: 0, opponent: terms.pot };
    return { creator: terms.creatorStake, opponent: terms.opponentStake };
}
//# sourceMappingURL=challengeMath.js.map
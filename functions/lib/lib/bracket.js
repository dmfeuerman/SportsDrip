"use strict";
/**
 * Bracket engine (pure). A template (bracketTemplates/{id}, live-ops content):
 *   { name, locksAt, slots: [{ id, round, teams?: [a, b], feeds?: [slotA, slotB], gameId?: string }],
 *     gameIds: string[], results?: { [slotId]: winnerAbbr } }
 * Round-1 slots list their two teams; later slots are fed by two earlier slots.
 * A member's bracket (leagues/{id}/brackets/{uid}) is { picks: { [slotId]: abbr } }.
 * Scoring is 1-2-4-8-16-32 by round.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundPoints = exports.ROUND_POINTS = void 0;
exports.validateTemplate = validateTemplate;
exports.slotOptions = slotOptions;
exports.sanitizePicks = sanitizePicks;
exports.scoreBracket = scoreBracket;
exports.slotWinner = slotWinner;
exports.ROUND_POINTS = [1, 2, 4, 8, 16, 32];
const roundPoints = (round) => exports.ROUND_POINTS[Math.min(exports.ROUND_POINTS.length, Math.max(1, round)) - 1];
exports.roundPoints = roundPoints;
/** Structural check for a template (used by tests and before writing content). */
function validateTemplate(t) {
    const byId = new Map(t.slots.map((s) => [s.id, s]));
    if (byId.size !== t.slots.length)
        throw new Error("duplicate slot id");
    for (const s of t.slots) {
        if (s.round < 1 || s.round > exports.ROUND_POINTS.length)
            throw new Error(`slot ${s.id}: round out of range`);
        if (s.round === 1) {
            if (!s.teams || s.teams.length !== 2 || s.teams[0] === s.teams[1])
                throw new Error(`slot ${s.id}: round 1 needs two teams`);
        }
        else {
            if (!s.feeds || s.feeds.length !== 2)
                throw new Error(`slot ${s.id}: needs two feeders`);
            for (const f of s.feeds) {
                const src = byId.get(f);
                if (!src || src.round !== s.round - 1)
                    throw new Error(`slot ${s.id}: feeder ${f} must be in round ${s.round - 1}`);
            }
        }
    }
}
/** The teams that can appear in a slot given the member's own earlier picks. */
function slotOptions(t, picks, slotId) {
    const s = t.slots.find((x) => x.id === slotId);
    if (!s)
        return [];
    if (s.round === 1)
        return [...(s.teams ?? [])];
    return (s.feeds ?? []).map((f) => picks[f]).filter((x) => !!x);
}
/** Drops picks that are inconsistent with feeder picks (cascading). Returns a clean copy. */
function sanitizePicks(t, picks) {
    const out = {};
    for (const s of [...t.slots].sort((a, b) => a.round - b.round)) {
        const p = picks[s.id];
        if (p && slotOptions(t, out, s.id).includes(p))
            out[s.id] = p;
    }
    return out;
}
function scoreBracket(t, picks) {
    let points = 0;
    let correct = 0;
    for (const s of t.slots) {
        const winner = t.results?.[s.id];
        if (winner && picks[s.id] === winner) {
            points += (0, exports.roundPoints)(s.round);
            correct++;
        }
    }
    return { points, correct };
}
/** Winner abbr for a final game, or null for a tie / not final. */
function slotWinner(game) {
    if (game.status !== "final" || game.homeScore == null || game.awayScore == null || game.homeScore === game.awayScore)
        return null;
    return (game.homeScore > game.awayScore ? game.homeTeam?.abbreviation : game.awayTeam?.abbreviation) ?? null;
}
//# sourceMappingURL=bracket.js.map
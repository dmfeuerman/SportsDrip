"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.periodLabel = periodLabel;
exports.normalizeSummary = normalizeSummary;
exports.fetchSummary = fetchSummary;
exports.ttlFor = ttlFor;
/**
 * Per-game insights: everything ESPN's event summary knows that the
 * scoreboard doesn't — period-by-period scoring, the scoring timeline, win
 * probability, season or in-game leaders, team stat comparison, recent form,
 * head-to-head and injuries.
 *
 * Same rules as sportsProvider: the summary is fetched server-side only (the
 * getGameInsights callable, behind a Firestore cache), and every field comes
 * out as a value or null — never undefined, which Firestore rejects. The
 * summary's shape varies by sport and by game state, so each section is
 * parsed independently and a missing section is an empty list, not an error.
 */
const sportsProvider_1 = require("./sportsProvider");
// ── primitives ─────────────────────────────────────────────────────────────
const MAX_TEXT = 220;
function str(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return String(v);
    if (typeof v !== "string")
        return null;
    const t = v.trim();
    return t ? t.slice(0, MAX_TEXT) : null;
}
function num(v) {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}
const arr = (v) => (Array.isArray(v) ? v : []);
function time(v) {
    const s = str(v);
    if (!s)
        return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
}
const prob = (v) => (v !== null && v >= 0 && v <= 1 ? v : null);
function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
/** Short label for the nth period of a sport: Q3, 2H, OT, 7. */
function periodLabel(sport, n) {
    switch (sport) {
        case "NFL":
        case "NCAAF":
        case "NBA":
            return n <= 4 ? `Q${n}` : n === 5 ? "OT" : `${n - 4}OT`;
        case "NCAAB":
            return n === 1 ? "1H" : n === 2 ? "2H" : n === 3 ? "OT" : `${n - 2}OT`;
        case "NHL":
            return n <= 3 ? String(n) : n === 4 ? "OT" : "SO";
        case "Soccer":
            return n === 1 ? "1H" : n === 2 ? "2H" : n === 3 ? "ET1" : n === 4 ? "ET2" : "PK";
        default:
            return String(n);
    }
}
function sideOf(ref, ids) {
    const id = str(ref?.id ?? ref?.team?.id);
    const abbr = str(ref?.abbreviation ?? ref?.team?.abbreviation);
    for (const s of ["home", "away"]) {
        if (id && ids[s].id === id)
            return s;
        if (abbr && ids[s].abbr === abbr)
            return s;
    }
    return null;
}
// ── sections ───────────────────────────────────────────────────────────────
function buildLinescore(home, away, sport) {
    const h = arr(home?.linescores).map((l) => num(l?.value ?? l?.displayValue));
    const a = arr(away?.linescores).map((l) => num(l?.value ?? l?.displayValue));
    const n = Math.max(h.length, a.length);
    if (!n)
        return null;
    while (h.length < n)
        h.push(null);
    while (a.length < n)
        a.push(null);
    return { periods: Array.from({ length: n }, (_, i) => periodLabel(sport, i + 1)), home: h, away: a };
}
function scoringPeriodLabel(p, sport) {
    const n = num(p?.period?.number);
    if (n === null)
        return null;
    if (sport === "MLB") {
        const half = str(p?.period?.type);
        return half ? `${half} ${ordinal(n)}` : ordinal(n);
    }
    return periodLabel(sport, n);
}
const SOCCER_EVENT = /goal|penalty|red card|yellow card/i;
function buildScoring(json, ids, sport) {
    let raw = arr(json?.scoringPlays);
    if (!raw.length)
        raw = arr(json?.plays).filter((p) => p?.scoringPlay === true);
    const soccer = !raw.length && sport === "Soccer";
    if (soccer) {
        raw = arr(json?.keyEvents).filter((e) => e?.scoringPlay === true || SOCCER_EVENT.test(String(e?.type?.text ?? e?.type?.type ?? "")));
    }
    // Soccer key events carry no running score, so it is counted here.
    let home = 0;
    let away = 0;
    const out = raw.map((p, i) => {
        const side = sideOf(p?.team, ids);
        let homeScore = num(p?.homeScore);
        let awayScore = num(p?.awayScore);
        if (soccer) {
            if (p?.scoringPlay === true) {
                if (side === "home")
                    home++;
                else if (side === "away")
                    away++;
            }
            homeScore = home;
            awayScore = away;
        }
        return {
            id: str(p?.id) ?? `e${i}`,
            period: num(p?.period?.number),
            periodLabel: scoringPeriodLabel(p, sport),
            clock: str(p?.clock?.displayValue),
            side,
            kind: str(p?.type?.text) ?? str(p?.scoringType?.displayName),
            text: str(p?.text) ?? str(p?.shortText) ?? str(p?.type?.text) ?? "Score",
            homeScore,
            awayScore,
        };
    });
    return out.reverse().slice(0, 40);
}
function buildWinProbability(json) {
    const last = arr(json?.winprobability).at(-1);
    const home = prob(num(last?.homeWinPercentage));
    if (home === null)
        return null;
    return { home, tie: prob(num(last?.tiePercentage)) ?? 0 };
}
function buildPredictor(json) {
    const h = num(json?.predictor?.homeTeam?.gameProjection);
    const a = num(json?.predictor?.awayTeam?.gameProjection);
    if (h === null || a === null || h + a <= 0)
        return null;
    // ESPN publishes percentages ("63.2"); normalise so the pair sums to 1.
    return { home: h / (h + a), away: a / (h + a) };
}
function leaderOf(category, entry) {
    const athlete = str(entry?.athlete?.shortName) ?? str(entry?.athlete?.displayName);
    const value = str(entry?.displayValue) ?? str(entry?.mainStat?.value) ?? str(entry?.value);
    if (!athlete || !value)
        return null;
    return {
        category: str(category?.displayName) ?? str(category?.shortDisplayName) ?? str(category?.name) ?? "Leader",
        athlete,
        position: str(entry?.athlete?.position?.abbreviation),
        headshot: str(entry?.athlete?.headshot?.href),
        value,
    };
}
function buildLeaders(json, ids, comps, status) {
    const out = { scope: status === "upcoming" ? "season" : "game", home: [], away: [] };
    for (const entry of arr(json?.leaders)) {
        const side = sideOf(entry?.team, ids);
        if (!side)
            continue;
        for (const cat of arr(entry?.leaders)) {
            const l = leaderOf(cat, arr(cat?.leaders)[0]);
            if (l && out[side].length < 4)
                out[side].push(l);
        }
    }
    // Baseball's most useful pre-game fact is who's pitching.
    for (const c of comps) {
        const side = c?.homeAway === "home" ? "home" : c?.homeAway === "away" ? "away" : null;
        const p = arr(c?.probables)[0];
        if (!side || !p)
            continue;
        const athlete = str(p?.athlete?.shortName) ?? str(p?.athlete?.displayName);
        if (!athlete)
            continue;
        const stats = arr(p?.statistics)
            .map((s) => (str(s?.abbreviation) && str(s?.displayValue) ? `${s.displayValue} ${s.abbreviation}` : null))
            .filter(Boolean)
            .slice(0, 2)
            .join(", ");
        out[side].unshift({
            category: "Probable starter",
            athlete,
            position: str(p?.athlete?.position?.abbreviation),
            headshot: str(p?.athlete?.headshot?.href),
            value: str(p?.record) ?? (stats || "—"),
        });
        out[side] = out[side].slice(0, 4);
    }
    return out;
}
function flattenStats(stats) {
    return stats.flatMap((s) => (Array.isArray(s?.stats) ? s.stats : [s]));
}
function buildTeamStats(json, ids) {
    const bySide = {};
    const order = [];
    for (const t of arr(json?.boxscore?.teams)) {
        const side = sideOf(t?.team, ids) ?? (t?.homeAway === "home" || t?.homeAway === "away" ? t.homeAway : null);
        if (!side)
            continue;
        const m = new Map();
        for (const s of flattenStats(arr(t?.statistics))) {
            const label = str(s?.label) ?? str(s?.displayName) ?? str(s?.abbreviation) ?? str(s?.name);
            const value = str(s?.displayValue);
            if (!label || value === null || m.has(label))
                continue;
            m.set(label, value);
            if (!order.includes(label))
                order.push(label);
        }
        bySide[side] = m;
    }
    const h = bySide.home;
    const a = bySide.away;
    if (!h || !a)
        return [];
    return order
        .filter((l) => h.has(l) && a.has(l))
        .slice(0, 14)
        .map((label) => ({ label, home: h.get(label), away: a.get(label) }));
}
function result(v) {
    const r = str(v)?.toUpperCase();
    return r === "W" ? "W" : r === "L" ? "L" : r === "D" || r === "T" ? "D" : null;
}
function recentOf(e, teamId) {
    const homeId = str(e?.homeTeamId);
    const isHome = teamId && homeId ? homeId === teamId : e?.atVs ? str(e.atVs) !== "@" : null;
    const hs = num(e?.homeTeamScore);
    const as = num(e?.awayTeamScore);
    const mine = isHome === null ? null : isHome ? hs : as;
    const theirs = isHome === null ? null : isHome ? as : hs;
    return {
        date: time(e?.gameDate ?? e?.date),
        opponent: str(e?.opponent?.abbreviation) ?? str(e?.opponent?.shortDisplayName) ?? "—",
        opponentName: str(e?.opponent?.displayName),
        venue: isHome === null ? null : isHome ? "home" : "away",
        result: result(e?.gameResult),
        score: mine !== null && theirs !== null ? `${mine}-${theirs}` : str(e?.score),
    };
}
const byDateDesc = (a, b) => (b.date ?? 0) - (a.date ?? 0);
function buildRecent(json, ids) {
    const out = { home: [], away: [] };
    const src = arr(json?.lastFiveGames).length ? arr(json?.lastFiveGames) : arr(json?.boxscore?.form);
    for (const entry of src) {
        const side = sideOf(entry?.team, ids);
        if (!side)
            continue;
        const teamId = str(entry?.team?.id) ?? ids[side].id;
        out[side] = arr(entry?.events).map((e) => recentOf(e, teamId)).sort(byDateDesc).slice(0, 5);
    }
    return out;
}
function buildHeadToHead(json, ids, kickoff) {
    const games = [];
    const before = (d) => d === null || kickoff === null || d < kickoff - 3_600_000;
    for (const entry of arr(json?.headToHeadGames)) {
        const teamAbbr = str(entry?.team?.abbreviation);
        const teamId = str(entry?.team?.id);
        if (!teamAbbr)
            continue;
        for (const e of arr(entry?.events)) {
            const r = recentOf(e, teamId);
            const hs = num(e?.homeTeamScore);
            const as = num(e?.awayTeamScore);
            if (hs === null || as === null || !before(r.date))
                continue;
            const homeAbbr = r.venue === "away" ? r.opponent : teamAbbr;
            const awayAbbr = r.venue === "away" ? teamAbbr : r.opponent;
            games.push({
                date: r.date,
                homeAbbr,
                awayAbbr,
                homeScore: hs,
                awayScore: as,
                winnerAbbr: r.result === "W" ? teamAbbr : r.result === "L" ? r.opponent : hs === as ? null : hs > as ? homeAbbr : awayAbbr,
            });
        }
        break; // both entries describe the same games
    }
    let summary = null;
    for (const ss of arr(json?.seasonseries)) {
        summary = summary ?? str(ss?.summary) ?? str(ss?.description);
        for (const e of arr(ss?.events)) {
            const cs = arr(e?.competitors);
            const h = cs.find((c) => c?.homeAway === "home");
            const a = cs.find((c) => c?.homeAway === "away");
            const hs = num(h?.score?.value ?? h?.score);
            const as = num(a?.score?.value ?? a?.score);
            const date = time(e?.date);
            const homeAbbr = str(h?.team?.abbreviation);
            const awayAbbr = str(a?.team?.abbreviation);
            if (!homeAbbr || !awayAbbr || hs === null || as === null || !before(date))
                continue;
            games.push({
                date,
                homeAbbr,
                awayAbbr,
                homeScore: hs,
                awayScore: as,
                winnerAbbr: h?.winner === true ? homeAbbr : a?.winner === true ? awayAbbr : hs === as ? null : hs > as ? homeAbbr : awayAbbr,
            });
        }
    }
    const seen = new Set();
    const unique = games.filter((g) => {
        const k = `${g.date ? new Date(g.date).toISOString().slice(0, 10) : "?"}|${g.homeAbbr}|${g.awayAbbr}`;
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
    // Abbreviations in old games can differ from today's; only keep games that
    // involve at least one of this fixture's teams.
    const teams = new Set([ids.home.abbr, ids.away.abbr].filter(Boolean));
    return {
        summary,
        games: unique.filter((g) => teams.has(g.homeAbbr) || teams.has(g.awayAbbr)).sort(byDateDesc).slice(0, 6),
    };
}
const INJURY_ORDER = ["out", "doubtful", "questionable", "day-to-day", "probable"];
function buildInjuries(json, ids) {
    const out = { home: [], away: [] };
    for (const entry of arr(json?.injuries)) {
        const side = sideOf(entry?.team, ids);
        if (!side)
            continue;
        out[side] = arr(entry?.injuries)
            .map((i) => {
            const athlete = str(i?.athlete?.shortName) ?? str(i?.athlete?.displayName);
            if (!athlete)
                return null;
            const detail = [str(i?.details?.side), str(i?.details?.type), str(i?.details?.detail)].filter(Boolean).join(" ");
            return {
                athlete,
                position: str(i?.athlete?.position?.abbreviation),
                status: str(i?.status) ?? str(i?.type?.description) ?? "Injured",
                detail: detail || str(i?.shortComment) || null,
            };
        })
            .filter((i) => i !== null)
            .sort((a, b) => rank(a.status) - rank(b.status))
            .slice(0, 8);
    }
    return out;
    function rank(s) {
        const i = INJURY_ORDER.indexOf(s.toLowerCase());
        return i < 0 ? INJURY_ORDER.length : i;
    }
}
function buildVenue(json, comp) {
    const v = json?.gameInfo?.venue ?? comp?.venue;
    const w = json?.gameInfo?.weather;
    const temp = num(w?.temperature);
    return {
        name: str(v?.fullName),
        city: [str(v?.address?.city), str(v?.address?.state)].filter(Boolean).join(", ") || null,
        attendance: num(json?.gameInfo?.attendance),
        weather: str(w?.displayValue) ?? (temp !== null ? `${temp}°F` : null),
    };
}
// ── entry points ───────────────────────────────────────────────────────────
/** Turns an ESPN event summary into GameInsights. Pure; never throws on shape. */
function normalizeSummary(json, ctx) {
    const comp = arr(json?.header?.competitions)[0] ?? {};
    const comps = arr(comp?.competitors);
    const home = comps.find((c) => c?.homeAway === "home");
    const away = comps.find((c) => c?.homeAway === "away");
    const ids = {
        home: { id: str(home?.team?.id ?? home?.id), abbr: str(home?.team?.abbreviation) },
        away: { id: str(away?.team?.id ?? away?.id), abbr: str(away?.team?.abbreviation) },
    };
    const typeName = str(comp?.status?.type?.name);
    const state = str(comp?.status?.type?.state);
    const status = typeName
        ? (0, sportsProvider_1.toStatus)(typeName)
        : state === "in"
            ? "live"
            : state === "post"
                ? "final"
                : "upcoming";
    return {
        gameId: ctx.gameId,
        sport: ctx.sport,
        status,
        statusDetail: str(comp?.status?.type?.detail) ?? str(comp?.status?.type?.shortDetail),
        fetchedAt: ctx.now,
        linescore: status === "upcoming" ? null : buildLinescore(home, away, ctx.sport),
        scoring: status === "upcoming" ? [] : buildScoring(json, ids, ctx.sport),
        winProbability: status === "live" ? buildWinProbability(json) : null,
        predictor: buildPredictor(json),
        leaders: buildLeaders(json, ids, comps, status),
        teamStats: buildTeamStats(json, ids),
        recent: buildRecent(json, ids),
        headToHead: buildHeadToHead(json, ids, time(comp?.date)),
        injuries: buildInjuries(json, ids),
        venue: buildVenue(json, comp),
    };
}
/** The raw summary, or null when the provider doesn't know this event at that path. */
async function fetchSummary(providerPath, eventId) {
    const res = await fetch(`${sportsProvider_1.ESPN_BASE}/${providerPath}/summary?event=${encodeURIComponent(eventId)}`, {
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
        return null;
    const json = (await res.json());
    return arr(json?.header?.competitions).length ? json : null;
}
/**
 * How long a cached copy stays fresh. Live games move every play; a game
 * days away changes when an injury report does.
 */
function ttlFor(status, startsAt, now) {
    if (status === "live")
        return 20_000;
    if (status === "final")
        return 6 * 3_600_000;
    if (startsAt !== null && startsAt - now < 2 * 3_600_000)
        return 5 * 60_000;
    return 30 * 60_000;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
//# sourceMappingURL=gameInsights.js.map
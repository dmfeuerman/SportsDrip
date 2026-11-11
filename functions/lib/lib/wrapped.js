"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWrapped = buildWrapped;
exports.generateLeagueWrapped = generateLeagueWrapped;
exports.generateYearWrapped = generateYearWrapped;
const economy_1 = require("./economy");
const progression_1 = require("./progression");
function buildWrapped(args) {
    const record = { w: 0, l: 0, p: 0 };
    let bestCall = null;
    let worstBeat = null;
    const teams = new Map();
    for (const b of args.bets) {
        const label = b.label || b.teamAbbr || "Pick";
        if (b.teamAbbr)
            teams.set(b.teamAbbr, (teams.get(b.teamAbbr) ?? 0) + 1);
        if (b.status === "won") {
            record.w++;
            if (!bestCall || b.odds > bestCall.odds)
                bestCall = { label, odds: b.odds };
        }
        else if (b.status === "lost") {
            record.l++;
            if (!worstBeat || b.stake > worstBeat.stake)
                worstBeat = { label, stake: b.stake };
        }
        else if (b.status === "push")
            record.p++;
    }
    let rival = null;
    for (const r of args.rivalries) {
        const me = r.aUid === args.uid ? "a" : r.bUid === args.uid ? "b" : null;
        if (!me)
            continue;
        const w = (me === "a" ? r.aWins : r.bWins) ?? 0;
        const l = (me === "a" ? r.bWins : r.aWins) ?? 0;
        const games = w + l + (r.pushes ?? 0);
        if (!rival || games > rival.games) {
            rival = { uid: me === "a" ? r.bUid : r.aUid, name: me === "a" ? r.bName : r.aName, games, w, l };
        }
    }
    const top = [...teams.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    return {
        periodId: args.periodId,
        title: args.title,
        record,
        bestCall,
        worstBeat,
        rival: rival && rival.games > 0 ? rival : null,
        topTeam: top ? { abbr: top[0], picks: top[1] } : null,
        streakBest: args.streakBest,
        level: (0, progression_1.levelFromXp)(args.xp),
        achievements: args.achievements,
        generatedAt: args.now,
    };
}
const settled = (d) => ({
    status: d.get("status"),
    odds: d.get("odds") ?? 0,
    stake: d.get("stake") ?? 0,
    payout: d.get("payout"),
    teamAbbr: d.get("teamAbbr") ?? null,
    label: d.get("label") ?? null,
});
/** One league season. */
async function generateLeagueWrapped(leagueId, now = Date.now()) {
    const leagueRef = economy_1.db.collection("leagues").doc(leagueId);
    const league = await leagueRef.get();
    if (!league.exists)
        return 0;
    const memberIds = league.get("memberIds") ?? [];
    const [bets, rivalries] = await Promise.all([
        leagueRef.collection("leagueBets").limit(5000).get(),
        leagueRef.collection("rivalries").limit(1000).get(),
    ]);
    const rivs = rivalries.docs.map((d) => d.data());
    let n = 0;
    for (const uid of memberIds) {
        const user = await economy_1.db.collection("users").doc(uid).get();
        if (!user.exists)
            continue;
        const w = buildWrapped({
            uid,
            periodId: leagueId,
            title: league.get("name") ?? "League",
            bets: bets.docs.filter((d) => d.get("uid") === uid).map(settled),
            rivalries: rivs,
            streakBest: user.get("streak.longest") ?? 0,
            xp: user.get("xp") ?? 0,
            achievements: user.get("achievementCount") ?? 0,
            now,
        });
        await user.ref.collection("wrapped").doc(leagueId).set(w);
        n++;
    }
    return n;
}
/** The yearly edition for one player: global bets + every league's bets that year. */
async function generateYearWrapped(uid, year, now = Date.now()) {
    const user = await economy_1.db.collection("users").doc(uid).get();
    if (!user.exists)
        return false;
    const from = Date.UTC(year, 0, 1);
    const to = Date.UTC(year + 1, 0, 1);
    const [global, league, leagues] = await Promise.all([
        economy_1.db
            .collection("bets")
            .where("uid", "==", uid)
            .where("placedAt", ">=", economy_1.Timestamp.fromMillis(from))
            .where("placedAt", "<", economy_1.Timestamp.fromMillis(to))
            .limit(5000)
            .get(),
        economy_1.db.collectionGroup("leagueBets").where("uid", "==", uid).where("placedAt", ">=", from).where("placedAt", "<", to).limit(5000).get(),
        economy_1.db.collection("leagues").where("memberIds", "array-contains", uid).limit(50).get(),
    ]);
    const rivs = [];
    for (const l of leagues.docs) {
        const r = await l.ref.collection("rivalries").limit(500).get();
        rivs.push(...r.docs.map((d) => d.data()));
    }
    const w = buildWrapped({
        uid,
        periodId: `year-${year}`,
        title: `${year} on On The House`,
        bets: [...global.docs, ...league.docs].map(settled),
        rivalries: rivs,
        streakBest: user.get("streak.longest") ?? 0,
        xp: user.get("xp") ?? 0,
        achievements: user.get("achievementCount") ?? 0,
        now,
    });
    await user.ref.collection("wrapped").doc(`year-${year}`).set(w);
    return true;
}
//# sourceMappingURL=wrapped.js.map
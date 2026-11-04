"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mondayLeagueJobs = exports.leagueMatchupJobs = exports.tuesdayLeagueReport = void 0;
exports.generateTuesdayReport = generateTuesdayReport;
exports.closeMatchups = closeMatchups;
exports.openWeekMatchups = openWeekMatchups;
exports.sweepMissedSurvivorWeek = sweepMissedSurvivorWeek;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const loanMath_1 = require("../lib/loanMath");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const leagueConfig_1 = require("../lib/leagueConfig");
const weekly_1 = require("../lib/weekly");
function loanListFrom(docs) {
    return docs.map((d) => ({
        principal: d.get("principal"),
        principalOutstanding: d.get("principalOutstanding"),
        interestAccrued: d.get("interestAccrued") ?? 0,
        interestPaid: d.get("interestPaid") ?? 0,
        accruedThrough: d.get("accruedThrough"),
        ratePct: d.get("ratePct"),
        intervalHours: d.get("intervalHours"),
        kind: d.get("kind"),
        status: d.get("status"),
        borrowerId: d.get("borrowerId"),
        lenderId: d.get("lenderId") ?? null,
    }));
}
/**
 * Generates and stores the Tuesday League Report (`leagues/{id}/reports/{week}`)
 * for one league, pushing a notification to every member.
 */
async function generateTuesdayReport(leagueId, now = Date.now(), explicitWeek) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    const week = explicitWeek ?? (0, weekly_1.weekKey)(now - 2 * 86_400_000); // Previous Monday-anchored week
    return economy_1.db.runTransaction(async (tx) => {
        const [league, existing, betsSnap, loansSnap] = await Promise.all([
            tx.get(ref),
            tx.get(ref.collection("reports").doc(week)),
            tx.get(ref.collection("leagueBets")),
            tx.get(ref.collection("loans")),
        ]);
        if (!league.exists)
            return null;
        if (existing.exists)
            return existing.data();
        const leagueName = league.get("name") ?? "League";
        const membersMap = league.get("members") ?? {};
        const loans = loanListFrom(loansSnap.docs);
        const members = Object.values(membersMap).map((m) => ({
            uid: m.uid,
            displayName: m.displayName,
            netWorth: (0, loanMath_1.balanceSheet)(m.uid, m.leagueTokens, loans, now).netWorth,
        }));
        const bets = betsSnap.docs.map((d) => ({
            id: d.id,
            uid: d.get("uid"),
            displayName: d.get("displayName") ?? "Player",
            label: d.get("label") ?? d.get("teamAbbr"),
            teamAbbr: d.get("teamAbbr"),
            stake: d.get("stake"),
            odds: d.get("odds"),
            potentialPayout: d.get("potentialPayout"),
            status: d.get("status"),
            tailOf: d.get("tailOf") ?? null,
            followOfName: d.get("followOfName") ?? null,
            placedAt: d.get("placedAt") ?? now,
        }));
        const report = (0, weekly_1.buildLeagueReport)({
            leagueId,
            leagueName,
            week,
            bets,
            members,
            now,
        });
        tx.set(ref.collection("reports").doc(week), report);
        tx.set(ref.collection("activity").doc(`report_${week}`), {
            type: "weekly_report",
            uid: league.get("creatorId"),
            name: leagueName,
            amount: 0,
            reactions: {},
            reactors: {},
            text: `Tuesday League Report for ${week} is out (${report.cards.length} highlights)`,
            at: now,
        });
        const topHeadline = report.cards[0]?.headline ?? `${report.totalBets} bets graded this week.`;
        for (const m of members) {
            (0, notify_1.writeNotification)(tx, m.uid, (0, notifyModel_1.simpleNotification)({
                id: `report_${leagueId}_${week}`,
                type: "league_report",
                title: `Tuesday League Report · ${leagueName}`,
                body: topHeadline,
                wallet: "league",
                leagueId,
                leagueName,
                now,
                popup: true,
                data: { leagueId, week },
            }));
        }
        return report;
    });
}
/**
 * Closes the currently open weekly head-to-head matchup week (`openMatchupWeek`)
 * on a league, updating each member's `h2h` (`{ w, l, t }`) record and awarding
 * a championship trophy if the closed matchup was a playoff final.
 */
async function closeMatchups(leagueId, now = Date.now()) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        if (!league.exists)
            return [];
        const openWeek = league.get("openMatchupWeek");
        if (!openWeek)
            return [];
        const matchupRef = ref.collection("matchups").doc(openWeek);
        const [matchupSnap, loansSnap] = await Promise.all([
            tx.get(matchupRef),
            tx.get(ref.collection("loans")),
        ]);
        if (!matchupSnap.exists || matchupSnap.get("status") === "closed") {
            tx.update(ref, { openMatchupWeek: null });
            return matchupSnap.get("pairs") ?? [];
        }
        const membersMap = league.get("members") ?? {};
        const loans = loanListFrom(loansSnap.docs);
        const netWorthOf = (uid) => {
            const m = membersMap[uid];
            return m ? (0, loanMath_1.balanceSheet)(uid, m.leagueTokens, loans, now).netWorth : 0;
        };
        const pairs = matchupSnap.get("pairs") ?? [];
        const leagueUpdate = {
            openMatchupWeek: null,
            lastActivityAt: now,
        };
        const gradedPairs = pairs.map((p) => {
            const aEnd = netWorthOf(p.aUid);
            const bEnd = netWorthOf(p.bUid);
            const aDelta = aEnd - p.aStartNetWorth;
            const bDelta = bEnd - p.bStartNetWorth;
            const winnerUid = aDelta > bDelta ? p.aUid : bDelta > aDelta ? p.bUid : "tie";
            if (membersMap[p.aUid] && membersMap[p.bUid]) {
                if (winnerUid === p.aUid) {
                    leagueUpdate[`members.${p.aUid}.h2h.w`] = economy_1.FieldValue.increment(1);
                    leagueUpdate[`members.${p.bUid}.h2h.l`] = economy_1.FieldValue.increment(1);
                }
                else if (winnerUid === p.bUid) {
                    leagueUpdate[`members.${p.bUid}.h2h.w`] = economy_1.FieldValue.increment(1);
                    leagueUpdate[`members.${p.aUid}.h2h.l`] = economy_1.FieldValue.increment(1);
                }
                else {
                    leagueUpdate[`members.${p.aUid}.h2h.t`] = economy_1.FieldValue.increment(1);
                    leagueUpdate[`members.${p.bUid}.h2h.t`] = economy_1.FieldValue.increment(1);
                }
            }
            if (p.bracket === "playoff" && winnerUid !== "tie") {
                const champName = winnerUid === p.aUid ? p.aName : p.bName;
                const leagueName = league.get("name") ?? "League";
                tx.set(economy_1.db.collection("users").doc(winnerUid).collection("trophies").doc(`h2h_${leagueId}_${openWeek}`), {
                    id: `h2h_${leagueId}_${openWeek}`,
                    kind: "h2h_champion",
                    title: `${leagueName} H2H Playoff Winner`,
                    leagueId,
                    leagueName,
                    week: openWeek,
                    awardedAt: now,
                }, { merge: true });
                tx.set(ref.collection("activity").doc(`h2h_champ_${openWeek}`), {
                    type: "matchup_won",
                    uid: winnerUid,
                    name: champName,
                    amount: 0,
                    reactions: {},
                    reactors: {},
                    text: `${champName} won the head-to-head playoff bracket!`,
                    at: now,
                });
            }
            return {
                ...p,
                aEndNetWorth: aEnd,
                bEndNetWorth: bEnd,
                aDelta,
                bDelta,
                winnerUid,
            };
        });
        tx.update(matchupRef, {
            status: "closed",
            pairs: gradedPairs,
            closedAt: now,
        });
        tx.update(ref, leagueUpdate);
        return gradedPairs;
    });
}
/**
 * Opens a new week of head-to-head matchups (`leagues/{id}/matchups/{week}`).
 * Uses round-robin pairings during the regular season and top-seed playoff
 * pairings in the final week of the season.
 */
async function openWeekMatchups(leagueId, now = Date.now(), explicitWeek) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    const week = explicitWeek ?? (0, weekly_1.weekKey)(now);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, existing, matchupsSnap, loansSnap] = await Promise.all([
            tx.get(ref),
            tx.get(ref.collection("matchups").doc(week)),
            tx.get(ref.collection("matchups")),
            tx.get(ref.collection("loans")),
        ]);
        if (!league.exists || league.get("status") !== "active")
            return [];
        if (existing.exists)
            return existing.get("pairs") ?? [];
        const membersMap = league.get("members") ?? {};
        const loans = loanListFrom(loansSnap.docs);
        const seeds = Object.values(membersMap).map((m) => ({
            uid: m.uid,
            displayName: m.displayName,
            netWorth: (0, loanMath_1.balanceSheet)(m.uid, m.leagueTokens, loans, now).netWorth,
            w: m.h2h?.w ?? 0,
            l: m.h2h?.l ?? 0,
            t: m.h2h?.t ?? 0,
        }));
        if (seeds.length < 2)
            return [];
        const weekIndex = matchupsSnap.size;
        const cadence = league.get("matchupCadence") ?? "weekly";
        const periodDays = leagueConfig_1.CADENCE_DAYS[cadence];
        const endsAt = league.get("endsAt") ?? 0;
        const createdAt = league.get("createdAt") ?? now;
        const totalPeriods = endsAt > createdAt
            ? Math.max(2, Math.floor((endsAt - createdAt) / (periodDays * 86_400_000)))
            : (league.get("durationWeeks") ?? 4);
        // The last period that fits before the season ends is the playoff round.
        const isFinalWeek = weekIndex >= totalPeriods - 1 ||
            (endsAt > 0 && endsAt - now <= (periodDays + 1) * 86_400_000 && weekIndex >= 1);
        const pairs = isFinalWeek
            ? (0, weekly_1.playoffPairs)(seeds)
            : (0, weekly_1.roundRobinPairs)(seeds, weekIndex);
        tx.set(ref.collection("matchups").doc(week), {
            week,
            weekNumber: weekIndex + 1,
            isPlayoff: isFinalWeek,
            status: "open",
            pairs,
            openedAt: now,
            closedAt: null,
        });
        tx.update(ref, {
            openMatchupWeek: week,
            matchupsEnabled: true,
            lastActivityAt: now,
        });
        return pairs;
    });
}
/**
 * Eliminates survivor players who missed making a pick in a completed week
 * that had at least one pick placed in the league.
 */
async function sweepMissedSurvivorWeek(leagueId, completedWeek, now = Date.now()) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, picksSnap] = await Promise.all([
            tx.get(ref),
            tx.get(ref.collection("picks").where("week", "==", completedWeek)),
        ]);
        if (!league.exists || league.get("status") !== "active")
            return 0;
        if (league.get("mode") !== "survivor")
            return 0;
        if (picksSnap.empty)
            return 0;
        const pickedUids = new Set(picksSnap.docs.map((d) => d.get("uid")));
        const membersMap = league.get("members") ?? {};
        const update = {};
        let knockedOut = 0;
        for (const [uid, m] of Object.entries(membersMap)) {
            if (m.eliminated || pickedUids.has(uid))
                continue;
            update[`members.${uid}.eliminated`] = true;
            update[`members.${uid}.eliminatedAt`] = now;
            update[`members.${uid}.eliminatedWeek`] = completedWeek;
            knockedOut++;
        }
        if (knockedOut > 0) {
            update.lastActivityAt = now;
            tx.update(ref, update);
        }
        return knockedOut;
    });
}
exports.tuesdayLeagueReport = (0, scheduler_1.onSchedule)({ schedule: "0 9 * * 2", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const now = Date.now();
    const active = await economy_1.db.collection("leagues").where("status", "==", "active").limit(200).get();
    let count = 0;
    for (const d of active.docs) {
        try {
            const rep = await generateTuesdayReport(d.id, now);
            if (rep)
                count++;
        }
        catch (err) {
            firebase_functions_1.logger.error("tuesdayLeagueReport failed", { leagueId: d.id, err });
        }
    }
    if (count > 0)
        firebase_functions_1.logger.info("tuesdayLeagueReport complete", { count });
});
/**
 * Turns head-to-head periods over every morning: closes the open period once
 * it's over, and opens the next on its first day (Mondays for weekly leagues,
 * Mondays and Thursdays for twice-weekly, every day for daily).
 */
exports.leagueMatchupJobs = (0, scheduler_1.onSchedule)({ schedule: "0 9 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const now = Date.now();
    const active = await economy_1.db.collection("leagues").where("status", "==", "active").limit(500).get();
    for (const d of active.docs) {
        try {
            const cadence = d.get("matchupCadence") ?? "weekly";
            const key = (0, weekly_1.matchupPeriodKey)(cadence, now);
            const open = d.get("openMatchupWeek");
            if (open && open !== key)
                await closeMatchups(d.id, now);
            if (d.get("matchupsEnabled") && open !== key && (0, weekly_1.isPeriodStart)(cadence, now)) {
                await openWeekMatchups(d.id, now, key);
            }
        }
        catch (err) {
            firebase_functions_1.logger.error("leagueMatchupJobs failed", { leagueId: d.id, err });
        }
    }
});
exports.mondayLeagueJobs = (0, scheduler_1.onSchedule)({ schedule: "0 9 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 }, async () => {
    const now = Date.now();
    const prevWeek = (0, weekly_1.weekKey)(now - 2 * 86_400_000);
    const active = await economy_1.db.collection("leagues").where("status", "==", "active").limit(200).get();
    for (const d of active.docs) {
        try {
            // Head-to-head periods turn over in leagueMatchupJobs.
            if (d.get("mode") === "survivor") {
                await sweepMissedSurvivorWeek(d.id, prevWeek, now);
            }
        }
        catch (err) {
            firebase_functions_1.logger.error("mondayLeagueJobs failed", { leagueId: d.id, err });
        }
    }
});
//# sourceMappingURL=weekly.js.map
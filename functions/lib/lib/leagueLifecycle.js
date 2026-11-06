"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeLeague = finalizeLeague;
exports.payoutLeague = payoutLeague;
const https_1 = require("firebase-functions/v2/https");
const wrapped_1 = require("./wrapped");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
const loanMath_1 = require("./loanMath");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
const awards_1 = require("./awards");
/**
 * Ends a league exactly once.
 *
 *  - open league bets and open group parlays are voided and their stakes
 *    returned, so nobody is ranked with tokens stuck in a bet that can no
 *    longer pay
 *  - standings rank on net worth (or pickPoints in pick'em, survival in
 *    survivor) as of the season end, using the same flat-interest math as the
 *    client, and tied places split their combined prize equally
 *  - the pot split is recorded with `paid: false`; payoutLeague moves the
 *    real credits, one idempotent transaction per winner
 *  - awards champion trophies and last-place punishments
 *
 * Safe to call repeatedly: an ended league returns its stored results.
 */
async function finalizeLeague(leagueId, now) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    let leagueName = "League";
    let freshEnd = false;
    const results = await economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        leagueName = league.get("name") ?? "League";
        if (league.get("status") === "ended")
            return league.get("results") ?? [];
        const [bets, loans, parlays] = await Promise.all([
            tx.get(ref.collection("leagueBets").where("status", "==", "pending")),
            tx.get(ref.collection("loans")),
            tx.get(ref.collection("parlays").where("status", "in", ["open", "locked"])),
        ]);
        const members = Object.values(league.get("members") ?? {});
        const tokens = new Map(members.map((m) => [m.uid, m.leagueTokens]));
        for (const b of bets.docs) {
            const uid = b.get("uid");
            if (tokens.has(uid))
                tokens.set(uid, tokens.get(uid) + b.get("stake"));
            tx.update(b.ref, { status: "cancelled", voidReason: "league_ended", settledAt: economy_1.FieldValue.serverTimestamp() });
        }
        for (const p of parlays.docs) {
            const riders = p.get("riders") ?? {};
            for (const [uid, r] of Object.entries(riders)) {
                if (tokens.has(uid))
                    tokens.set(uid, tokens.get(uid) + (r.stake ?? 0));
            }
            tx.update(p.ref, { status: "void", voidReason: "league_ended", settledAt: now });
        }
        const asOf = Math.min(now, league.get("endsAt") ?? now);
        const loanList = loans.docs.map((d) => ({
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
        const mode = league.get("mode") ?? "bankroll";
        const baseStandings = (0, loanMath_1.rankMembers)(members.map((m) => ({ uid: m.uid, leagueTokens: tokens.get(m.uid) ?? m.leagueTokens, joinedAt: m.joinedAt })), loanList, asOf);
        const byId = new Map(members.map((m) => [m.uid, m]));
        const standings = mode === "pickem" || mode === "bracket"
            ? [...baseStandings]
                .map((s) => ({ ...s, netWorth: byId.get(s.uid)?.pickPoints ?? 0 }))
                .sort((a, b) => b.netWorth - a.netWorth || (a.uid < b.uid ? -1 : 1))
            : mode === "survivor"
                ? [...baseStandings]
                    .map((s) => {
                    const m = byId.get(s.uid);
                    const score = m?.eliminated ? (m.eliminatedAt ?? 0) : Number.MAX_SAFE_INTEGER;
                    return { ...s, netWorth: score };
                })
                    .sort((a, b) => b.netWorth - a.netWorth || (a.uid < b.uid ? -1 : 1))
                : mode === "matchups"
                    ? // Head-to-head record (2 per win, 1 per tie), net worth breaks ties.
                        [...baseStandings]
                            .map((s) => {
                            const h = byId.get(s.uid)?.h2h;
                            return { ...s, tieKey: ((h?.w ?? 0) * 2 + (h?.t ?? 0)) * 1e12 + s.netWorth };
                        })
                            .sort((a, b) => b.tieKey - a.tieKey || (a.uid < b.uid ? -1 : 1))
                    : baseStandings;
        const rankKey = (s) => ("tieKey" in s ? s.tieKey : s.netWorth);
        const pot = league.get("pot") ?? 0;
        const netWorths = standings.map(rankKey);
        const prizes = (0, loanMath_1.prizeSplit)(pot, league.get("prizeDistribution"), standings.length, netWorths);
        let currentRank = 1;
        const out = standings.map((s, i) => {
            if (i > 0 && rankKey(standings[i - 1]) !== rankKey(s)) {
                currentRank = i + 1;
            }
            return {
                rank: currentRank,
                memberId: s.uid,
                memberName: byId.get(s.uid)?.displayName ?? "Player",
                memberColor: byId.get(s.uid)?.avatarColor ?? "#8FA098",
                leagueTokens: s.tokens,
                debt: s.debt,
                receivable: s.receivable,
                netWorth: s.netWorth,
                prizeTokens: prizes[i] ?? 0,
                paid: false,
            };
        });
        const update = {
            status: "ended",
            endedAt: now,
            results: out,
            payoutStatus: out.some((r) => r.prizeTokens > 0) ? "pending" : "none",
            lastActivityAt: now,
        };
        for (const [uid, t] of tokens)
            update[`members.${uid}.leagueTokens`] = t;
        tx.update(ref, update);
        tx.set(ref.collection("activity").doc("ended"), {
            type: "ended",
            uid: out[0]?.memberId ?? "",
            name: out[0]?.memberName ?? "",
            amount: out[0]?.prizeTokens ?? 0,
            text: out[0] ? `Season over — ${out[0].memberName} wins ${leagueName}` : "Season over",
            at: now,
        });
        for (const r of out) {
            if (r.prizeTokens > 0)
                continue; // winners hear about it from the payout
            (0, notify_1.writeNotification)(tx, r.memberId, (0, notifyModel_1.simpleNotification)({
                id: `ended_${leagueId}`,
                type: "league_ended",
                title: `${leagueName} is over`,
                body: `You finished #${r.rank} of ${out.length} with a net worth of ${r.netWorth.toLocaleString("en-US")}.`,
                leagueId,
                leagueName,
                now,
                popup: true,
            }));
        }
        freshEnd = true;
        return out;
    });
    if (freshEnd && results.length > 0) {
        await (0, awards_1.applySeasonAwards)(leagueId, leagueName, results, now);
        // Drip Wrapped for the season; a failure never blocks the league end.
        await (0, wrapped_1.generateLeagueWrapped)(leagueId, now).catch((err) => firebase_functions_1.logger.warn("wrapped failed", { leagueId, error: String(err) }));
    }
    return results;
}
/**
 * Pays the pot. One transaction per winner, keyed on the league and the
 * member, so a crash halfway through resumes without double-paying.
 */
async function payoutLeague(leagueId) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    const snap = await ref.get();
    const results = snap.get("results") ?? [];
    let paid = 0;
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.prizeTokens <= 0 || r.paid)
            continue;
        try {
            await economy_1.db.runTransaction(async (tx) => {
                const league = await tx.get(ref);
                const current = league.get("results") ?? [];
                const row = current[i];
                if (!row || row.paid || row.memberId !== r.memberId)
                    return;
                const balance = await (0, economy_1.applyCredits)(tx, r.memberId, {
                    delta: r.prizeTokens,
                    type: "league_payout",
                    idempotencyKey: `league_payout_${leagueId}_${r.memberId}`,
                    ref: leagueId,
                    note: `#${r.rank} in ${league.get("name")}`,
                });
                const next = current.map((x, j) => (j === i ? { ...x, paid: true } : x));
                tx.update(ref, {
                    results: next,
                    payoutStatus: next.every((x) => x.prizeTokens <= 0 || x.paid) ? "paid" : "pending",
                });
                (0, notify_1.writeNotification)(tx, r.memberId, (0, notifyModel_1.simpleNotification)({
                    id: `payout_${leagueId}`,
                    type: "league_payout",
                    title: r.rank === 1 ? `You won ${league.get("name")}!` : `#${r.rank} in ${league.get("name")}`,
                    body: `+${r.prizeTokens.toLocaleString("en-US")} credits from the pot.`,
                    delta: r.prizeTokens,
                    balanceAfter: balance,
                    wallet: "credits",
                    leagueId,
                    leagueName: league.get("name"),
                    now: Date.now(),
                    popup: true,
                }));
                paid++;
            });
        }
        catch (err) {
            firebase_functions_1.logger.error("league payout failed", { leagueId, memberId: r.memberId, err });
        }
    }
    return paid;
}
//# sourceMappingURL=leagueLifecycle.js.map
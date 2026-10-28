"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeLeague = finalizeLeague;
exports.payoutLeague = payoutLeague;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("./economy");
const loanMath_1 = require("./loanMath");
const notify_1 = require("./notify");
const notifyModel_1 = require("./notifyModel");
/**
 * Ends a league exactly once.
 *
 *  - open league bets are voided and their stakes returned, so nobody is
 *    ranked with tokens stuck in a bet that can no longer pay
 *  - standings rank on net worth (tokens + money owed to you − money you owe)
 *    as of the season end, using the same flat-interest math as the client
 *  - the pot split is recorded with `paid: false`; payoutLeague moves the
 *    real credits, one idempotent transaction per winner
 *
 * Safe to call repeatedly: an ended league returns its stored results.
 */
async function finalizeLeague(leagueId, now) {
    const ref = economy_1.db.collection("leagues").doc(leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        if (league.get("status") === "ended")
            return league.get("results") ?? [];
        const [bets, loans] = await Promise.all([
            tx.get(ref.collection("leagueBets").where("status", "==", "pending")),
            tx.get(ref.collection("loans")),
        ]);
        const members = Object.values(league.get("members") ?? {});
        const tokens = new Map(members.map((m) => [m.uid, m.leagueTokens]));
        for (const b of bets.docs) {
            const uid = b.get("uid");
            if (tokens.has(uid))
                tokens.set(uid, tokens.get(uid) + b.get("stake"));
            tx.update(b.ref, { status: "cancelled", voidReason: "league_ended", settledAt: economy_1.FieldValue.serverTimestamp() });
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
        const standings = (0, loanMath_1.rankMembers)(members.map((m) => ({ uid: m.uid, leagueTokens: tokens.get(m.uid) ?? m.leagueTokens, joinedAt: m.joinedAt })), loanList, asOf);
        const pot = league.get("pot") ?? 0;
        const prizes = (0, loanMath_1.prizeSplit)(pot, league.get("prizeDistribution"), standings.length);
        const byId = new Map(members.map((m) => [m.uid, m]));
        const results = standings.map((s, i) => ({
            rank: s.rank,
            memberId: s.uid,
            memberName: byId.get(s.uid)?.displayName ?? "Player",
            memberColor: byId.get(s.uid)?.avatarColor ?? "#8FA098",
            leagueTokens: s.tokens,
            debt: s.debt,
            receivable: s.receivable,
            netWorth: s.netWorth,
            prizeTokens: prizes[i] ?? 0,
            paid: false,
        }));
        const update = {
            status: "ended",
            endedAt: now,
            results,
            payoutStatus: results.some((r) => r.prizeTokens > 0) ? "pending" : "none",
            lastActivityAt: now,
        };
        for (const [uid, t] of tokens)
            update[`members.${uid}.leagueTokens`] = t;
        tx.update(ref, update);
        const name = league.get("name");
        tx.set(ref.collection("activity").doc("ended"), {
            type: "ended",
            uid: results[0]?.memberId ?? "",
            name: results[0]?.memberName ?? "",
            amount: results[0]?.prizeTokens ?? 0,
            text: results[0] ? `Season over — ${results[0].memberName} wins ${name}` : "Season over",
            at: now,
        });
        for (const r of results) {
            if (r.prizeTokens > 0)
                continue; // winners hear about it from the payout
            (0, notify_1.writeNotification)(tx, r.memberId, (0, notifyModel_1.simpleNotification)({
                id: `ended_${leagueId}`,
                type: "league_ended",
                title: `${name} is over`,
                body: `You finished #${r.rank} of ${results.length} with a net worth of ${r.netWorth.toLocaleString("en-US")}.`,
                leagueId,
                leagueName: name,
                now,
                popup: true,
            }));
        }
        return results;
    });
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
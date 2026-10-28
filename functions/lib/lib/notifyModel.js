"use strict";
/**
 * Shape of users/{uid}/notifications/{id}. Pure — no Firestore imports — so
 * the builders can be unit tested.
 *
 * Every notification that reports money moving is written *inside the same
 * transaction* that moved it, under a deterministic id derived from the thing
 * that happened (`settle_<betId>`, `payout_<leagueId>`, ...). Replaying a
 * settlement therefore re-writes the same document instead of creating a
 * second one, and a notification can never exist for a payout that didn't
 * commit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.betNotificationId = betNotificationId;
exports.betResultNotification = betResultNotification;
exports.simpleNotification = simpleNotification;
function betNotificationId(betId, leagueId) {
    return leagueId ? `lsettle_${leagueId}_${betId}` : `settle_${betId}`;
}
function betResultNotification(args) {
    const { outcome, bet } = args;
    const unit = args.wallet === "league" ? "league tokens" : "credits";
    const where = args.leagueName ? ` in ${args.leagueName}` : "";
    const score = bet.finalHomeScore !== null && bet.finalAwayScore !== null
        ? ` (${bet.side === "home" ? bet.finalHomeScore : bet.finalAwayScore}–${bet.side === "home" ? bet.finalAwayScore : bet.finalHomeScore})`
        : "";
    let type;
    let title;
    let body;
    let delta;
    switch (outcome) {
        case "won":
            type = "bet_won";
            delta = bet.payout;
            title = `${bet.teamAbbr} came through`;
            body = `${bet.teamName} beat ${bet.opponentAbbr}${score}. +${bet.payout.toLocaleString("en-US")} ${unit}${where}.`;
            break;
        case "lost":
            type = "bet_lost";
            delta = -bet.stake;
            title = `${bet.teamAbbr} fell short`;
            body = `${bet.teamName} lost to ${bet.opponentAbbr}${score}. ${bet.stake.toLocaleString("en-US")} ${unit} staked${where}.`;
            break;
        case "push":
            type = "bet_push";
            delta = bet.stake;
            title = "Draw — stake returned";
            body = `${bet.teamName} vs ${bet.opponentAbbr} ended level${score}. ${bet.stake.toLocaleString("en-US")} ${unit} back${where}.`;
            break;
        default:
            type = "bet_refunded";
            delta = bet.stake;
            title = "Bet refunded";
            body = `${bet.teamName} vs ${bet.opponentAbbr} didn't go ahead. ${bet.stake.toLocaleString("en-US")} ${unit} back${where}.`;
    }
    return {
        id: betNotificationId(bet.betId, args.leagueId),
        type,
        title,
        body,
        delta,
        balanceAfter: args.balanceAfter,
        wallet: args.wallet,
        leagueId: args.leagueId ?? null,
        leagueName: args.leagueName ?? null,
        bet,
        popup: outcome === "won" || outcome === "lost",
        read: false,
        createdAtMs: args.now,
        data: null,
    };
}
function simpleNotification(args) {
    return {
        id: args.id,
        type: args.type,
        title: args.title,
        body: args.body,
        delta: args.delta ?? 0,
        balanceAfter: args.balanceAfter ?? null,
        wallet: args.wallet ?? "credits",
        leagueId: args.leagueId ?? null,
        leagueName: args.leagueName ?? null,
        bet: null,
        popup: args.popup ?? false,
        read: false,
        createdAtMs: args.now,
        data: args.data ?? null,
    };
}
//# sourceMappingURL=notifyModel.js.map
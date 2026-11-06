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
exports.notificationRoute = notificationRoute;
exports.followNotification = followNotification;
exports.simpleNotification = simpleNotification;
exports.challengeResultNotification = challengeResultNotification;
function betNotificationId(betId, leagueId) {
    return leagueId ? `lsettle_${leagueId}_${betId}` : `settle_${betId}`;
}
function betResultNotification(args) {
    const { outcome, bet } = args;
    const unit = args.wallet === "league" ? "league tokens" : "credits";
    const where = args.leagueName ? ` in ${args.leagueName}` : "";
    const pickLabel = bet.label || bet.teamAbbr;
    const score = bet.finalHomeScore !== null && bet.finalAwayScore !== null
        ? ` (${bet.side === "away" ? bet.finalAwayScore : bet.finalHomeScore}–${bet.side === "away" ? bet.finalHomeScore : bet.finalAwayScore})`
        : "";
    let type;
    let title;
    let body;
    let delta;
    switch (outcome) {
        case "won":
            type = "bet_won";
            delta = bet.payout;
            title = `${pickLabel} came through`;
            body = `${bet.teamName} vs ${bet.opponentAbbr}${score}. +${bet.payout.toLocaleString("en-US")} ${unit}${where}.`;
            break;
        case "lost":
            type = "bet_lost";
            delta = -bet.stake;
            title = `${pickLabel} fell short`;
            body = `${bet.teamName} vs ${bet.opponentAbbr}${score}. ${bet.stake.toLocaleString("en-US")} ${unit} staked${where}.`;
            break;
        case "push":
            type = "bet_push";
            delta = bet.stake;
            title = "Push — stake returned";
            body = `${bet.teamName} vs ${bet.opponentAbbr} landed on the number${score}. ${bet.stake.toLocaleString("en-US")} ${unit} back${where}.`;
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
/**
 * In-app route a notification opens (push tap, feed row). Paths are
 * expo-router hrefs; the client pushes them as-is.
 */
function notificationRoute(n) {
    const league = n.leagueId ? `/league/${encodeURIComponent(n.leagueId)}` : null;
    switch (n.type) {
        case "league_invite":
            return n.data?.code ? `/join/${encodeURIComponent(n.data.code)}` : "/(tabs)/leagues";
        case "league_report":
            return league ? `${league}/recap${n.data?.week ? `?week=${encodeURIComponent(n.data.week)}` : ""}` : "/(tabs)/leagues";
        case "lock_reminder":
        case "team_reminder":
        case "sweat_alert":
        case "clutch_alert":
            return n.data?.gameId ? `/game/${encodeURIComponent(n.data.gameId)}` : league ?? "/(tabs)/games";
        case "bet_won":
        case "bet_lost":
        case "bet_push":
        case "bet_refunded":
        case "bet_voided":
        case "dispute_reported":
            return n.wallet === "league" && league ? `${league}?tab=bets` : "/bets";
        case "reaction":
            if (!league)
                return "/messages";
            return league ? (n.data?.targetType === "messages" ? `/messages?leagueId=${encodeURIComponent(n.leagueId)}` : `${league}?tab=bets`) : "/(tabs)/leagues";
        case "bet_tailed":
        case "bet_faded":
            return league ? `${league}?tab=bets` : "/(tabs)/leagues";
        case "credits_received":
            return n.data?.fromUid ? `/messages?uid=${encodeURIComponent(n.data.fromUid)}&name=${encodeURIComponent(n.data.fromName ?? "")}` : "/messages";
        case "loan_funded":
        case "loan_repaid":
        case "loan_countered":
        case "loan_request":
            // Friend loans (no league) live in the DM thread.
            if (!league && n.data?.fromUid)
                return `/messages?uid=${encodeURIComponent(n.data.fromUid)}&name=${encodeURIComponent(n.data.fromName ?? "")}`;
            return league ? `${league}?tab=bank` : "/(tabs)/leagues";
        case "margin_call":
        case "stimulus_request":
        case "stimulus_approved":
            return league ? `${league}?tab=bank` : "/(tabs)/leagues";
        case "league_payout":
        case "league_ended":
            return league ?? "/(tabs)/leagues";
        case "friend_request":
        case "friend_accepted":
        case "referral_bonus":
            return "/(tabs)/friends";
        case "achievement":
        case "gift_received":
            return "/(tabs)/avatar";
        case "win_back":
            return "/(tabs)";
        case "level_up":
            return "/levels";
        default:
            return n.type.startsWith("challenge_") ? "/challenges" : "/activity";
    }
}
/** Another member tailed or faded your league bet. Written in the same transaction as their bet. */
function followNotification(args) {
    const amount = args.stake.toLocaleString("en-US");
    return simpleNotification({
        id: `${args.kind}_${args.followerBetId}`,
        type: args.kind === "tail" ? "bet_tailed" : "bet_faded",
        title: args.kind === "tail"
            ? `${args.followerName} tailed your ${args.sourceTeamAbbr} pick`
            : `${args.followerName} is fading you`,
        body: args.kind === "tail"
            ? `They put ${amount} on ${args.sourceTeamAbbr} with you in ${args.leagueName}.`
            : `They put ${amount} on ${args.followerTeamAbbr} against your ${args.sourceTeamAbbr} pick in ${args.leagueName}.`,
        now: args.now,
        wallet: "league",
        leagueId: args.leagueId,
        leagueName: args.leagueName,
        data: { betId: args.sourceBetId, followerBetId: args.followerBetId, gameId: args.gameId },
    });
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
/**
 * A settled head-to-head, from one player's side. `bet` is filled in from that
 * player's point of view (their team, their stake, the whole pot as the
 * payout), so the existing result popup and recap render it unchanged.
 */
function challengeResultNotification(args) {
    const { result, bet, friendName } = args;
    const score = bet.finalHomeScore !== null && bet.finalAwayScore !== null
        ? ` (${bet.side === "home" ? bet.finalHomeScore : bet.finalAwayScore}–${bet.side === "home" ? bet.finalAwayScore : bet.finalHomeScore})`
        : "";
    const pot = bet.payout.toLocaleString("en-US");
    let type;
    let title;
    let body;
    let delta;
    switch (result) {
        case "won":
            type = "challenge_won";
            delta = bet.payout;
            title = `You beat ${friendName}`;
            body = `${bet.teamName} beat ${bet.opponentAbbr}${score}. The ${pot}-credit pot is yours.`;
            break;
        case "lost":
            type = "challenge_lost";
            delta = -bet.stake;
            title = `${friendName} takes the pot`;
            body = `${bet.teamName} lost to ${bet.opponentAbbr}${score}. Your ${bet.stake.toLocaleString("en-US")} went to ${friendName}.`;
            break;
        case "push":
            type = "challenge_push";
            delta = bet.stake;
            title = `Draw with ${friendName}`;
            body = `${bet.teamName} vs ${bet.opponentAbbr} ended level${score}. Your ${bet.stake.toLocaleString("en-US")} is back.`;
            break;
        default:
            type = "challenge_refunded";
            delta = bet.stake;
            title = "Challenge called off";
            body = `${bet.teamName} vs ${bet.opponentAbbr} didn't go ahead. Your ${bet.stake.toLocaleString("en-US")} is back.`;
    }
    return {
        id: `chsettle_${args.challengeId}`,
        type,
        title,
        body,
        delta,
        balanceAfter: args.balanceAfter,
        wallet: "credits",
        leagueId: null,
        leagueName: null,
        bet,
        popup: result === "won" || result === "lost",
        read: false,
        createdAtMs: args.now,
        data: { challengeId: args.challengeId, friendName, ...(args.friendUid ? { friendUid: args.friendUid } : {}) },
    };
}
//# sourceMappingURL=notifyModel.js.map
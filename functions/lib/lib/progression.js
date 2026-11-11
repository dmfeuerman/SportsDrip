"use strict";
/**
 * Player levels. Pure — no Firestore — so the curve can be unit tested and
 * mirrored in the app (artifacts/mobile/constants/progression.ts; a functions
 * test keeps the two in step).
 *
 *  users/{uid}.xp      lifetime XP (server-written only)
 *  users/{uid}.level   levelFromXp(xp), stored for queries and other players' views
 *
 * XP is earned for winning, buying things and social milestones. Every grant
 * goes through grantXp (lib/xp.ts) under an idempotency key, so a replayed
 * trigger never pays twice.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERRAL_CODE_LENGTH = exports.REFERRAL_ALPHABET = exports.REFERRAL = exports.XP = exports.MAX_LEVEL = void 0;
exports.xpForNext = xpForNext;
exports.totalXpForLevel = totalXpForLevel;
exports.levelFromXp = levelFromXp;
exports.progressOf = progressOf;
exports.levelUpCredits = levelUpCredits;
exports.xpMultiplier = xpMultiplier;
exports.scaledXp = scaledXp;
exports.xpForLedger = xpForLedger;
exports.normalizeReferralCode = normalizeReferralCode;
exports.randomReferralCode = randomReferralCode;
exports.MAX_LEVEL = 50;
/** XP needed to go from `level` to `level + 1`: 250, 350, 450, … */
function xpForNext(level) {
    return level >= exports.MAX_LEVEL ? 0 : 150 + 100 * level;
}
/** Lifetime XP at which `level` is reached (level 1 = 0). */
function totalXpForLevel(level) {
    const l = Math.max(1, Math.min(exports.MAX_LEVEL, Math.floor(level)));
    const n = l - 1;
    return 150 * n + 50 * n * l;
}
function levelFromXp(xp) {
    const v = typeof xp === "number" && Number.isFinite(xp) && xp > 0 ? xp : 0;
    let lo = 1;
    let hi = exports.MAX_LEVEL;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (totalXpForLevel(mid) <= v)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
function progressOf(xp) {
    const v = typeof xp === "number" && Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
    const level = levelFromXp(v);
    const maxed = level >= exports.MAX_LEVEL;
    const needed = xpForNext(level);
    const into = v - totalXpForLevel(level);
    return { level, xp: v, into: maxed ? 0 : into, needed, pct: maxed ? 1 : Math.min(1, into / needed), maxed };
}
/** Credits paid on reaching `level`. */
function levelUpCredits(level) {
    return level <= 1 ? 0 : 50 * level;
}
exports.XP = {
    /** Credit bet won: base, plus 1 XP per 100 credits of profit up to the cap. */
    betWin: 40,
    betWinProfitPer: 100,
    betWinBonusCap: 60,
    challengeWin: 50,
    leagueBetWin: 30,
    leaguePayout: 200,
    /** Purchases: 1 XP per 50 credits spent, clamped. */
    purchasePer: 50,
    purchaseMin: 15,
    purchaseMax: 400,
    prizeBox: 10,
    adReward: 5,
    /** First change of the app color in Settings (functions/src/lib/levelChallenges.ts x_theme). */
    themeChange: 20,
    newFriend: 25,
    /** Someone joined with your invite code. */
    referrer: 300,
    /** You joined with an invite code. */
    referred: 100,
};
/**
 * XP rewards grow with your level: every level you complete raises what each
 * action is worth by 10% of its base (level 1 = 1x, level 11 = 2x).
 */
function xpMultiplier(level) {
    const l = Math.max(1, Math.min(exports.MAX_LEVEL, Math.floor(level)));
    return 1 + 0.1 * (l - 1);
}
/** Base XP scaled to the player's current level. */
function scaledXp(base, level) {
    return base > 0 ? Math.round(base * xpMultiplier(level)) : 0;
}
/**
 * XP for a ledger row (users/{uid}/ledger/*). Stakes and refunds earn nothing,
 * so placing and cancelling a bet can't farm levels.
 */
function xpForLedger(type, delta, stake) {
    const d = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
    switch (type) {
        case "bet_payout": {
            const s = typeof stake === "number" && Number.isFinite(stake) ? stake : 0;
            const profit = Math.max(0, d - s);
            return exports.XP.betWin + Math.min(exports.XP.betWinBonusCap, Math.floor(profit / exports.XP.betWinProfitPer));
        }
        case "challenge_payout":
            return d > 0 ? exports.XP.challengeWin : 0;
        case "league_payout":
            return d > 0 ? exports.XP.leaguePayout : 0;
        case "purchase": {
            const spent = Math.abs(Math.min(0, d));
            if (spent === 0)
                return 0;
            return Math.max(exports.XP.purchaseMin, Math.min(exports.XP.purchaseMax, Math.round(spent / exports.XP.purchasePer)));
        }
        case "prize_box":
            return d > 0 ? exports.XP.prizeBox : 0;
        case "ad_reward":
            return d > 0 ? exports.XP.adReward : 0;
        default:
            return 0;
    }
}
/** Invite-a-friend bonus. */
exports.REFERRAL = {
    /** Credits to the player whose code was used. */
    referrerCredits: 1000,
    /** Extra credits for the new player on top of the starting balance. */
    newUserCredits: 500,
    /** Referrals that pay credits; later ones still make you friends and give XP. */
    maxRewarded: 25,
};
/** Same alphabet as league codes: no 0/O/1/I. */
exports.REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
exports.REFERRAL_CODE_LENGTH = 6;
function normalizeReferralCode(raw) {
    if (typeof raw !== "string")
        return null;
    const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return clean.length >= 4 && clean.length <= 10 ? clean : null;
}
function randomReferralCode(rand = Math.random) {
    let out = "";
    for (let i = 0; i < exports.REFERRAL_CODE_LENGTH; i++)
        out += exports.REFERRAL_ALPHABET[Math.floor(rand() * exports.REFERRAL_ALPHABET.length)];
    return out;
}
//# sourceMappingURL=progression.js.map
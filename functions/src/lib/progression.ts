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

export const MAX_LEVEL = 50;

/** XP needed to go from `level` to `level + 1`: 250, 350, 450, … */
export function xpForNext(level: number): number {
  return level >= MAX_LEVEL ? 0 : 150 + 100 * level;
}

/** Lifetime XP at which `level` is reached (level 1 = 0). */
export function totalXpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const n = l - 1;
  return 150 * n + 50 * n * l;
}

export function levelFromXp(xp: unknown): number {
  const v = typeof xp === "number" && Number.isFinite(xp) && xp > 0 ? xp : 0;
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (totalXpForLevel(mid) <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level takes in total (0 at max level). */
  needed: number;
  /** 0–1 through the current level (1 at max). */
  pct: number;
  maxed: boolean;
}

export function progressOf(xp: unknown): LevelProgress {
  const v = typeof xp === "number" && Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = levelFromXp(v);
  const maxed = level >= MAX_LEVEL;
  const needed = xpForNext(level);
  const into = v - totalXpForLevel(level);
  return { level, xp: v, into: maxed ? 0 : into, needed, pct: maxed ? 1 : Math.min(1, into / needed), maxed };
}

/** Credits paid on reaching `level`. */
export function levelUpCredits(level: number): number {
  return level <= 1 ? 0 : 50 * level;
}

export const XP = {
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
  newFriend: 25,
  /** Someone joined with your invite code. */
  referrer: 300,
  /** You joined with an invite code. */
  referred: 100,
} as const;

/**
 * XP for a ledger row (users/{uid}/ledger/*). Stakes and refunds earn nothing,
 * so placing and cancelling a bet can't farm levels.
 */
export function xpForLedger(type: unknown, delta: unknown, stake?: unknown): number {
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
  switch (type) {
    case "bet_payout": {
      const s = typeof stake === "number" && Number.isFinite(stake) ? stake : 0;
      const profit = Math.max(0, d - s);
      return XP.betWin + Math.min(XP.betWinBonusCap, Math.floor(profit / XP.betWinProfitPer));
    }
    case "challenge_payout":
      return d > 0 ? XP.challengeWin : 0;
    case "league_payout":
      return d > 0 ? XP.leaguePayout : 0;
    case "purchase": {
      const spent = Math.abs(Math.min(0, d));
      if (spent === 0) return 0;
      return Math.max(XP.purchaseMin, Math.min(XP.purchaseMax, Math.round(spent / XP.purchasePer)));
    }
    case "prize_box":
      return d > 0 ? XP.prizeBox : 0;
    case "ad_reward":
      return d > 0 ? XP.adReward : 0;
    default:
      return 0;
  }
}

/** Invite-a-friend bonus. */
export const REFERRAL = {
  /** Credits to the player whose code was used. */
  referrerCredits: 1000,
  /** Extra credits for the new player on top of the starting balance. */
  newUserCredits: 500,
  /** Referrals that pay credits; later ones still make you friends and give XP. */
  maxRewarded: 25,
} as const;

/** Same alphabet as league codes: no 0/O/1/I. */
export const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 6;

export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length >= 4 && clean.length <= 10 ? clean : null;
}

export function randomReferralCode(rand: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) out += REFERRAL_ALPHABET[Math.floor(rand() * REFERRAL_ALPHABET.length)];
  return out;
}

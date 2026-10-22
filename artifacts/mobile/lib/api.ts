import { callable } from "@/lib/firebase";

import type { AvatarConfig, Slot } from "@/types/avatar";
export type { AvatarConfig, Slot } from "@/types/avatar";

export interface PublicUser {
  uid: string;
  username: string;
  displayName: string;
  avatar: AvatarConfig;
  equipped: Partial<Record<Slot, string>>;
  balance?: number;
  stats?: UserStats;
}

export interface UserStats {
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  betsPush: number;
  creditsWon: number;
  creditsStaked: number;
}

// ── profile ────────────────────────────────────────────────────────────────
export const createProfile = callable<
  { username: string; displayName: string; avatar?: AvatarConfig },
  { ok: true; username: string }
>("createProfile");

export const checkUsername = callable<
  { username: string },
  { available: boolean; reason: "invalid" | "taken" | null }
>("checkUsername");

export const updateAvatar = callable<{ avatar: AvatarConfig }, { ok: true }>("updateAvatar");

export const searchUsers = callable<{ q: string }, { results: PublicUser[] }>("searchUsers");

// ── friends ────────────────────────────────────────────────────────────────
export const sendFriendRequest = callable<
  { toUid: string },
  { ok: true; status: "sent" | "already_sent" | "accepted" }
>("sendFriendRequest");

export const respondFriendRequest = callable<
  { fromUid: string; accept: boolean },
  { ok: true; status: string }
>("respondFriendRequest");

export const removeFriend = callable<{ otherUid: string }, { ok: true }>("removeFriend");

export const listFriends = callable<Record<string, never>, { friends: PublicUser[] }>(
  "listFriends"
);

// ── betting ────────────────────────────────────────────────────────────────
export const placeBet = callable<
  {
    gameId: string;
    side: "home" | "away";
    stake: number;
    idempotencyKey: string;
    /** Decimal odds the user was shown, so a moved price fails loudly. */
    expectedOdds?: number;
    opponentUid?: string;
  },
  { ok: true; betId: string; duplicate: boolean; balance: number | null }
>("placeBet");

export const cancelBet = callable<{ betId: string }, { ok: true; balance: number | null }>(
  "cancelBet"
);

// ── shop ───────────────────────────────────────────────────────────────────
export const purchaseItem = callable<
  { itemId: string; idempotencyKey: string },
  { ok: true; balance: number | null; itemId: string }
>("purchaseItem");

export const saveAppearance = callable<
  { avatar: AvatarConfig; equipped: Partial<Record<Slot, string | null>> },
  { ok: true; avatar: AvatarConfig; equipped: Partial<Record<Slot, string>> }
>("saveAppearance");

export const equipItem = callable<{ slot: Slot; itemId: string | null }, { ok: true; removed: Slot[] }>(
  "equipItem"
);

// ── prize boxes ────────────────────────────────────────────────────────────
export type BoxTier = "bronze" | "silver" | "gold";

export const openPrizeBox = callable<
  { tier: BoxTier },
  { ok: true; state: "waiting" | "ready"; readyAt: number }
>("openPrizeBox");

export const claimPrizeBox = callable<
  { tier: BoxTier },
  { ok: true; duplicate: boolean; rewardCredits: number; balance: number | null }
>("claimPrizeBox");

export const resetPrizeBox = callable<{ tier: BoxTier }, { ok: true }>("resetPrizeBox");

// ── leagues ────────────────────────────────────────────────────────────────
// Every league mutation is a callable. The client reads leagues/{id} and its
// subcollections; it never writes them (firestore.rules denies it).
export const createLeague = callable<
  {
    idempotencyKey: string;
    name: string;
    startingLeagueTokens: number;
    duration: "1 Week" | "2 Weeks" | "1 Month" | "3 Months";
    sports: string[];
    buyIn: number;
    prizePreset: "winner-all" | "top-2" | "top-3";
    bankLoanEnabled: boolean;
    bankInterestRate: number;
    bankInterestIntervalHours: number;
  },
  { ok: true; leagueId: string; code: string; duplicate: boolean }
>("createLeague");

export const joinLeague = callable<{ code: string }, { ok: true; leagueId: string; duplicate: boolean }>(
  "joinLeague"
);

export const leaveLeague = callable<{ leagueId: string }, { ok: true }>("leaveLeague");

export const updateLeagueSettings = callable<
  { leagueId: string; bankLoanEnabled: boolean; bankInterestRate: number; bankInterestIntervalHours: number },
  { ok: true }
>("updateLeagueSettings");

export const inviteToLeague = callable<
  { leagueId: string; friendUid: string },
  { ok: true; status: "sent" | "already_member" }
>("inviteToLeague");

export const endLeague = callable<{ leagueId: string }, { ok: true }>("endLeague");

export const placeLeagueBet = callable<
  {
    leagueId: string;
    gameId: string;
    side: "home" | "away";
    stake: number;
    idempotencyKey: string;
    expectedOdds?: number;
  },
  { ok: true; betId: string; duplicate: boolean; leagueTokens: number | null }
>("placeLeagueBet");

export const takeBankLoan = callable<
  { leagueId: string; amount: number; idempotencyKey: string },
  { ok: true; loanId: string; duplicate: boolean }
>("takeBankLoan");

export const repayLoan = callable<
  { leagueId: string; loanId: string; amount: number; idempotencyKey: string },
  { ok: true; duplicate: boolean; applied: number; toInterest?: number; toPrincipal?: number; settled?: boolean; remaining?: number }
>("repayLoan");

export const requestPeerLoan = callable<
  { leagueId: string; amount: number; rate: number; message?: string; idempotencyKey: string },
  { ok: true; loanId: string; duplicate: boolean }
>("requestPeerLoan");

export type PeerLoanActionName = "fund" | "counter" | "decline" | "cancel" | "accept_counter" | "reject_counter";

export const peerLoanAction = callable<
  { leagueId: string; loanId: string; action: PeerLoanActionName; rate?: number },
  { ok: true }
>("peerLoanAction");

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Idempotency keys for every mutating call. A double-tap, a lost response, or a
 * retry after a dropped connection all reuse the same key, so the server treats
 * them as one operation (AUDIT B10).
 */
export function newIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}${rand}`;
}

/** Turns a Functions error into something worth showing a user. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? "";
  if (code.includes("unauthenticated")) return "You've been signed out. Sign in again.";
  if (code.includes("failed-precondition")) return e?.message ?? "That isn't available right now.";
  if (code.includes("already-exists")) return e?.message ?? "You've already done that.";
  if (code.includes("aborted")) return e?.message ?? "The price changed. Try again.";
  if (code.includes("permission-denied")) return e?.message ?? "You can't do that.";
  if (code.includes("not-found")) return e?.message ?? "Not found.";
  if (code.includes("resource-exhausted")) return e?.message ?? "Limit reached.";
  if (code.includes("invalid-argument")) return e?.message ?? "Check the details and try again.";
  if (code.includes("unavailable") || code.includes("deadline-exceeded"))
    return "Network problem — check your connection and try again.";
  return e?.message ?? "Something went wrong. Try again.";
}

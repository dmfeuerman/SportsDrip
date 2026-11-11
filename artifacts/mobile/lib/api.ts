import { trackEvent } from "@/lib/analytics";
import { callable } from "@/lib/firebase";

import type { AvatarConfig, Slot } from "@/types/avatar";
import type { GameInsights } from "@/types/insights";
import type { League, LeagueDuration, LeagueMode, MatchupCadence, ReactionEmoji, TrophyItem } from "@/constants/leagueTypes";
import type { Market, Selection } from "@/lib/markets";
export type { AvatarConfig, Slot } from "@/types/avatar";

export interface PublicUser {
  uid: string;
  /** Weekly ladder placement (scheduled/ladder.ts), when enrolled. */
  ladder?: { tier?: string } | null;
  username: string;
  displayName: string;
  avatar: AvatarConfig;
  equipped: Partial<Record<Slot, string>>;
  /** Dance-move loadout (constants/moves.ts). Absent on older profiles. */
  moves?: string[];
  balance?: number;
  stats?: UserStats;
  favoriteTeams?: FavoriteTeam[];
  /** Days in a row you and this friend both made a pick (listFriends only). */
  friendStreak?: { count: number; longest: number };
}

/** A team someone follows. Stored on users/{uid}.favoriteTeams (max 5). */
export interface FavoriteTeam {
  sport: "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";
  abbr: string;
  name: string;
  color: string;
}

export interface UserStats {
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  betsPush: number;
  creditsWon: number;
  creditsStaked: number;
}

export interface StreakInfo {
  count: number;
  longest: number;
  lastDay: string;
  /** Banked streak freezes (0–1); one covers a single missed day. */
  freezes?: number;
  /** A missed day without a freeze: `needed` actions on `day` restore `from` + 1. */
  repairPending?: { day: string; needed: number; done: number; from: number } | null;
}

export interface PunishmentInfo {
  itemId: string;
  slot: Slot;
  leagueId: string;
  leagueName?: string;
  expiresAt: number;
}

// ── profile ────────────────────────────────────────────────────────────────
export const createProfile = callable<
  {
    username: string;
    displayName: string;
    avatar?: AvatarConfig;
    age: number;
    /** 1–12 */
    birthMonth: number;
    acceptedTerms: true;
    phoneNumber?: string;
    /** A friend's invite code. */
    referralCode?: string;
  },
  { ok: true; username: string; referred?: boolean }
>("createProfile");

// ── account & safety (App Review 5.1.1(v), 1.2) ─────────────────────────────
export const deleteAccount = callable<{ confirm: "DELETE" }, { ok: true }>("deleteAccount");
export const blockUser = callable<{ otherUid: string }, { ok: true }>("blockUser");
export const unblockUser = callable<{ otherUid: string }, { ok: true }>("unblockUser");
export type ReportKind = "user" | "league_message" | "dm" | "bet_comment";
export type ReportReason = "harassment" | "hate" | "sexual" | "spam" | "threat" | "other";
export const reportContent = callable<
  { kind: ReportKind; targetUid: string; reason: ReportReason; path?: string; text?: string; details?: string },
  { ok: true; reportId: string }
>("reportContent");
export const acceptTerms = callable<{ version: number }, { ok: true; version: number }>("acceptTerms");

const checkUsernameRemote = callable<
  { username: string },
  { available: boolean; reason: "invalid" | "taken" | null }
>("checkUsername");
/** Read on the device (usernames/{name} is readable); the callable is only the fallback. */
export const checkUsername = (args: { username: string }) =>
  import("@/lib/onDevice").then((m) => m.checkUsername(args.username)).catch(() => checkUsernameRemote(args));

export const updateAvatar = callable<{ avatar: AvatarConfig }, { ok: true }>("updateAvatar");

export const searchUsers = callable<{ q: string }, { results: PublicUser[] }>("searchUsers");

export const setPlayLimits = callable<{ dailyPicks?: number | null; breakDays?: 1 | 7 | 30 }, { ok: true }>("setPlayLimits");

export interface WeeklyQuest {
  id: string;
  kind: "effort" | "social" | "skill" | "endowed";
  title: string;
  target: number;
  xp: number;
  progress: number;
  claimed: boolean;
}
const getWeeklyQuestsRemote = callable<Record<string, never>, { week: string; quests: WeeklyQuest[] }>("getWeeklyQuests");
/**
 * Progress is counted on the device from the player's own bets. The callable
 * runs once a week (to draw the week's quests) and as the fallback.
 */
export const getWeeklyQuests = (args: Record<string, never>) =>
  import("@/lib/onDevice")
    .then((m) => m.weeklyQuests())
    .catch(() => null)
    .then((local) => local ?? getWeeklyQuestsRemote(args));
export const claimSeasonTier = callable<{ seasonId: string; tier: number }, { ok: true; duplicate?: boolean }>("claimSeasonTier");
export const claimQuest = callable<{ questId: string }, { ok: true; xp: number; level: number }>("claimQuest");

/** XP challenges that scale with level; unfinished ones stay until claimed. */
export interface LevelChallenge {
  id: string;
  title: string;
  target: number;
  xp: number;
  to: string | null;
  minLevel: number;
  explore: boolean;
  progress: number;
}
export const getLevelChallenges = callable<Record<string, never>, { level: number; challenges: LevelChallenge[] }>("getLevelChallenges");
export const claimLevelChallenge = callable<{ id: string }, { ok: true; xp: number; level: number }>("claimLevelChallenge");
export type ChallengeAction = "theme" | "oddsFormat" | "levelsViewed" | "avatarSaved" | "danced" | "tutorial";
const recordChallengeActionRemote = callable<{ action: ChallengeAction }, { ok: true; xp?: number }>("recordChallengeAction");
/** Fire-and-forget: things only the app sees that count toward a challenge. */
export function reportChallengeAction(action: ChallengeAction) {
  recordChallengeActionRemote({ action }).catch(() => {});
}

export const setAlertPrefs = callable<{ sweat?: boolean; quietHours?: boolean; tz?: string }, { ok: true }>("setAlertPrefs");

export const makeDailyPick = callable<
  { side: "home" | "away" },
  { ok: true; day: string; streak: number; freezes: number; milestone: number | null }
>("makeDailyPick");

/** A bet-slip parlay on the credits wallet (functions/src/callable/slipParlays.ts). */
export const placeParlay = callable<
  { legs: Array<{ gameId: string; market: Market; selection: Selection }>; stake: number; idempotencyKey: string },
  { ok: true; parlayId: string; duplicate: boolean; odds?: number; balance?: number | null }
>("placeParlay");
export const cancelParlay = callable<{ parlayId: string }, { ok: true; balance: number | null }>("cancelParlay");

/** Today's free 100-credit moneyline bet on any upcoming game (functions/src/callable/dailyPick.ts). */
export const placeFreeBet = callable<
  { gameId: string; side?: "home" | "away"; market?: Market; selection?: Selection; idempotencyKey: string },
  { ok: true; betId: string; day: string; winnings: number; duplicate: boolean; streak: number | null; milestone: number | null }
>("placeFreeBet");

export const updateFavoriteTeams = callable<{ teams: FavoriteTeam[]; reminders?: boolean }, { ok: true; teams: FavoriteTeam[] }>(
  "updateFavoriteTeams"
);

// ── player profiles ────────────────────────────────────────────────────────
export interface ProfileBet {
  id: string;
  gameId: string;
  sport: string | null;
  side: "home" | "away";
  market?: Market;
  selection?: Selection;
  line?: number | null;
  label?: string;
  lock?: boolean;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled" | string;
  placedAt: number | null;
  settledAt: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}

export interface PlayerProfile {
  /** What the server let the viewer see. */
  relation: "self" | "friend" | "league" | "none";
  profile: {
    uid: string;
    username: string;
    displayName: string;
    avatar: AvatarConfig | null;
    equipped: Partial<Record<Slot, string>>;
    /** Their dance-move loadout (the default if they never set one). */
    moves?: string[];
    favoriteTeams: FavoriteTeam[];
    /** Their level and background (absent from older servers). */
    level?: number;
    background?: string | null;
    stats: UserStats | null;
    streak?: StreakInfo | null;
    punishment?: PunishmentInfo | null;
    trophies?: TrophyItem[];
    /** A trophy id the player pinned to the top of their profile. */
    featuredTrophy?: string | null;
    memberSince: number | null;
    balance: number | null;
  };
  /** Global bets — self and friends only. */
  bets: ProfileBet[] | null;
  /** That league's line and bets, when both are members. */
  league: {
    leagueId: string;
    leagueName: string;
    leagueTokens: number;
    betsWon: number;
    betsLost: number;
    betsPush: number;
    locksWon?: number;
    locksLost?: number;
    joinedAt: number | null;
    bets: ProfileBet[];
    rivalry?: { myWins: number; theirWins: number; pushes: number } | null;
  } | null;
}

export const getPlayerProfile = callable<{ uid: string; leagueId?: string }, PlayerProfile>("getPlayerProfile");
export const setFeaturedTrophy = callable<{ trophyId: string | null }, { ok: true; trophyId: string | null }>("setFeaturedTrophy");

// ── push ───────────────────────────────────────────────────────────────────
export const registerPushToken = callable<
  { token: string; enabled?: boolean; platform?: "ios" },
  { ok: true; registered: boolean }
>("registerPushToken");

// ── game insights ──────────────────────────────────────────────────────────
export const getGameInsights = callable<{ gameId: string }, { insights: GameInsights }>("getGameInsights");

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

const listFriendsRemote = callable<Record<string, never>, { friends: PublicUser[] }>(
  "listFriends"
);
/** Built on the device from friendships + public profiles; the callable is only the fallback. */
export const listFriends = (args: Record<string, never>) =>
  import("@/lib/onDevice").then((m) => m.listFriends()).catch(() => listFriendsRemote(args));

// ── betting ────────────────────────────────────────────────────────────────
export interface PlaceBetArgs {
  gameId: string;
  side?: "home" | "away";
  market?: Market;
  selection?: Selection;
  stake: number;
  idempotencyKey: string;
  /** Decimal odds the user was shown, so a moved price fails loudly. */
  expectedOdds?: number;
  /** Spread or total line the user was shown. */
  expectedLine?: number;
  opponentUid?: string;
}
export interface PlaceBetResult {
  ok: true;
  betId: string;
  duplicate: boolean;
  balance: number | null;
  streak?: number;
}
const placeBetCall = callable<PlaceBetArgs, PlaceBetResult>("placeBet");

/** Every credits bet goes through here, so `bet_placed` is tracked exactly once per new bet. */
export async function placeBet(args: PlaceBetArgs): Promise<PlaceBetResult> {
  const res = await placeBetCall(args);
  if (!res.duplicate) {
    trackEvent("bet_placed", {
      wallet: "credits",
      game_id: args.gameId,
      market: args.market ?? "ml",
      side: args.selection ?? args.side ?? "home",
      stake: args.stake,
      odds: args.expectedOdds ?? null,
    });
  }
  return res;
}

export const cancelBet = callable<{ betId: string }, { ok: true; balance: number | null }>(
  "cancelBet"
);

// ── friend challenges ──────────────────────────────────────────────────────
export type ChallengeMode = "pot" | "odds";
export type ChallengeStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired" | "settled" | "void";

export interface ChallengeTeam {
  name: string;
  abbreviation: string;
  color: string;
}

/** challenges/{id}. Written only by the server; both players can read it. */
export interface Challenge {
  id: string;
  gameId: string;
  sport: string | null;
  startsAt: number;
  home: ChallengeTeam;
  away: ChallengeTeam;
  mode: ChallengeMode;
  /** The challenger's price on their own pick (2.00 for a pot). */
  odds: number;
  creatorUid: string;
  opponentUid: string;
  participants: string[];
  creatorName: string;
  opponentName: string;
  creatorSide: "home" | "away";
  creatorStake: number;
  opponentStake: number;
  pot: number;
  message: string | null;
  status: ChallengeStatus;
  outcome: "creator" | "opponent" | "push" | null;
  winnerUid: string | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  createdAtMs: number;
  respondedAtMs: number | null;
  closedAtMs: number | null;
  settledAtMs: number | null;
}

export const createChallenge = callable<
  {
    gameId: string;
    opponentUid: string;
    side: "home" | "away";
    mode: ChallengeMode;
    stake: number;
    odds?: number;
    message?: string;
    idempotencyKey: string;
  },
  { ok: true; challengeId: string; duplicate: boolean; balance: number | null }
>("createChallenge");

export const respondChallenge = callable<
  { challengeId: string; accept: boolean },
  { ok: true; status: "accepted" | "declined" | "expired"; balance: number | null }
>("respondChallenge");

export const cancelChallenge = callable<
  { challengeId: string },
  { ok: true; status: string; balance: number | null }
>("cancelChallenge");

// ── shop ───────────────────────────────────────────────────────────────────
export const purchaseItem = callable<
  { itemId: string; idempotencyKey: string },
  { ok: true; balance: number | null; itemId: string }
>("purchaseItem");

/** Buys a catalog item for a friend (functions/src/callable/gifts.ts). */
export const giftItem = callable<
  { itemId: string; toUid: string; idempotencyKey: string; note?: string },
  { ok: true; duplicate: boolean; balance: number | null; itemId: string }
>("giftItem");

// ── friends: credits and loans outside leagues (functions/src/callable/friendMoney.ts) ──
export const FRIEND_SEND_MIN = 10;
export const FRIEND_SEND_MAX = 5_000;
export const FRIEND_DAILY_SEND_CAP = 10_000;
export const FRIEND_LOAN_RATES = [0, 5, 10, 20] as const;
export const FRIEND_SEND_LEVEL = 5;
export const loanOwed = (amount: number, pct: number) => amount + Math.round((amount * pct) / 100);

export interface FriendLoan {
  id: string;
  lenderUid: string;
  borrowerUid: string;
  lenderName: string;
  borrowerName: string;
  amount: number;
  interestPct: number;
  owed: number;
  repaid: number;
  note: string | null;
  status: "requested" | "offered" | "countered" | "active" | "repaid" | "declined" | "cancelled";
  createdBy: string;
  lastTurnBy?: string;
  lastTurnName?: string;
  createdAt: number;
}

export const sendCredits = callable<
  { toUid: string; amount: number; note?: string; idempotencyKey: string },
  { ok: true; duplicate: boolean; balance: number | null }
>("sendCredits");
export const requestFriendLoan = callable<{ toUid: string; amount: number; interestPct: number; note?: string }, { ok: true; loanId: string }>("requestFriendLoan");
export const offerFriendLoan = callable<{ toUid: string; amount: number; interestPct: number; note?: string }, { ok: true; loanId: string }>("offerFriendLoan");
export const respondFriendLoan = callable<
  {
    loanId: string;
    accept?: boolean;
    action?: "accept" | "decline" | "cancel" | "counter" | "edit";
    amount?: number;
    interestPct?: number;
    note?: string;
  },
  { ok: true; status: string }
>("respondFriendLoan");
export const repayFriendLoan = callable<
  { loanId: string; amount: number; idempotencyKey: string },
  { ok: true; duplicate: boolean; balance: number | null; status?: string }
>("repayFriendLoan");

/** Returning-player Prize Box (functions/src/callable/winBack.ts). */
export const claimWinBackBox = callable<Record<string, never>, { ok: true; credits: number; balance: number | null }>("claimWinBackBox");
/** Free "who scores next?" call on a live game (functions/src/callable/flash.ts). */
export const makeFlashPick = callable<{ gameId: string; side: "home" | "away" }, { ok: true; id: string; left: number; leftToday: number }>("makeFlashPick");
/** Stake credits on adding 7 days to your pick streak (functions/src/callable/streakWager.ts). */
export interface StreakWagerInfo {
  stake: number;
  startCount: number;
  startDay: string;
  target: number;
}
export const streakWager = callable<
  { action: "place"; stake: number } | { action: "settle" },
  { ok: true; state: "active" | "won" | "lost" | "none"; credits?: number; wager?: StreakWagerInfo }
>("streakWager");
export const claimTutorialGift = callable<Record<string, never>, { ok: true; credits: number; balance: number | null; already: boolean }>("claimTutorialGift");

export const saveAppearance = callable<
  { avatar: AvatarConfig; equipped: Partial<Record<Slot, string | null>> },
  { ok: true; avatar: AvatarConfig; equipped: Partial<Record<Slot, string>> }
>("saveAppearance");

export const equipItem = callable<{ slot: Slot; itemId: string | null }, { ok: true; removed: Slot[] }>(
  "equipItem"
);

// ── moves ──────────────────────────────────────────────────────────────────
export const purchaseMove = callable<
  { moveId: string; idempotencyKey: string },
  { ok: true; balance: number | null; moveId: string; equipped: boolean }
>("purchaseMove");

export const setMoveLoadout = callable<{ moves: string[] }, { ok: true; moves: string[] }>("setMoveLoadout");

// ── backgrounds ────────────────────────────────────────────────────────────
export const purchaseBackground = callable<
  { backgroundId: string; idempotencyKey: string },
  { ok: true; balance: number | null; backgroundId: string }
>("purchaseBackground");

export const setBackground = callable<{ backgroundId: string | null }, { ok: true; backgroundId: string }>("setBackground");

// ── levels & invites ───────────────────────────────────────────────────────
export interface ReferralSummary {
  code: string;
  referralCount: number;
  referrerCredits: number;
  newUserCredits: number;
  maxRewarded: number;
  referrerXp: number;
}

export const getReferralCode = callable<Record<string, never>, ReferralSummary>("getReferralCode");

export const checkReferralCode = callable<
  { code: string },
  { valid: false } | { valid: true; code: string; uid?: string; displayName: string; username: string | null; newUserCredits: number }
>("checkReferralCode");

export const syncProgression = callable<
  Record<string, never>,
  { ok: true; xp: number; level: number; unlocked: Array<{ kind: "item" | "background"; id: string; name: string; level: number }>; referralCode: string | null }
>("syncProgression");

// ── prize boxes ────────────────────────────────────────────────────────────
export type BoxTier = "bronze" | "silver" | "gold";

export const openPrizeBox = callable<
  { tier: BoxTier },
  { ok: true; state: "waiting" | "ready"; readyAt: number }
>("openPrizeBox");

export const claimPrizeBox = callable<
  { tier: BoxTier },
  {
    ok: true;
    duplicate: boolean;
    rewardCredits: number;
    baseCredits?: number;
    streakBonus?: number;
    streakDays?: number;
    balance: number | null;
  }
>("claimPrizeBox");

export const resetPrizeBox = callable<{ tier: BoxTier }, { ok: true }>("resetPrizeBox");

export const claimAdReward = callable<
  { nonce: string },
  { result: "granted" | "duplicate" | "capped" | "too_soon" | "no_user" | "pending" }
>("claimAdReward");

// ── leagues ────────────────────────────────────────────────────────────────
export const createLeague = callable<
  {
    idempotencyKey: string;
    name: string;
    startingLeagueTokens: number;
    duration: LeagueDuration;
    sports: string[];
    buyIn: number;
    prizePreset: "winner-all" | "top-2" | "top-3";
    bankLoanEnabled: boolean;
    bankInterestRate: number;
    bankInterestIntervalHours: number;
    mode?: LeagueMode;
    matchupsEnabled?: boolean;
    matchupCadence?: MatchupCadence;
    stimulusEnabled?: boolean;
    bracketTemplateId?: string;
    startNow?: boolean;
    startsAt?: number;
  },
  { ok: true; leagueId: string; code: string; duplicate: boolean }
>("createLeague");
export const submitBracket = callable<{ leagueId: string; picks: Record<string, string> }, { ok: true; picks: number }>("submitBracket");

/** `league` is the league as it stands after the join (absent from servers deployed before it was added). */
export const joinLeague = callable<{ code: string }, { ok: true; leagueId: string; duplicate: boolean; league?: League }>(
  "joinLeague"
);

export const leaveLeague = callable<{ leagueId: string }, { ok: true }>("leaveLeague");

export interface UpdateLeagueSettingsArgs {
  leagueId: string;
  bankLoanEnabled?: boolean;
  bankInterestRate?: number;
  bankInterestIntervalHours?: number;
  name?: string;
  sports?: string[];
  prizePreset?: "winner-all" | "top-2" | "top-3";
  duration?: LeagueDuration;
  mode?: LeagueMode;
  matchupsEnabled?: boolean;
  matchupCadence?: MatchupCadence;
  stimulusEnabled?: boolean;
}

export const updateLeagueSettings = callable<UpdateLeagueSettingsArgs, { ok: true }>("updateLeagueSettings");

export type LeagueStimulusArgs =
  | { leagueId: string; action: "request"; pct: number }
  | { leagueId: string; action: "vote"; requestId: string; approve: boolean }
  | { leagueId: string; action: "cancel"; requestId: string };
export const leagueStimulus = callable<LeagueStimulusArgs, { ok: true; status: "open" | "paid" | "cancelled"; amount: number }>(
  "leagueStimulus"
);

export const inviteToLeague = callable<
  { leagueId: string; friendUid: string },
  { ok: true; status: "sent" | "already_member" }
>("inviteToLeague");

export const endLeague = callable<{ leagueId: string }, { ok: true }>("endLeague");

export const voteEndLeague = callable<
  { leagueId: string; vote: boolean },
  { ok: true; ended: boolean; votes: number; needed: number }
>("voteEndLeague");

export const reportResult = callable<
  { leagueId: string; betId: string; reason: string },
  { ok: true }
>("reportResult");

export const voidLeagueBet = callable<
  { leagueId: string; betId: string; reason: string },
  { ok: true; tokenDelta: number }
>("voidLeagueBet");

export const reactToItem = callable<
  {
    leagueId: string;
    targetType: "message" | "messages" | "activity" | "bet" | "leagueBets" | "loan" | "loans";
    targetId: string;
    emoji: ReactionEmoji;
  },
  { ok: true; reactions: Record<string, number>; reactors: Record<string, string> }
>("reactToItem");

export const makePick = callable<
  { leagueId: string; gameId: string; side: "home" | "away" },
  { ok: true; pickId: string; week: string; teamAbbr: string }
>("makePick");

export const createGroupParlay = callable<
  {
    leagueId: string;
    idempotencyKey: string;
    stake?: number;
    leg?: {
      gameId: string;
      side?: "home" | "away";
      market?: Market;
      selection?: Selection;
      expectedOdds?: number;
      expectedLine?: number;
    };
  },
  { ok: true; parlayId: string; duplicate: boolean; combinedOdds?: number }
>("createGroupParlay");

export const addParlayLeg = callable<
  {
    leagueId: string;
    parlayId: string;
    gameId: string;
    side?: "home" | "away";
    market?: Market;
    selection?: Selection;
    expectedOdds?: number;
    expectedLine?: number;
    stake?: number;
  },
  { ok: true; combinedOdds: number; legCount: number }
>("addParlayLeg");

export const rideParlay = callable<
  { leagueId: string; parlayId: string; stake: number },
  { ok: true; leagueTokens: number }
>("rideParlay");

export const lockParlay = callable<
  { leagueId: string; parlayId: string },
  { ok: true; combinedOdds: number }
>("lockParlay");

export interface PlaceLeagueBetArgs {
  leagueId: string;
  gameId: string;
  side?: "home" | "away";
  market?: Market;
  selection?: Selection;
  stake: number;
  idempotencyKey: string;
  expectedOdds?: number;
  expectedLine?: number;
  /** Id of another member's pending league bet this one copies (same side). */
  tailOf?: string;
  /** Id of another member's pending league bet this one opposes (other side). */
  fadeOf?: string;
  /** Lock of the Week flag (one per member per week). */
  lock?: boolean;
  /** Hide pick from chat and sweat tracker until kickoff. */
  hidden?: boolean;
}
export interface PlaceLeagueBetResult {
  ok: true;
  betId: string;
  duplicate: boolean;
  leagueTokens: number | null;
}
const placeLeagueBetCall = callable<PlaceLeagueBetArgs, PlaceLeagueBetResult>("placeLeagueBet");

/** Every league bet goes through here; tails and fades are tracked on top of `bet_placed`. */
export async function placeLeagueBet(args: PlaceLeagueBetArgs): Promise<PlaceLeagueBetResult> {
  const res = await placeLeagueBetCall(args);
  if (!res.duplicate) {
    const params = {
      wallet: "league",
      league_id: args.leagueId,
      game_id: args.gameId,
      market: args.market ?? "ml",
      side: args.selection ?? args.side ?? "home",
      stake: args.stake,
      odds: args.expectedOdds ?? null,
    };
    trackEvent("bet_placed", { ...params, follow: args.tailOf ? "tail" : args.fadeOf ? "fade" : "none" });
    if (args.tailOf) trackEvent("bet_tailed", { ...params, source_bet_id: args.tailOf });
    if (args.fadeOf) trackEvent("bet_faded", { ...params, source_bet_id: args.fadeOf });
  }
  return res;
}

export type TauntInput =
  | { scope: "league"; leagueId: string; matchupId: string; receiverUid: string; moveId: string }
  | { scope: "dm"; receiverUid: string; matchupId: string; moveId: string };
export const sendTaunt = callable<TauntInput, { ok: true; id: string }>("sendTaunt");
export const setMuteTaunts = callable<{ mute: boolean }, { ok: true }>("setMuteTaunts");

export const registerLiveActivity = callable<{ gameId: string; token: string; side: "home" | "away" }, { ok: true }>("registerLiveActivity");

export const requestReset = callable<{ leagueId: string }, { ok: true; leagueTokens: number; duplicate?: boolean }>("requestReset");

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

export type PeerLoanActionName = "fund" | "counter" | "edit" | "decline" | "cancel" | "accept_counter" | "reject_counter";

export const peerLoanAction = callable<
  { leagueId: string; loanId: string; action: PeerLoanActionName; rate?: number; amount?: number; message?: string },
  { ok: true }
>("peerLoanAction");

// ── helpers ────────────────────────────────────────────────────────────────

export function newIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}${rand}`;
}

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
  if (code.includes("internal") && (!e?.message || e.message === "internal"))
    return "The server couldn't do that right now. Try again in a moment.";
  return e?.message ?? "Something went wrong. Try again.";
}

// ── dev tools (dev builds only; server-gated by DEV_TOOLS=1) ────────────────
export const devTools = callable<
  {
    friends?: number;
    requests?: number;
    leagues?: number;
    cash?: number;
    chests?: boolean;
    hitBet?: boolean;
    loseBet?: boolean;
    chat?: boolean;
  },
  { ok: true; done: string[] }
>("devTools");

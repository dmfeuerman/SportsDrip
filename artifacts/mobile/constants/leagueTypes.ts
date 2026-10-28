import type { LoanKind, LoanStatus, LoanTerms } from "@/lib/loanMath";

/**
 * League shapes as the server writes them (functions/src/callable/leagues.ts).
 * The client never writes any of this — it reads leagues/{id} and its
 * subcollections and calls the league callables to change them.
 */

export type LeagueDuration = "1 Week" | "2 Weeks" | "1 Month" | "3 Months";
export type Sport = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";
export type LeagueStatus = "active" | "ended";

export interface PrizeDistribution {
  preset: "winner-all" | "top-2" | "top-3" | "custom";
  firstPct: number;
  secondPct: number;
  thirdPct: number;
}

export const PRIZE_PRESETS: {
  label: string;
  value: Exclude<PrizeDistribution["preset"], "custom">;
  firstPct: number;
  secondPct: number;
  thirdPct: number;
}[] = [
  { label: "Winner Takes All", value: "winner-all", firstPct: 100, secondPct: 0, thirdPct: 0 },
  { label: "Top 2 Split (70/30)", value: "top-2", firstPct: 70, secondPct: 30, thirdPct: 0 },
  { label: "Top 3 Split (60/30/10)", value: "top-3", firstPct: 60, secondPct: 30, thirdPct: 10 },
];

export interface LeagueMember {
  uid: string;
  displayName: string;
  avatarColor: string;
  leagueTokens: number;
  startingLeagueTokens: number;
  joinedAt: number;
  betsWon: number;
  betsLost: number;
  betsPush?: number;
}

export interface LeagueResult {
  rank: number;
  memberId: string;
  memberName: string;
  memberColor: string;
  leagueTokens: number;
  debt?: number;
  receivable?: number;
  netWorth?: number;
  prizeTokens: number;
  paid?: boolean;
}

export interface League {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  endsAt: number;
  endedAt?: number;
  status: LeagueStatus;
  creatorId: string;
  startingLeagueTokens: number;
  buyIn: number;
  pot: number;
  prizeDistribution: PrizeDistribution;
  allowedSports: Sport[];
  bankLoanEnabled: boolean;
  bankInterestRate: number;
  bankInterestIntervalHours: number;
  memberIds: string[];
  members: Record<string, LeagueMember>;
  results?: LeagueResult[];
  payoutStatus?: "none" | "pending" | "paid";
  lastActivityAt?: number;
}

export interface LeagueLoan extends LoanTerms {
  id: string;
  leagueId: string;
  kind: LoanKind;
  status: LoanStatus;
  borrowerId: string;
  borrowerName: string;
  lenderId: string | null;
  lenderName: string | null;
  proposedRate?: number;
  counterRate?: number | null;
  counterBy?: string | null;
  counterByName?: string | null;
  declinedBy?: string[];
  message?: string | null;
  createdAt: number;
  fundedAt?: number;
  repaidAt?: number | null;
}

export interface LeagueBet {
  id: string;
  leagueId: string;
  uid: string;
  displayName: string;
  gameId: string;
  sport: string;
  side: "home" | "away";
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled";
  placedAt: number;
  finalHomeScore?: number;
  finalAwayScore?: number;
}

export interface LeagueActivity {
  id: string;
  type: string;
  uid: string;
  name: string;
  text: string;
  amount: number;
  at: number;
}

export const DURATION_DAYS: Record<LeagueDuration, number> = {
  "1 Week": 7,
  "2 Weeks": 14,
  "1 Month": 30,
  "3 Months": 90,
};

export const SPORT_ICONS: Record<Sport, string> = {
  NFL: "football",
  NBA: "basketball",
  MLB: "baseball",
  NHL: "hockey-puck",
  NCAAF: "football",
  NCAAB: "basketball",
  Soccer: "soccer",
};

/** Must match functions/src/lib/leagueConfig.ts. */
export const BUY_IN_OPTIONS = [0, 100, 250, 500, 1_000];
export const TOKEN_START_OPTIONS = [1_000, 5_000, 10_000, 25_000, 50_000];
export const BANK_PRINCIPAL_CAP_MULTIPLIER = 1;
export const PEER_LOAN_MAX_PCT = 0.5;
export const MIN_LEAGUE_STAKE = 10;

/**
 * Closed = finalized by the server, or past its end time and waiting on the
 * sweep. Either way it's read-only: history stays visible, nothing mutates.
 */
export function isLeagueClosed(league: Pick<League, "status" | "endsAt">, now: number = Date.now()): boolean {
  return league.status !== "active" || (!!league.endsAt && now >= league.endsAt);
}

export const LEAGUE_CLOSED_MESSAGE = "This league is closed. It's read-only now.";

/** Peer loan requests are on. Must match functions/src/lib/leagueConfig.ts. */
export const PEER_LOAN_REQUESTS_ENABLED = true;
export const LOAN_REQUESTS_CLOSED_MESSAGE = "Loan requests are closed.";

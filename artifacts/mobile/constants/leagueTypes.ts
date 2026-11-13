import type { LoanKind, LoanStatus, LoanTerms } from "@/lib/loanMath";
import type { Market, Selection } from "@/lib/markets";

/**
 * League shapes as the server writes them (functions/src/callable/leagues.ts).
 * The client never writes any of this — it reads leagues/{id} and its
 * subcollections and calls the league callables to change them.
 */

/** Must match DURATIONS in functions/src/lib/leagueConfig.ts. One month (4 weeks) is the minimum. */
export type FixedLeagueDuration = "1 Month" | "6 Weeks" | "2 Months" | "3 Months";
/** "Full Season": runs until the last chosen sport's season ends (constants/seasons.ts). */
export type LeagueDuration = FixedLeagueDuration | "Full Season";
export type Sport = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";
export type LeagueStatus = "active" | "ended";
export type LeagueMode = "bankroll" | "pickem" | "survivor" | "matchups" | "bracket";

export const LEAGUE_MODES: Array<{ value: LeagueMode; label: string; desc: string }> = [
  { value: "bankroll", label: "Bankroll", desc: "Classic token stack, odds payouts, and optional loans" },
  { value: "matchups", label: "H2H League", desc: "Matchups only — beat your opponent each round; standings go by W-L record" },
  { value: "pickem", label: "Weekly Pick'em", desc: "Pick straight-up winners each week — 1 point per win" },
  { value: "survivor", label: "Survivor Pool", desc: "One team per week, never twice — lose and you're out" },
  { value: "bracket", label: "Bracket", desc: "Fill a tournament bracket — 1-2-4-8-16-32 points by round" },
];

/** How often head-to-head matchups turn over. Must match functions/src/lib/leagueConfig.ts. */
export type MatchupCadence = "weekly" | "twice-weekly" | "daily";
export const MATCHUP_CADENCES: Array<{ value: MatchupCadence; label: string; desc: string }> = [
  { value: "weekly", label: "Weekly", desc: "New opponent every Monday" },
  { value: "twice-weekly", label: "2× a week", desc: "New opponent Monday and Thursday" },
  { value: "daily", label: "Daily", desc: "New opponent every morning" },
];
export const cadenceLabel = (c: MatchupCadence | undefined) => MATCHUP_CADENCES.find((x) => x.value === (c ?? "weekly"))!.label;
/** What one matchup period is called in the UI. */
export const periodNoun = (c: MatchupCadence | undefined) => (c === "daily" ? "Day" : c === "twice-weekly" ? "Round" : "Week");

/** Bank stimulus: percent of starting tokens per member. Must match the server. */
export const STIMULUS_PCTS = [10, 25, 50] as const;

export interface StimulusRequest {
  id: string;
  uid: string;
  name: string;
  pct: number;
  amount: number;
  votes: string[];
  createdAt: number;
  expiresAt: number;
}

export const REACTION_EMOJIS = ["🔥", "💀", "😂", "🧊", "🫡", "🤡"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface H2HRecord {
  w?: number;
  l?: number;
  t?: number;
}

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
  locksWon?: number;
  locksLost?: number;
  locksPush?: number;
  lastLockWeek?: string | null;
  pickPoints?: number;
  eliminated?: boolean;
  eliminatedAt?: number | null;
  eliminatedWeek?: string | null;
  usedTeams?: string[];
  h2h?: H2HRecord;
  /** Mirrored from users/{uid}.achievementCount when a trophy lands. */
  achievementCount?: number;
  /** Bankrupt reset used this league (requestReset). */
  resetUsed?: boolean;
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
  /** App-only: built on this phone while createLeague runs; not on the server yet, so nothing may listen to it. */
  optimistic?: boolean;
  /** When play opens; before it friends can join, after it the roster is locked. Older leagues: createdAt. */
  startsAt?: number;
  /** A picked start date (not "start now"): nobody joined by then = cancelled. */
  scheduledStart?: boolean;
  /** Closed at its start date because nobody joined; buy-ins refunded. */
  cancelled?: boolean;
  /** Bracket mode: bracketTemplates/{id}. */
  bracketTemplateId?: string | null;
  id: string;
  name: string;
  code: string;
  mode?: LeagueMode;
  matchupsEnabled?: boolean;
  matchupCadence?: MatchupCadence;
  openMatchupWeek?: string | null;
  /** Members may vote for the bank to top everyone up. */
  stimulusEnabled?: boolean;
  stimulus?: StimulusRequest | null;
  lastStimulusAt?: number;
  stimulusTotal?: number;
  createdAt: number;
  endsAt: number;
  endedAt?: number;
  /** Set on leagues created after the 1-month minimum; older leagues have neither. */
  duration?: LeagueDuration;
  durationWeeks?: number;
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
  endVotes?: string[];
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
  bailout?: boolean;
  proposedRate?: number;
  counterRate?: number | null;
  counterBy?: string | null;
  counterByName?: string | null;
  declinedBy?: string[];
  message?: string | null;
  createdAt: number;
  fundedAt?: number;
  repaidAt?: number | null;
  reactions?: Record<string, number>;
  reactors?: Record<string, string>;
}

export interface LeagueBet {
  id: string;
  leagueId: string;
  uid: string;
  displayName: string;
  gameId: string;
  sport: string;
  side: "home" | "away";
  market?: Market;
  selection?: Selection;
  line?: number | null;
  label?: string;
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
  startsAt?: number | null;
  lock?: boolean;
  lockWeek?: string | null;
  hidden?: boolean;
  disputed?: boolean;
  disputeReason?: string | null;
  disputedBy?: string | null;
  disputedByName?: string | null;
  voidReason?: string | null;
  reactions?: Record<string, number>;
  reactors?: Record<string, string>;
  tails?: number;
  fades?: number;
  followers?: Record<string, "tail" | "fade">;
  tailOf?: string | null;
  fadeOf?: string | null;
  followOfName?: string | null;
}

export interface LeagueActivity {
  id: string;
  type: string;
  uid: string;
  name: string;
  text: string;
  amount: number;
  at: number;
  reactions?: Record<string, number>;
  reactors?: Record<string, string>;
}

export interface LeagueMessage {
  id: string;
  uid: string;
  name: string;
  kind: "text" | "bet" | "system" | "taunt" | "loan";
  text: string;
  at: number;
  /** Loan card metadata when kind === "loan". */
  loanId?: string;
  amount?: number;
  rate?: number;
  /** Taunts: the move to play, sender avatar snapshot. */
  moveId?: string;
  matchupId?: string;
  avatar?: import("@/types/avatar").AvatarConfig | null;
  equipped?: import("@/types/avatar").Equipped | null;
  betId?: string;
  gameId?: string;
  sport?: string;
  market?: Market;
  selection?: Selection;
  side?: "home" | "away" | null;
  line?: number | null;
  label?: string;
  teamAbbr?: string;
  teamColor?: string;
  opponentAbbr?: string;
  stake?: number;
  odds?: number;
  potentialPayout?: number;
  lock?: boolean;
  /** Kickoff, for bet cards (Tail only while upcoming). */
  startsAt?: number | null;
  /** Hidden pick: the doc carries no side/pick until kickoff. */
  hidden?: boolean;
  replyTo?: {
    id: string;
    kind: "message" | "bet_result";
    authorUid: string;
    authorName: string;
    text: string;
    betStatus?: string;
    teamAbbr?: string;
    opponentAbbr?: string;
    odds?: number;
    stake?: number;
    payout?: number;
    currency?: "credits" | "league";
  } | null;
  reactions?: Record<string, number>;
  reactors?: Record<string, string>;
}

export interface GameSideEntry {
  betId: string;
  uid: string;
  name: string;
  displayName: string;
  side: "home" | "away" | null;
  market: Market;
  selection: Selection;
  line: number | null;
  label: string;
  teamAbbr: string;
  stake: number;
  payout: number;
  odds: number;
  lock: boolean;
}

export interface GameSidesDoc {
  id: string;
  gameId: string;
  leagueId: string;
  entries: GameSideEntry[];
  home: GameSideEntry[];
  away: GameSideEntry[];
  updatedAt: number;
}

export interface LeagueRivalry {
  id: string;
  leagueId: string;
  aUid: string;
  bUid: string;
  aName: string;
  bName: string;
  aWins: number;
  bWins: number;
  pushes: number;
  lastGameId?: string;
  updatedAt: number;
}

export interface LeagueReportCard {
  kind: "biggest_hit" | "bad_beat" | "climber" | "faller" | "best_tail" | "coldest_streak";
  title: string;
  uid: string;
  displayName: string;
  headline: string;
  detail: string;
  value: number;
}

export interface LeagueReport {
  id: string;
  week: string;
  leagueId: string;
  leagueName: string;
  generatedAt: number;
  totalBets: number;
  totalVolume: number;
  cards: LeagueReportCard[];
}

export interface LeagueMatchupPair {
  aUid: string;
  aName: string;
  bUid: string;
  bName: string;
  aStartNetWorth: number;
  bStartNetWorth: number;
  aEndNetWorth: number | null;
  bEndNetWorth: number | null;
  aDelta: number | null;
  bDelta: number | null;
  winnerUid: string | "tie" | null;
  bracket: "regular" | "playoff" | "consolation";
}

export interface LeagueMatchupDoc {
  id: string;
  week: string;
  weekNumber: number;
  isPlayoff: boolean;
  status: "open" | "closed";
  pairs: LeagueMatchupPair[];
  openedAt: number;
  closedAt: number | null;
}

export interface LeagueAuditEntry {
  id: string;
  action: string;
  uid: string;
  name: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  betId?: string | null;
  vote?: boolean;
  votes?: number;
  needed?: number;
  at: number;
}

export interface LeaguePick {
  id: string;
  leagueId: string;
  uid: string;
  displayName: string;
  mode: "pickem" | "survivor";
  week: string;
  gameId: string;
  sport: string;
  side: "home" | "away";
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
  startsAt: number | null;
  status: "pending" | "won" | "lost" | "push";
  placedAt: number;
  settledAt: number | null;
}

export interface LeagueParlayLeg {
  uid: string;
  name: string;
  gameId: string;
  sport: string;
  market: Market;
  selection: Selection;
  side: "home" | "away" | null;
  line: number | null;
  label: string;
  teamAbbr: string;
  opponentAbbr: string;
  odds: number;
  startsAt: number;
  status: "pending" | "won" | "lost" | "push" | "void";
}

export interface LeagueParlay {
  id: string;
  leagueId: string;
  creatorUid: string;
  creatorName: string;
  status: "open" | "locked" | "won" | "lost" | "push" | "void";
  legs: LeagueParlayLeg[];
  riders: Record<string, { uid: string; name: string; stake: number }>;
  combinedOdds: number;
  bustedBy: string | null;
  bustedByName: string | null;
  bustedLeg: string | null;
  createdAt: number;
  settledAt: number | null;
}

export interface TrophyItem {
  id: string;
  kind: "champion" | "last_place" | "lock_of_week" | "h2h_champion" | "achievement" | string;
  /** kind "achievement": which one (functions/src/lib/achievements.ts). */
  achievementId?: string;
  title: string;
  leagueId?: string;
  leagueName?: string;
  rank?: number;
  itemId?: string;
  label?: string;
  expiresAt?: number;
  awardedAt: number;
}

/** Whole weeks, so weekly head-to-head matchups divide the season evenly. */
export const DURATION_DAYS: Record<FixedLeagueDuration, number> = {
  "1 Month": 28,
  "6 Weeks": 42,
  "2 Months": 56,
  "3 Months": 91,
};
export const DURATION_OPTIONS: LeagueDuration[] = ["1 Month", "6 Weeks", "2 Months", "3 Months", "Full Season"];
export const DEFAULT_DURATION: LeagueDuration = "1 Month";

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
export const BUY_IN_OPTIONS = [0, 1_000, 2_500, 5_000, 10_000];
export const TOKEN_START_OPTIONS = [10_000, 50_000, 100_000, 250_000, 500_000];
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

/** When play opens (older leagues started at creation). */
export const leagueStartsAt = (league: Pick<League, "startsAt" | "createdAt">): number => league.startsAt ?? league.createdAt ?? 0;
/** A league needs this many players to start. Must match functions/src/lib/leagueConfig.ts. */
export const MIN_LEAGUE_PLAYERS = 2;
/**
 * Started leagues take no new members; unstarted ones take no bets. A league
 * starts at its start time once it has two players; the second to join starts
 * it if that time has already passed.
 */
export const isLeagueStarted = (league: Pick<League, "startsAt" | "createdAt"> & { memberIds?: string[] }, now: number = Date.now()): boolean =>
  now >= leagueStartsAt(league) && (league.memberIds?.length ?? MIN_LEAGUE_PLAYERS) >= MIN_LEAGUE_PLAYERS;

export const LEAGUE_CLOSED_MESSAGE = "This league is closed. It's read-only now.";

/** Peer loan requests are on. Must match functions/src/lib/leagueConfig.ts. */
export const PEER_LOAN_REQUESTS_ENABLED = true;
export const LOAN_REQUESTS_CLOSED_MESSAGE = "Loan requests are closed.";

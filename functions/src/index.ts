import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 20 });

// Profile / identity
export { createProfile, checkUsername, updateAvatar, searchUsers } from "./callable/profile";
export { saveAppearance } from "./callable/avatar";
export { getPlayerProfile, updateFavoriteTeams, setPlayLimits, setAlertPrefs } from "./callable/players";
export { getGameInsights } from "./callable/insights";
export { registerPushToken } from "./callable/push";

// Social graph
export {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  listFriends,
} from "./callable/friends";

// Economy
export { placeBet, cancelBet } from "./callable/bets";
export { createChallenge, respondChallenge, cancelChallenge } from "./callable/challenges";
export { purchaseItem, equipItem } from "./callable/shop";
export { purchaseMove, setMoveLoadout } from "./callable/moves";
export { purchaseBackground, setBackground } from "./callable/backgrounds";
export { getReferralCode, checkReferralCode, syncProgression } from "./callable/referrals";
export { openPrizeBox, claimPrizeBox, resetPrizeBox } from "./callable/prizes";
export { admobReward, claimAdReward } from "./http/adReward";

// Leagues — every league mutation goes through one of these.
export {
  createLeague,
  joinLeague,
  leaveLeague,
  updateLeagueSettings,
  inviteToLeague,
  endLeague,
  placeLeagueBet,
  takeBankLoan,
  repayLoan,
  requestPeerLoan,
  peerLoanAction,
  voteEndLeague,
  reportResult,
  voidLeagueBet,
  leagueStimulus,
} from "./callable/leagues";
export { reactToItem } from "./callable/social";
export { makePick } from "./callable/picks";
export { makeDailyPick, scheduleDailyPick } from "./callable/dailyPick";
export { getWeeklyQuests, claimQuest } from "./callable/quests";
export { createGroupParlay, addParlayLeg, lockParlay, rideParlay } from "./callable/parlays";

// Background jobs
export { syncGames, pruneGames } from "./scheduled/syncGames";
export { onGameFinal, settleBetsSweep, refundStaleBets } from "./scheduled/settleBets";
export { leagueSweep } from "./scheduled/leagues";
export { lockReminders, teamReminders } from "./scheduled/reminders";
export { tuesdayLeagueReport, mondayLeagueJobs, leagueMatchupJobs } from "./scheduled/weekly";

// Side effects of committed writes (never inside a money transaction)
export { pushOnNotification } from "./triggers/push";
export { pushOnDirectMessage, pushOnLeagueMessage, notifyOnDmReaction } from "./triggers/chatPush";
export { xpOnLedger, xpOnLeagueBet, xpOnFriendship } from "./triggers/xp";

// Test data for the app's dev launch flags. Off unless DEV_TOOLS=1 or the emulator.
export { devTools } from "./callable/dev";

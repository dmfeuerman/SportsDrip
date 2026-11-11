import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 20 });

// Profile / identity
export { createProfile, checkUsername, updateAvatar, searchUsers } from "./callable/profile";
export { saveAppearance } from "./callable/avatar";
export { getPlayerProfile, setFeaturedTrophy, updateFavoriteTeams, setPlayLimits, setAlertPrefs } from "./callable/players";
export { getGameInsights } from "./callable/insights";
export { registerPushToken } from "./callable/push";
export { deleteAccount, blockUser, unblockUser, reportContent, acceptTerms } from "./callable/account";

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
export { giftItem } from "./callable/gifts";
export { offerFriendLoan, repayFriendLoan, requestFriendLoan, respondFriendLoan, sendCredits } from "./callable/friendMoney";
export { claimWinBackBox } from "./callable/winBack";
export { claimTutorialGift } from "./callable/tutorial";
export { makeFlashPick } from "./callable/flash";
export { streakWager } from "./callable/streakWager";
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
  requestReset,
  peerLoanAction,
  voteEndLeague,
  reportResult,
  voidLeagueBet,
  leagueStimulus,
} from "./callable/leagues";
export { reactToItem } from "./callable/social";
export { makePick } from "./callable/picks";
export { makeDailyPick, placeFreeBet, scheduleDailyPick } from "./callable/dailyPick";
export { getWeeklyQuests, claimQuest } from "./callable/quests";
export { getLevelChallenges, claimLevelChallenge, recordChallengeAction } from "./callable/levelChallenges";
export { createGroupParlay, addParlayLeg, lockParlay, rideParlay } from "./callable/parlays";
export { placeParlay, cancelParlay } from "./callable/slipParlays";

// Background jobs
export { syncGames, pruneGames, syncLiveGames } from "./scheduled/syncGames";
export { onGameFinal, settleBetsSweep, refundStaleBets } from "./scheduled/settleBets";
export { leagueSweep } from "./scheduled/leagues";
// teamReminders moved on-device (artifacts/mobile/lib/localReminders.ts schedules it locally),
// which removes a job that ran every 5 minutes. Re-enable by restoring the export below.
// export { lockReminders, teamReminders } from "./scheduled/reminders";
export { lockReminders } from "./scheduled/reminders";
export { winBack } from "./scheduled/winBack";
export { birthdayGifts } from "./scheduled/birthdays";
export { tuesdayLeagueReport, mondayLeagueJobs, leagueMatchupJobs } from "./scheduled/weekly";

// Side effects of committed writes (never inside a money transaction)
export { pushOnNotification } from "./triggers/push";
export { pushOnDirectMessage, pushOnLeagueMessage, notifyOnDmReaction, moderateBetComment } from "./triggers/chatPush";
export { xpOnLedger, xpOnLeagueBet, xpOnFriendship } from "./triggers/xp";
export { friendStreakOnPick } from "./triggers/friendStreak";
export { bundleCatalog, bundleMoves, bundleBackgrounds } from "./triggers/bundles";

// Test data for the app's dev launch flags. Off unless DEV_TOOLS=1 or the emulator.
export { devTools } from "./callable/dev";

export { sendTaunt, setMuteTaunts } from "./callable/taunts";
export { yearWrapped } from "./scheduled/wrapped";
export { achievementStats } from "./scheduled/achievementStats";
export { claimSeasonTier } from "./callable/seasonPass";
export { ladderOpen, ladderClose } from "./scheduled/ladder";
export { weeklyLiveOps } from "./scheduled/liveOps";
export { submitBracket } from "./callable/brackets";
// Apple Live Activities: off until there's an Apple Developer account and APNs key.
// Re-enable this export (and set APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID) to turn them on.
// export { registerLiveActivity, pushLiveActivityOnGame } from "./callable/liveActivities";

import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 20 });

// Profile / identity
// Moved on-device (direct Firestore + firestore.rules):
//   checkUsername, setFeaturedTrophy, updateFavoriteTeams, setPlayLimits,
//   setAlertPrefs, unblockUser, acceptTerms, setMoveLoadout, setBackground,
//   setMuteTaunts, listFriends
export { createProfile, updateAvatar, searchUsers } from "./callable/profile";
export { saveAppearance } from "./callable/avatar";
export { getPlayerProfile } from "./callable/players";
export { getGameInsights } from "./callable/insights";
export { registerPushToken } from "./callable/push";
export { deleteAccount, blockUser, reportContent } from "./callable/account";

// Social graph
export {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
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
export { purchaseMove } from "./callable/moves";
export { purchaseBackground } from "./callable/backgrounds";
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
export { makeDailyPick, placeFreeBet } from "./callable/dailyPick";
export { getWeeklyQuests, claimQuest } from "./callable/quests";
export { getLevelChallenges, claimLevelChallenge, recordChallengeAction } from "./callable/levelChallenges";
export { createGroupParlay, addParlayLeg, lockParlay, rideParlay } from "./callable/parlays";
export { placeParlay, cancelParlay } from "./callable/slipParlays";

// Background jobs (consolidated from 17 crons down to 5)
// - syncLiveGames removed (eliminates 45s idle sleep billing every minute)
// - onGameFinal trigger removed (syncGames calls handleGameTransition directly)
// - scheduleDailyPick folded into leagueSweep
// - 12 daily/weekly/monthly/yearly jobs consolidated into dailyMaintenance
export { syncGames } from "./scheduled/syncGames";
export { settleBetsSweep } from "./scheduled/settleBets";
export { leagueSweep } from "./scheduled/leagues";
// teamReminders moved on-device (artifacts/mobile/lib/localReminders.ts schedules it locally).
export { lockReminders } from "./scheduled/reminders";
export { dailyMaintenance } from "./scheduled/maintenance";

// Side effects of committed writes (never inside a money transaction)
// challengesOnBet and challengesOnParlay removed (xpOnLedger + placeFreeBet already run autoClaimSoon)
export { pushOnNotification } from "./triggers/push";
export { pushOnDirectMessage, pushOnLeagueMessage, notifyOnDmReaction, moderateBetComment } from "./triggers/chatPush";
export { xpOnLedger, xpOnLeagueBet, xpOnFriendship } from "./triggers/xp";
export { friendStreakOnPick } from "./triggers/friendStreak";
export { bundleCatalog, bundleMoves, bundleBackgrounds } from "./triggers/bundles";

// Test data for the app's dev launch flags. Off unless DEV_TOOLS=1 or the emulator.
export { devTools } from "./callable/dev";

export { sendTaunt } from "./callable/taunts";
export { claimSeasonTier } from "./callable/seasonPass";
export { submitBracket } from "./callable/brackets";
// Apple Live Activities: off until there's an Apple Developer account and APNs key.
// Re-enable this export (and set APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID) to turn them on.
// export { registerLiveActivity, pushLiveActivityOnGame } from "./callable/liveActivities";

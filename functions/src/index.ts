import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 20 });

// Profile / identity
export { createProfile, checkUsername, updateAvatar, searchUsers } from "./callable/profile";
export { saveAppearance } from "./callable/avatar";

// Social graph
export {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  listFriends,
} from "./callable/friends";

// Economy
export { placeBet, cancelBet } from "./callable/bets";
export { purchaseItem, equipItem } from "./callable/shop";
export { openPrizeBox, claimPrizeBox, resetPrizeBox } from "./callable/prizes";

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
} from "./callable/leagues";

// Background jobs
export { syncGames, pruneGames } from "./scheduled/syncGames";
export { onGameFinal, settleBetsSweep, refundStaleBets } from "./scheduled/settleBets";
export { leagueSweep } from "./scheduled/leagues";

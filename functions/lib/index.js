"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leagueSweep = exports.refundStaleBets = exports.settleBetsSweep = exports.onGameFinal = exports.pruneGames = exports.syncGames = exports.peerLoanAction = exports.requestPeerLoan = exports.repayLoan = exports.takeBankLoan = exports.placeLeagueBet = exports.endLeague = exports.inviteToLeague = exports.updateLeagueSettings = exports.leaveLeague = exports.joinLeague = exports.createLeague = exports.claimAdReward = exports.admobReward = exports.resetPrizeBox = exports.claimPrizeBox = exports.openPrizeBox = exports.equipItem = exports.purchaseItem = exports.cancelBet = exports.placeBet = exports.listFriends = exports.removeFriend = exports.respondFriendRequest = exports.sendFriendRequest = exports.getGameInsights = exports.updateFavoriteTeams = exports.getPlayerProfile = exports.saveAppearance = exports.searchUsers = exports.updateAvatar = exports.checkUsername = exports.createProfile = void 0;
const v2_1 = require("firebase-functions/v2");
(0, v2_1.setGlobalOptions)({ region: "us-central1", maxInstances: 20 });
// Profile / identity
var profile_1 = require("./callable/profile");
Object.defineProperty(exports, "createProfile", { enumerable: true, get: function () { return profile_1.createProfile; } });
Object.defineProperty(exports, "checkUsername", { enumerable: true, get: function () { return profile_1.checkUsername; } });
Object.defineProperty(exports, "updateAvatar", { enumerable: true, get: function () { return profile_1.updateAvatar; } });
Object.defineProperty(exports, "searchUsers", { enumerable: true, get: function () { return profile_1.searchUsers; } });
var avatar_1 = require("./callable/avatar");
Object.defineProperty(exports, "saveAppearance", { enumerable: true, get: function () { return avatar_1.saveAppearance; } });
var players_1 = require("./callable/players");
Object.defineProperty(exports, "getPlayerProfile", { enumerable: true, get: function () { return players_1.getPlayerProfile; } });
Object.defineProperty(exports, "updateFavoriteTeams", { enumerable: true, get: function () { return players_1.updateFavoriteTeams; } });
var insights_1 = require("./callable/insights");
Object.defineProperty(exports, "getGameInsights", { enumerable: true, get: function () { return insights_1.getGameInsights; } });
// Social graph
var friends_1 = require("./callable/friends");
Object.defineProperty(exports, "sendFriendRequest", { enumerable: true, get: function () { return friends_1.sendFriendRequest; } });
Object.defineProperty(exports, "respondFriendRequest", { enumerable: true, get: function () { return friends_1.respondFriendRequest; } });
Object.defineProperty(exports, "removeFriend", { enumerable: true, get: function () { return friends_1.removeFriend; } });
Object.defineProperty(exports, "listFriends", { enumerable: true, get: function () { return friends_1.listFriends; } });
// Economy
var bets_1 = require("./callable/bets");
Object.defineProperty(exports, "placeBet", { enumerable: true, get: function () { return bets_1.placeBet; } });
Object.defineProperty(exports, "cancelBet", { enumerable: true, get: function () { return bets_1.cancelBet; } });
var shop_1 = require("./callable/shop");
Object.defineProperty(exports, "purchaseItem", { enumerable: true, get: function () { return shop_1.purchaseItem; } });
Object.defineProperty(exports, "equipItem", { enumerable: true, get: function () { return shop_1.equipItem; } });
var prizes_1 = require("./callable/prizes");
Object.defineProperty(exports, "openPrizeBox", { enumerable: true, get: function () { return prizes_1.openPrizeBox; } });
Object.defineProperty(exports, "claimPrizeBox", { enumerable: true, get: function () { return prizes_1.claimPrizeBox; } });
Object.defineProperty(exports, "resetPrizeBox", { enumerable: true, get: function () { return prizes_1.resetPrizeBox; } });
var adReward_1 = require("./http/adReward");
Object.defineProperty(exports, "admobReward", { enumerable: true, get: function () { return adReward_1.admobReward; } });
Object.defineProperty(exports, "claimAdReward", { enumerable: true, get: function () { return adReward_1.claimAdReward; } });
// Leagues — every league mutation goes through one of these.
var leagues_1 = require("./callable/leagues");
Object.defineProperty(exports, "createLeague", { enumerable: true, get: function () { return leagues_1.createLeague; } });
Object.defineProperty(exports, "joinLeague", { enumerable: true, get: function () { return leagues_1.joinLeague; } });
Object.defineProperty(exports, "leaveLeague", { enumerable: true, get: function () { return leagues_1.leaveLeague; } });
Object.defineProperty(exports, "updateLeagueSettings", { enumerable: true, get: function () { return leagues_1.updateLeagueSettings; } });
Object.defineProperty(exports, "inviteToLeague", { enumerable: true, get: function () { return leagues_1.inviteToLeague; } });
Object.defineProperty(exports, "endLeague", { enumerable: true, get: function () { return leagues_1.endLeague; } });
Object.defineProperty(exports, "placeLeagueBet", { enumerable: true, get: function () { return leagues_1.placeLeagueBet; } });
Object.defineProperty(exports, "takeBankLoan", { enumerable: true, get: function () { return leagues_1.takeBankLoan; } });
Object.defineProperty(exports, "repayLoan", { enumerable: true, get: function () { return leagues_1.repayLoan; } });
Object.defineProperty(exports, "requestPeerLoan", { enumerable: true, get: function () { return leagues_1.requestPeerLoan; } });
Object.defineProperty(exports, "peerLoanAction", { enumerable: true, get: function () { return leagues_1.peerLoanAction; } });
// Background jobs
var syncGames_1 = require("./scheduled/syncGames");
Object.defineProperty(exports, "syncGames", { enumerable: true, get: function () { return syncGames_1.syncGames; } });
Object.defineProperty(exports, "pruneGames", { enumerable: true, get: function () { return syncGames_1.pruneGames; } });
var settleBets_1 = require("./scheduled/settleBets");
Object.defineProperty(exports, "onGameFinal", { enumerable: true, get: function () { return settleBets_1.onGameFinal; } });
Object.defineProperty(exports, "settleBetsSweep", { enumerable: true, get: function () { return settleBets_1.settleBetsSweep; } });
Object.defineProperty(exports, "refundStaleBets", { enumerable: true, get: function () { return settleBets_1.refundStaleBets; } });
var leagues_2 = require("./scheduled/leagues");
Object.defineProperty(exports, "leagueSweep", { enumerable: true, get: function () { return leagues_2.leagueSweep; } });
//# sourceMappingURL=index.js.map
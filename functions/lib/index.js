"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundStaleBets = exports.settleBetsSweep = exports.onGameFinal = exports.pruneGames = exports.syncGames = exports.payLeagueBuyIn = exports.resetPrizeBox = exports.claimPrizeBox = exports.openPrizeBox = exports.equipItem = exports.purchaseItem = exports.cancelBet = exports.placeBet = exports.listFriends = exports.removeFriend = exports.respondFriendRequest = exports.sendFriendRequest = exports.searchUsers = exports.updateAvatar = exports.checkUsername = exports.createProfile = void 0;
const v2_1 = require("firebase-functions/v2");
(0, v2_1.setGlobalOptions)({ region: "us-central1", maxInstances: 20 });
// Profile / identity
var profile_1 = require("./callable/profile");
Object.defineProperty(exports, "createProfile", { enumerable: true, get: function () { return profile_1.createProfile; } });
Object.defineProperty(exports, "checkUsername", { enumerable: true, get: function () { return profile_1.checkUsername; } });
Object.defineProperty(exports, "updateAvatar", { enumerable: true, get: function () { return profile_1.updateAvatar; } });
Object.defineProperty(exports, "searchUsers", { enumerable: true, get: function () { return profile_1.searchUsers; } });
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
var leagues_1 = require("./callable/leagues");
Object.defineProperty(exports, "payLeagueBuyIn", { enumerable: true, get: function () { return leagues_1.payLeagueBuyIn; } });
// Background jobs
var syncGames_1 = require("./scheduled/syncGames");
Object.defineProperty(exports, "syncGames", { enumerable: true, get: function () { return syncGames_1.syncGames; } });
Object.defineProperty(exports, "pruneGames", { enumerable: true, get: function () { return syncGames_1.pruneGames; } });
var settleBets_1 = require("./scheduled/settleBets");
Object.defineProperty(exports, "onGameFinal", { enumerable: true, get: function () { return settleBets_1.onGameFinal; } });
Object.defineProperty(exports, "settleBetsSweep", { enumerable: true, get: function () { return settleBets_1.settleBetsSweep; } });
Object.defineProperty(exports, "refundStaleBets", { enumerable: true, get: function () { return settleBets_1.refundStaleBets; } });
//# sourceMappingURL=index.js.map
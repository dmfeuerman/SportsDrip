"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.questProgressRef = questProgressRef;
exports.nextReactionProgress = nextReactionProgress;
const economy_1 = require("./economy");
const weekly_1 = require("./weekly");
/**
 * Social quest progress: distinct items of someone else's a player reacted to
 * this H2H week. Stored as a set (reacted.{key}) so toggling a reaction off and
 * on can't farm the quest; `reactions` is the set's size.
 */
function questProgressRef(uid, now = Date.now()) {
    return economy_1.db.collection("users").doc(uid).collection("questProgress").doc((0, weekly_1.weekKey)(now));
}
/** Pure: next progress doc fields, or null when this item was already counted. */
function nextReactionProgress(current, key) {
    const reacted = { ...(current?.reacted ?? {}) };
    if (reacted[key])
        return null;
    reacted[key] = true;
    return { reacted, reactions: Object.keys(reacted).length };
}
//# sourceMappingURL=questProgress.js.map
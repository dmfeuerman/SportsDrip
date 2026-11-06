"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIN_BACK_STAGES = void 0;
exports.dueWinBackStage = dueWinBackStage;
exports.winBackCopy = winBackCopy;
exports.canClaimWinBack = canClaimWinBack;
const streak_1 = require("./streak");
/**
 * Lapsed-player win-back. "Inactive" = no qualifying pick (users.streak.lastDay)
 * for exactly N ET days, N in WIN_BACK_STAGES. Pure for tests.
 */
exports.WIN_BACK_STAGES = [3, 7, 14];
/** Stage due today for a user last active on `lastDay`, or null. Each stage fires once per lapse. */
function dueWinBackStage(lastDay, today, prev) {
    if (!lastDay)
        return null;
    const diff = (0, streak_1.dayNumber)(today) - (0, streak_1.dayNumber)(lastDay);
    const stage = exports.WIN_BACK_STAGES.includes(diff) ? diff : null;
    if (!stage)
        return null;
    if (prev?.lastDay === lastDay && (prev.stage ?? 0) >= stage)
        return null;
    return stage;
}
function winBackCopy(stage, name) {
    const who = name ? `${name}, ` : "";
    switch (stage) {
        case 3:
            return { title: `${who}your crew's still picking`, body: "Jump back in — a returning-player Prize Box is waiting for you." };
        case 7:
            return { title: "It's been a week 👀", body: "Your Prize Box is on the house. Open the app to claim it." };
        default:
            return { title: "We saved you a box", body: "Two weeks out — come back and grab your returning-player Prize Box." };
    }
}
/** The returning-player box is claimable once the user has a pending win-back. */
function canClaimWinBack(state) {
    return !!state?.pending && !!state.lastDay;
}
//# sourceMappingURL=winBack.js.map
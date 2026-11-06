"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEAVING_SOON_MS = void 0;
exports.windowState = windowState;
exports.isLeavingSoon = isLeavingSoon;
exports.windowError = windowError;
exports.LEAVING_SOON_MS = 72 * 3600_000;
function windowState(item, now) {
    if (item.available === false)
        return "disabled";
    const from = Math.max(num(item.releaseAt), num(item.availableFrom));
    if (from && from > now)
        return "upcoming";
    const until = num(item.availableUntil);
    if (until && until <= now)
        return "expired";
    return "on_sale";
}
function isLeavingSoon(item, now) {
    const until = num(item.availableUntil);
    return windowState(item, now) === "on_sale" && !!until && until - now <= exports.LEAVING_SOON_MS;
}
function windowError(state) {
    switch (state) {
        case "disabled":
            return "That item isn't available right now.";
        case "upcoming":
            return "That item hasn't dropped yet.";
        case "expired":
            return "That item has left the shop.";
        default:
            return null;
    }
}
function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
//# sourceMappingURL=storeWindow.js.map
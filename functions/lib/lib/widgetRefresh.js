"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWidgetRefresh = sendWidgetRefresh;
const push_1 = require("../callable/push");
const push_2 = require("./push");
/**
 * Silent (content-available) push that wakes the app to rewrite the home-screen
 * widget snapshot. No alert, no sound, so it never counts against the
 * engagement budget. Best effort.
 */
async function sendWidgetRefresh(uids) {
    const docs = await Promise.all(uids.map((u) => (0, push_1.pushDocRef)(u).get().catch(() => null)));
    const tokens = docs.flatMap((d) => (d?.get("pushTokens") ?? []).map((t) => t.token)).filter(Boolean);
    if (!tokens.length)
        return 0;
    const messages = tokens.map((to) => ({ to, _contentAvailable: true, priority: "normal", data: { kind: "widget_refresh" } }));
    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
        const res = await fetch(push_2.EXPO_PUSH_URL, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(messages.slice(i, i + 100)),
        }).catch(() => null);
        if (res?.ok)
            sent += Math.min(100, messages.length - i);
    }
    return sent;
}
//# sourceMappingURL=widgetRefresh.js.map
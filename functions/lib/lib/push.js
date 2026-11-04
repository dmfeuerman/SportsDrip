"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpoPushToken = exports.MAX_TOKENS_PER_USER = exports.EXPO_PUSH_URL = void 0;
exports.buildPushMessages = buildPushMessages;
exports.mergeToken = mergeToken;
exports.sendExpoPush = sendExpoPush;
const firebase_functions_1 = require("firebase-functions");
const notifyModel_1 = require("./notifyModel");
/**
 * Expo push delivery (APNs behind it). Pure builders plus one HTTP call; no
 * Firestore here, and nothing in this file is ever awaited inside a money
 * transaction — the trigger in triggers/push.ts runs after the commit.
 */
exports.EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const CHUNK = 100;
exports.MAX_TOKENS_PER_USER = 10;
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
const isExpoPushToken = (t) => typeof t === "string" && t.length <= 256 && TOKEN_RE.test(t);
exports.isExpoPushToken = isExpoPushToken;
/** One message per device for a notification document. */
function buildPushMessages(n, tokens, badge) {
    const data = {
        notificationId: n.id,
        type: n.type,
        url: (0, notifyModel_1.notificationRoute)(n),
    };
    if (n.leagueId)
        data.leagueId = n.leagueId;
    return tokens.filter(exports.isExpoPushToken).map((to) => ({
        to,
        title: n.title.slice(0, 120),
        body: n.body.slice(0, 400),
        sound: "default",
        priority: "high",
        ...(badge !== null && badge >= 0 ? { badge } : {}),
        data,
    }));
}
/** Keeps the newest MAX_TOKENS_PER_USER, one entry per token. */
function mergeToken(existing, token, now) {
    const rest = existing.filter((t) => t && t.token !== token);
    return [{ token, platform: "ios", updatedAt: now }, ...rest]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, exports.MAX_TOKENS_PER_USER);
}
/**
 * Sends and returns the tokens Expo says are dead (app uninstalled, token
 * rotated), so the caller can prune them. Network failures are logged and
 * swallowed: a missed push is never worth failing the trigger over.
 */
async function sendExpoPush(messages) {
    const deadTokens = [];
    let sent = 0;
    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };
    // Required only if "Enhanced push security" is on for the Expo project.
    if (process.env.EXPO_ACCESS_TOKEN)
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        try {
            const res = await fetch(exports.EXPO_PUSH_URL, {
                method: "POST",
                headers,
                body: JSON.stringify(chunk),
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                firebase_functions_1.logger.warn("expo push rejected", { status: res.status, body: (await res.text()).slice(0, 500) });
                continue;
            }
            const json = (await res.json());
            (json.data ?? []).forEach((ticket, j) => {
                if (ticket.status === "ok")
                    sent++;
                else if (ticket.details?.error === "DeviceNotRegistered")
                    deadTokens.push(chunk[j].to);
                else
                    firebase_functions_1.logger.warn("expo push ticket error", { error: ticket.details?.error, message: ticket.message });
            });
        }
        catch (err) {
            firebase_functions_1.logger.warn("expo push failed", { error: String(err) });
        }
    }
    return { sent, deadTokens };
}
//# sourceMappingURL=push.js.map
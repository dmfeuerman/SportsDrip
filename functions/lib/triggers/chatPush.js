"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushOnLeagueMessage = exports.pushOnDirectMessage = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const chatText_1 = require("../lib/chatText");
const push_1 = require("../lib/push");
const push_2 = require("../callable/push");
/**
 * Chat pushes. Chat messages are not notification documents (they'd flood the
 * activity feed), so they fan out to the recipients' phones directly. While
 * the app is open the in-app chat banner shows instead (lib/push.ts hides the
 * system banner in the foreground).
 */
async function tokensFor(uid) {
    const snap = await (0, push_2.pushDocRef)(uid).get();
    return (snap.get("pushTokens") ?? [])
        .map((t) => t?.token)
        .filter((t) => (0, push_1.isExpoPushToken)(t));
}
async function prune(uid, dead) {
    if (!dead.length)
        return;
    await economy_1.db.runTransaction(async (tx) => {
        const doc = await tx.get((0, push_2.pushDocRef)(uid));
        const live = (doc.get("pushTokens") ?? []).filter((t) => t && !dead.includes(t.token));
        tx.set((0, push_2.pushDocRef)(uid), { pushTokens: live, updatedAt: Date.now() }, { merge: true });
    });
}
/** Claims the push on the message doc so a redelivered event never pushes twice. */
async function claim(ref) {
    return economy_1.db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists || fresh.get("pushedAt"))
            return false;
        tx.update(ref, { pushedAt: Date.now() });
        return true;
    });
}
async function pushTo(uids, build) {
    let sent = 0;
    await Promise.all(uids.map(async (uid) => {
        const tokens = await tokensFor(uid);
        if (!tokens.length)
            return;
        const res = await (0, push_1.sendExpoPush)(tokens.map(build));
        sent += res.sent;
        await prune(uid, res.deadTokens).catch(() => { });
    }));
    return sent;
}
const preview = (text) => {
    const t = (0, chatText_1.chatText)(text).trim();
    return t.length > 180 ? `${t.slice(0, 177)}…` : t;
};
exports.pushOnDirectMessage = (0, firestore_1.onDocumentCreated)({ document: "directMessages/{threadId}/messages/{messageId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const m = snap.data();
    if (m.kind !== "text" || !m.senderUid || !m.recipientUid || m.senderUid === m.recipientUid)
        return;
    // The thread id names both members; ignore anything that doesn't match.
    const parts = event.params.threadId.split("_");
    if (parts[0] !== "dm" || !parts.includes(m.senderUid) || !parts.includes(m.recipientUid))
        return;
    if (!(await claim(snap.ref)))
        return;
    const name = m.senderName || "A friend";
    const url = `/messages?uid=${encodeURIComponent(m.senderUid)}&name=${encodeURIComponent(name)}`;
    const sent = await pushTo([m.recipientUid], (to) => ({
        to,
        title: name,
        body: preview(m.text ?? ""),
        sound: "default",
        priority: "high",
        data: { type: "chat_dm", url, threadId: event.params.threadId },
    }));
    firebase_functions_1.logger.info("dm push sent", { threadId: event.params.threadId, sent });
});
exports.pushOnLeagueMessage = (0, firestore_1.onDocumentCreated)({ document: "leagues/{leagueId}/messages/{messageId}", region: "us-central1", timeoutSeconds: 60 }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const m = snap.data();
    // Real chat only — bet cards and system rows already notify through their own paths.
    if (m.kind !== "text" || !m.uid)
        return;
    const leagueId = event.params.leagueId;
    const league = await economy_1.db.collection("leagues").doc(leagueId).get();
    if (!league.exists)
        return;
    const recipients = (league.get("memberIds") ?? []).filter((u) => u !== m.uid);
    if (!recipients.length)
        return;
    if (!(await claim(snap.ref)))
        return;
    const leagueName = league.get("name") || "League chat";
    const url = `/messages?leagueId=${encodeURIComponent(leagueId)}`;
    const sent = await pushTo(recipients, (to) => ({
        to,
        title: `${m.name || "League-mate"} · ${leagueName}`,
        body: preview(m.text ?? ""),
        sound: "default",
        priority: "high",
        data: { type: "chat_league", url, leagueId },
    }));
    firebase_functions_1.logger.info("league chat push sent", { leagueId, recipients: recipients.length, sent });
});
//# sourceMappingURL=chatPush.js.map
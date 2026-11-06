"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushOnNotification = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const economy_1 = require("../lib/economy");
const push_1 = require("../lib/push");
const push_2 = require("../callable/push");
const pushBudget_1 = require("../lib/pushBudget");
const streak_1 = require("../lib/streak");
/**
 * Fans every in-app notification out to the user's phones.
 *
 * Runs as a side effect of the notification document being created — never
 * inside the settlement / ledger transaction that wrote it — so a slow or
 * failing Expo request can't hold a money transaction open or roll it back.
 *
 * Settlement re-writes notifications under deterministic ids on replay; that
 * is an update, not a create, so a replay never pushes twice. `pushedAt`
 * guards the rarer case of this trigger itself being delivered twice.
 */
exports.pushOnNotification = (0, firestore_1.onDocumentCreated)({ document: "users/{uid}/notifications/{notificationId}", region: "us-central1", timeoutSeconds: 30 }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const uid = event.params.uid;
    const n = snap.data();
    if (!n || n.push === false || !n.title || !n.type)
        return;
    const tokensSnap = await (0, push_2.pushDocRef)(uid).get();
    const tokens = (tokensSnap.get("pushTokens") ?? []).map((t) => t?.token).filter(Boolean);
    if (tokens.length === 0)
        return;
    const now = Date.now();
    const userRef = economy_1.db.collection("users").doc(uid);
    const engagement = (0, pushBudget_1.classifyPush)(n.type) === "engagement";
    let recentLoss = false;
    if (engagement && pushBudget_1.BET_PROMPT_TYPES.has(n.type)) {
        const losses = await userRef
            .collection("notifications")
            .where("type", "in", pushBudget_1.LOSS_TYPES)
            .where("createdAtMs", ">=", now - pushBudget_1.RECENT_LOSS_MS)
            .limit(1)
            .get()
            .catch(() => null);
        // If the check fails, err toward not prompting.
        recentLoss = losses ? !losses.empty : true;
    }
    // Claim the push (and spend budget) atomically. If another delivery already did, stop.
    const claimed = await economy_1.db.runTransaction(async (tx) => {
        const fresh = await tx.get(snap.ref);
        if (!fresh.exists || fresh.get("pushedAt"))
            return false;
        if (!engagement) {
            tx.update(snap.ref, { pushedAt: now });
            return true;
        }
        const user = await tx.get(userRef);
        const tz = user.get("tz");
        const budgetRef = userRef.collection("pushBudget").doc((0, pushBudget_1.localDay)(now, tz));
        const budget = await tx.get(budgetRef);
        const picks = user.get("picksToday");
        const cap = user.get("limits.dailyPicks");
        const decision = (0, pushBudget_1.decidePush)({
            type: n.type,
            now,
            tz,
            quietHours: user.get("quietHours"),
            sentToday: budget.get("count") ?? 0,
            breakUntil: user.get("limits.breakUntil"),
            atDailyLimit: typeof cap === "number" && cap > 0 && picks?.day === (0, streak_1.nyDay)(now) && (picks.count ?? 0) >= cap,
            recentLoss,
        });
        if (!decision.send) {
            tx.update(snap.ref, { pushedAt: now, pushSuppressed: decision.reason });
            return false;
        }
        tx.update(snap.ref, { pushedAt: now });
        tx.set(budgetRef, { count: (budget.get("count") ?? 0) + 1, updatedAt: now }, { merge: true });
        return true;
    });
    if (!claimed)
        return;
    let badge = null;
    try {
        const unread = await economy_1.db.collection("users").doc(uid).collection("notifications").where("read", "==", false).count().get();
        badge = unread.data().count;
    }
    catch (err) {
        firebase_functions_1.logger.debug("badge count unavailable", { error: String(err) });
    }
    const messages = (0, push_1.buildPushMessages)({
        id: snap.id,
        type: n.type,
        title: n.title,
        body: n.body ?? "",
        leagueId: n.leagueId ?? null,
        wallet: n.wallet ?? "credits",
        data: n.data ?? null,
    }, tokens, badge);
    const { sent, deadTokens } = await (0, push_1.sendExpoPush)(messages);
    if (deadTokens.length) {
        await economy_1.db.runTransaction(async (tx) => {
            const doc = await tx.get((0, push_2.pushDocRef)(uid));
            const live = (doc.get("pushTokens") ?? []).filter((t) => t && !deadTokens.includes(t.token));
            tx.set((0, push_2.pushDocRef)(uid), { pushTokens: live, updatedAt: Date.now() }, { merge: true });
        });
    }
    await snap.ref.update({ pushSent: sent }).catch(() => { });
    firebase_functions_1.logger.info("push sent", { uid, type: n.type, sent, pruned: deadTokens.length });
});
//# sourceMappingURL=push.js.map
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { buildPushMessages, sendExpoPush, type StoredPushToken } from "../lib/push";
import type { NotificationModel } from "../lib/notifyModel";
import { pushDocRef } from "../callable/push";
import { classifyPush, decidePush, localDay, LOSS_TYPES, RECENT_LOSS_MS, BET_PROMPT_TYPES } from "../lib/pushBudget";
import { nyDay } from "../lib/streak";

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
export const pushOnNotification = onDocumentCreated(
  { document: "users/{uid}/notifications/{notificationId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const uid = event.params.uid;
    const n = snap.data() as Partial<NotificationModel> & { push?: boolean };
    if (!n || n.push === false || !n.title || !n.type) return;

    const tokensSnap = await pushDocRef(uid).get();
    const tokens = ((tokensSnap.get("pushTokens") as StoredPushToken[] | undefined) ?? []).map((t) => t?.token).filter(Boolean) as string[];
    if (tokens.length === 0) return;

    const now = Date.now();
    const userRef = db.collection("users").doc(uid);
    const engagement = classifyPush(n.type) === "engagement";
    let recentLoss = false;
    if (engagement && BET_PROMPT_TYPES.has(n.type)) {
      const losses = await userRef
        .collection("notifications")
        .where("type", "in", LOSS_TYPES)
        .where("createdAtMs", ">=", now - RECENT_LOSS_MS)
        .limit(1)
        .get()
        .catch(() => null);
      // If the check fails, err toward not prompting.
      recentLoss = losses ? !losses.empty : true;
    }

    // Claim the push (and spend budget) atomically. If another delivery already did, stop.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      if (!fresh.exists || fresh.get("pushedAt")) return false;
      if (!engagement) {
        tx.update(snap.ref, { pushedAt: now });
        return true;
      }
      const user = await tx.get(userRef);
      const tz = user.get("tz") as string | undefined;
      const budgetRef = userRef.collection("pushBudget").doc(localDay(now, tz));
      const budget = await tx.get(budgetRef);
      const picks = user.get("picksToday") as { day?: string; count?: number } | undefined;
      const cap = user.get("limits.dailyPicks") as number | null | undefined;
      const decision = decidePush({
        type: n.type!,
        now,
        tz,
        quietHours: user.get("quietHours") as boolean | undefined,
        sentToday: (budget.get("count") as number | undefined) ?? 0,
        breakUntil: user.get("limits.breakUntil") as number | undefined,
        atDailyLimit: typeof cap === "number" && cap > 0 && picks?.day === nyDay(now) && (picks.count ?? 0) >= cap,
        recentLoss,
      });
      if (!decision.send) {
        tx.update(snap.ref, { pushedAt: now, pushSuppressed: decision.reason });
        return false;
      }
      tx.update(snap.ref, { pushedAt: now });
      tx.set(budgetRef, { count: ((budget.get("count") as number | undefined) ?? 0) + 1, updatedAt: now }, { merge: true });
      return true;
    });
    if (!claimed) return;

    let badge: number | null = null;
    try {
      const unread = await db.collection("users").doc(uid).collection("notifications").where("read", "==", false).count().get();
      badge = unread.data().count;
    } catch (err) {
      logger.debug("badge count unavailable", { error: String(err) });
    }

    const messages = buildPushMessages(
      {
        id: snap.id,
        type: n.type,
        title: n.title,
        body: n.body ?? "",
        leagueId: n.leagueId ?? null,
        wallet: n.wallet ?? "credits",
        data: n.data ?? null,
      },
      tokens,
      badge
    );
    const { sent, deadTokens } = await sendExpoPush(messages);

    if (deadTokens.length) {
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(pushDocRef(uid));
        const live = ((doc.get("pushTokens") as StoredPushToken[] | undefined) ?? []).filter((t) => t && !deadTokens.includes(t.token));
        tx.set(pushDocRef(uid), { pushTokens: live, updatedAt: Date.now() }, { merge: true });
      });
    }
    await snap.ref.update({ pushSent: sent }).catch(() => {});
    logger.info("push sent", { uid, type: n.type, sent, pruned: deadTokens.length });
  }
);

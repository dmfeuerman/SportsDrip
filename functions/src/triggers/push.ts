import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { buildPushMessages, sendExpoPush, type StoredPushToken } from "../lib/push";
import type { NotificationModel } from "../lib/notifyModel";
import { pushDocRef } from "../callable/push";

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

    // Claim the push. If another delivery of this event already did, stop.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      if (!fresh.exists || fresh.get("pushedAt")) return false;
      tx.update(snap.ref, { pushedAt: Date.now() });
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

import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { chatText } from "../lib/chatText";
import { isExpoPushToken, sendExpoPush, type ExpoPushMessage, type StoredPushToken } from "../lib/push";
import { pushDocRef } from "../callable/push";

/**
 * Chat pushes. Chat messages are not notification documents (they'd flood the
 * activity feed), so they fan out to the recipients' phones directly. While
 * the app is open the in-app chat banner shows instead (lib/push.ts hides the
 * system banner in the foreground).
 */

async function tokensFor(uid: string): Promise<string[]> {
  const snap = await pushDocRef(uid).get();
  return ((snap.get("pushTokens") as StoredPushToken[] | undefined) ?? [])
    .map((t) => t?.token)
    .filter((t): t is string => isExpoPushToken(t));
}

async function prune(uid: string, dead: string[]) {
  if (!dead.length) return;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(pushDocRef(uid));
    const live = ((doc.get("pushTokens") as StoredPushToken[] | undefined) ?? []).filter((t) => t && !dead.includes(t.token));
    tx.set(pushDocRef(uid), { pushTokens: live, updatedAt: Date.now() }, { merge: true });
  });
}

/** Claims the push on the message doc so a redelivered event never pushes twice. */
async function claim(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists || fresh.get("pushedAt")) return false;
    tx.update(ref, { pushedAt: Date.now() });
    return true;
  });
}

async function pushTo(uids: string[], build: (token: string) => ExpoPushMessage) {
  let sent = 0;
  await Promise.all(
    uids.map(async (uid) => {
      const tokens = await tokensFor(uid);
      if (!tokens.length) return;
      const res = await sendExpoPush(tokens.map(build));
      sent += res.sent;
      await prune(uid, res.deadTokens).catch(() => {});
    })
  );
  return sent;
}

const preview = (text: string) => {
  const t = chatText(text).trim();
  return t.length > 180 ? `${t.slice(0, 177)}…` : t;
};

export const pushOnDirectMessage = onDocumentCreated(
  { document: "directMessages/{threadId}/messages/{messageId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const m = snap.data() as { senderUid?: string; senderName?: string; recipientUid?: string; text?: string; kind?: string };
    if (m.kind !== "text" || !m.senderUid || !m.recipientUid || m.senderUid === m.recipientUid) return;
    // The thread id names both members; ignore anything that doesn't match.
    const parts = event.params.threadId.split("_");
    if (parts[0] !== "dm" || !parts.includes(m.senderUid) || !parts.includes(m.recipientUid)) return;
    if (!(await claim(snap.ref))) return;

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
    logger.info("dm push sent", { threadId: event.params.threadId, sent });
  }
);

export const pushOnLeagueMessage = onDocumentCreated(
  { document: "leagues/{leagueId}/messages/{messageId}", region: "us-central1", timeoutSeconds: 60 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const m = snap.data() as { uid?: string; name?: string; text?: string; kind?: string; gameId?: string };
    // Real chat only — bet cards and system rows already notify through their own paths.
    if (m.kind !== "text" || !m.uid) return;
    // Game-thread chatter is in-app only; push for game threads is off by default.
    if (m.gameId) return;
    const leagueId = event.params.leagueId;
    const league = await db.collection("leagues").doc(leagueId).get();
    if (!league.exists) return;
    const recipients = ((league.get("memberIds") as string[] | undefined) ?? []).filter((u) => u !== m.uid);
    if (!recipients.length) return;
    if (!(await claim(snap.ref))) return;

    const leagueName = (league.get("name") as string | undefined) || "League chat";
    const url = `/messages?leagueId=${encodeURIComponent(leagueId)}`;
    const sent = await pushTo(recipients, (to) => ({
      to,
      title: `${m.name || "League-mate"} · ${leagueName}`,
      body: preview(m.text ?? ""),
      sound: "default",
      priority: "high",
      data: { type: "chat_league", url, leagueId },
    }));
    logger.info("league chat push sent", { leagueId, recipients: recipients.length, sent });
  }
);

/**
 * DM reactions reach the sender: one in-app notification per message per hour
 * (fixed id), pushed only when first created.
 */
export const notifyOnDmReaction = onDocumentUpdated(
  { document: "directMessages/{threadId}/messages/{messageId}", region: "us-central1", timeoutSeconds: 30 },
  async (event) => {
    const before = (event.data?.before.get("reactors") as Record<string, string> | undefined) ?? {};
    const after = (event.data?.after.get("reactors") as Record<string, string> | undefined) ?? {};
    const sender = event.data?.after.get("senderUid") as string | undefined;
    const recipient = event.data?.after.get("recipientUid") as string | undefined;
    if (!sender || !recipient) return;
    const emoji = after[recipient];
    if (!emoji || before[recipient] === emoji) return;
    const name = (event.data?.after.get("recipientName") as string | undefined) ?? "A friend";
    const hour = Math.floor(Date.now() / 3_600_000);
    await db.runTransaction(async (tx) => {
      writeNotification(
        tx,
        sender,
        simpleNotification({
          id: `dmreact_${event.params.messageId}_${hour}`.slice(0, 120),
          type: "reaction",
          title: `${name} ${emoji} your message`,
          body: String(event.data?.after.get("text") ?? "").slice(0, 80),
          now: Date.now(),
          data: { friendUid: recipient },
        })
      );
    });
  }
);

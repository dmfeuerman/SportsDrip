import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { TERMS_VERSION } from "../lib/legal";
import { birthdayRef } from "../scheduled/birthdays";

/**
 * Account-level actions App Review requires: delete account (5.1.1(v)) and
 * the user-generated-content tools (1.2): block, report, accept terms.
 */

export const blockRef = (owner: string, other: string) => db.collection("users").doc(owner).collection("blocks").doc(other);

/** True if either player has blocked the other. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([blockRef(a, b).get(), blockRef(b, a).get()]);
  return x.exists || y.exists;
}

const OtherUid = z.object({ otherUid: z.string().min(1).max(128) });

/** Blocks a player: hides their messages, unfriends, and stops DMs and friend requests both ways. */
export const blockUser = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { otherUid } = OtherUid.parse(req.data);
  if (otherUid === me) throw new HttpsError("invalid-argument", "You can't block yourself.");
  const batch = db.batch();
  batch.set(blockRef(me, otherUid), { uid: otherUid, at: Date.now() });
  batch.delete(db.collection("friendships").doc(pairId(me, otherUid)));
  batch.delete(db.collection("friendRequests").doc(`${me}_${otherUid}`));
  batch.delete(db.collection("friendRequests").doc(`${otherUid}_${me}`));
  await batch.commit();
  return { ok: true as const };
});

export const unblockUser = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { otherUid } = OtherUid.parse(req.data);
  await blockRef(me, otherUid).delete();
  return { ok: true as const };
});

const ReportInput = z.object({
  kind: z.enum(["user", "league_message", "dm", "bet_comment"]),
  targetUid: z.string().min(1).max(128),
  reason: z.enum(["harassment", "hate", "sexual", "spam", "threat", "other"]),
  /** The reported item: leagues/{id}/messages/{id}, directMessages/{t}/messages/{id}, betComments/{b}/comments/{id}. */
  path: z.string().max(300).optional(),
  text: z.string().max(600).optional(),
  details: z.string().max(500).optional(),
});

/**
 * Files a report into reports/{id} (server-only; review it in the Firebase
 * console or an admin tool — App Review expects action within 24 hours).
 */
export const reportContent = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const input = ReportInput.parse(req.data);
  if (input.targetUid === me) throw new HttpsError("invalid-argument", "You can't report yourself.");
  const ref = db.collection("reports").doc();
  await ref.set({
    id: ref.id,
    reporterUid: me,
    ...input,
    path: input.path ?? null,
    text: input.text ?? null,
    details: input.details ?? null,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  });
  logger.warn("content reported", { id: ref.id, kind: input.kind, reason: input.reason, targetUid: input.targetUid });
  return { ok: true as const, reportId: ref.id };
});

/** Records acceptance of the current Terms of Service / Community Guidelines. */
export const acceptTerms = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const version = z.number().int().min(1).parse(req.data?.version);
  if (version !== TERMS_VERSION) throw new HttpsError("failed-precondition", "Update the app to accept the latest terms.");
  await db.collection("users").doc(me).update({ termsVersion: TERMS_VERSION, termsAcceptedAt: FieldValue.serverTimestamp() });
  return { ok: true as const, version: TERMS_VERSION };
});

// ---------------------------------------------------------------------------
// Delete account
// ---------------------------------------------------------------------------

const PAGE = 400;

async function deleteMatching(q: FirebaseFirestore.Query): Promise<number> {
  let n = 0;
  for (;;) {
    const snap = await q.limit(PAGE).get();
    if (snap.empty) return n;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    n += snap.size;
    if (snap.size < PAGE) return n;
  }
}

/** Open items that hold another player's credits; these must be settled first. */
export async function deletionBlockers(uid: string): Promise<string | null> {
  const [loans, challenges] = await Promise.all([
    db.collection("friendLoans").where("parties", "array-contains", uid).limit(500).get(),
    db.collection("challenges").where("participants", "array-contains", uid).limit(500).get(),
  ]);
  const owes = loans.docs.some(
    (d) => d.get("status") === "active" && d.get("borrowerUid") === uid && ((d.get("owed") as number) ?? 0) - ((d.get("repaid") as number) ?? 0) > 0
  );
  if (owes) return "Pay back what you owe your friends before deleting your account.";
  const open = challenges.docs.some((d) => d.get("status") === "accepted" || (d.get("status") === "pending" && d.get("opponentUid") === uid));
  if (open) return "Answer or wait out your open challenges before deleting your account — a friend's credits are riding on them.";
  return null;
}

/**
 * Permanently deletes the caller: Auth user, profile and every subcollection
 * (inventory, ledger, notifications, private contact…), username, invite code,
 * birthday, presence, friendships, friend requests, bets, loans, challenges,
 * and every chat message / comment they wrote or received in DMs. In active
 * leagues the standings row stays (other players' results depend on it) but
 * is renamed "Deleted player"; leagues that haven't started drop them.
 */
export const deleteAccount = onCall({ region: "us-central1", timeoutSeconds: 300 }, async (req) => {
  const uid = requireAuth(req.auth);
  z.object({ confirm: z.literal("DELETE") }).parse(req.data);

  const blocker = await deletionBlockers(uid);
  if (blocker) throw new HttpsError("failed-precondition", blocker);

  const userRef = db.collection("users").doc(uid);
  const user = await userRef.get();
  const username = user.get("username") as string | undefined;
  const referralCode = user.get("referralCode") as string | undefined;

  // Leagues
  const leagues = await db.collection("leagues").where("memberIds", "array-contains", uid).get();
  for (const l of leagues.docs) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(l.ref);
      if (!fresh.exists) return;
      const memberIds = ((fresh.get("memberIds") as string[]) ?? []).filter((m) => m !== uid);
      if (fresh.get("status") === "active") {
        tx.update(l.ref, { [`members.${uid}.displayName`]: "Deleted player", [`members.${uid}.deleted`]: true, endVotes: FieldValue.arrayRemove(uid) });
        return;
      }
      const update: Record<string, unknown> = {
        [`members.${uid}`]: FieldValue.delete(),
        memberIds: FieldValue.arrayRemove(uid),
        endVotes: FieldValue.arrayRemove(uid),
      };
      if (fresh.get("creatorId") === uid && memberIds[0]) update.creatorId = memberIds[0];
      if (memberIds.length === 0) update.status = "ended";
      tx.update(l.ref, update);
    });
  }

  // Chat and comments, wherever they live.
  await deleteMatching(db.collectionGroup("messages").where("uid", "==", uid));
  await deleteMatching(db.collectionGroup("messages").where("senderUid", "==", uid));
  await deleteMatching(db.collectionGroup("messages").where("recipientUid", "==", uid));
  await deleteMatching(db.collectionGroup("comments").where("uid", "==", uid));

  // Social graph and economy records.
  await deleteMatching(db.collection("friendships").where("users", "array-contains", uid));
  await deleteMatching(db.collection("friendRequests").where("from", "==", uid));
  await deleteMatching(db.collection("friendRequests").where("to", "==", uid));
  await deleteMatching(db.collection("bets").where("uid", "==", uid));
  await deleteMatching(db.collection("slipParlays").where("uid", "==", uid));
  await deleteMatching(db.collection("friendLoans").where("parties", "array-contains", uid));
  await deleteMatching(db.collection("challenges").where("participants", "array-contains", uid));
  await deleteMatching(db.collection("analyticsEvents").where("uid", "==", uid));

  const singles = db.batch();
  if (username) singles.delete(db.collection("usernames").doc(username));
  if (referralCode) singles.delete(db.collection("referralCodes").doc(referralCode));
  singles.delete(birthdayRef(uid));
  singles.delete(db.collection("presence").doc(uid));
  await singles.commit();

  // Profile + every subcollection (inventory, ledger, notifications, private, blocks…).
  await db.recursiveDelete(userRef);

  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "auth/user-not-found") throw e;
  }
  logger.info("account deleted", { uid });
  return { ok: true as const };
});

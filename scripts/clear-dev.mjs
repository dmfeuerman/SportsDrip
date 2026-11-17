/**
 * Deletes all test data seeded by the `devTools` callable (`dev: true` docs)
 * without requiring any collectionGroup indexes.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/clear-dev.mjs
 *
 * Safe to re-run: only documents tagged `dev: true` (and dev notifications/threads)
 * are removed. Real user accounts and real leagues are untouched.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function deleteDocs(docs, { recursive = false } = {}) {
  if (!docs.length) return 0;

  if (recursive) {
    for (const doc of docs) {
      await db.recursiveDelete(doc.ref);
    }
    return docs.length;
  }

  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 450)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
  return docs.length;
}

async function deleteQuery(q, opts) {
  const snap = await q.get();
  return deleteDocs(snap.docs, opts);
}

const run = async () => {
  const counts = {
    usernames: 0,
    users: 0,
    friendships: 0,
    friendRequests: 0,
    leagues: 0,
    leagueInvites: 0,
    bets: 0,
    prizeBoxes: 0,
    dmThreads: 0,
    messages: 0,
    notifications: 0,
  };

  counts.usernames = await deleteQuery(db.collection("usernames").where("dev", "==", true));
  counts.users = await deleteQuery(db.collection("users").where("dev", "==", true), { recursive: true });
  counts.friendships = await deleteQuery(db.collection("friendships").where("dev", "==", true));
  counts.friendRequests = await deleteQuery(db.collection("friendRequests").where("dev", "==", true));
  counts.leagues = await deleteQuery(db.collection("leagues").where("dev", "==", true), { recursive: true });
  counts.leagueInvites = await deleteQuery(db.collection("leagueInvites").where("dev", "==", true));
  counts.bets = await deleteQuery(db.collection("bets").where("dev", "==", true));

  // Per-user subcollections (avoids collectionGroup index requirements)
  const userRefs = await db.collection("users").listDocuments();
  for (const userRef of userRefs) {
    if (userRef.id.startsWith("devbot")) {
      await db.recursiveDelete(userRef);
      counts.users++;
      continue;
    }

    const boxesSnap = await userRef.collection("prizeBoxes").get();
    const devBoxes = boxesSnap.docs.filter((d) => d.get("dev") === true);
    counts.prizeBoxes += await deleteDocs(devBoxes);

    const notifSnap = await userRef.collection("notifications").get();
    const devNotifs = notifSnap.docs.filter((d) => {
      const data = d.data();
      return (
        d.get("dev") === true ||
        d.id.startsWith("freq_devbot") ||
        (typeof data?.data?.fromUid === "string" && data.data.fromUid.startsWith("devbot")) ||
        data?.bet?.gameId === "DEV:sim" ||
        (typeof data?.bet?.betId === "string" && data.bet.betId.includes("_dev_"))
      );
    });
    counts.notifications += await deleteDocs(devNotifs);
  }

  // Direct message threads (`directMessages/{threadId}` has no parent doc fields, so use listDocuments)
  const dmThreadRefs = await db.collection("directMessages").listDocuments();
  for (const threadRef of dmThreadRefs) {
    if (threadRef.id.includes("devbot")) {
      await db.recursiveDelete(threadRef);
      counts.dmThreads++;
    } else {
      counts.messages += await deleteQuery(threadRef.collection("messages").where("dev", "==", true));
    }
  }

  // Remaining non-dev leagues that might have dev chat messages
  const leagueRefs = await db.collection("leagues").listDocuments();
  for (const leagueRef of leagueRefs) {
    if (leagueRef.id.startsWith("lg_dev_")) {
      await db.recursiveDelete(leagueRef);
      counts.leagues++;
    } else {
      counts.messages += await deleteQuery(leagueRef.collection("messages").where("dev", "==", true));
    }
  }

  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ");

  console.log(summary ? `Cleared dev data (${summary}).` : "No dev data found.");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

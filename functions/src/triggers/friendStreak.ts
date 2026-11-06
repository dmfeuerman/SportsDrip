import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { db } from "../lib/economy";
import { advanceFriendStreak, type FriendStreakState } from "../lib/friendStreak";

const MAX_FRIENDS = 500;

/**
 * When a user's daily streak day moves (their first qualifying pick of an ET
 * day), every friend who has also picked that day advances the pair's Friend
 * Streak. Runs after the pick committed, never inside a money transaction.
 */
export const friendStreakOnPick = onDocumentUpdated(
  { document: "users/{uid}", region: "us-central1", timeoutSeconds: 60 },
  async (event) => {
    const before = event.data?.before.get("streak.lastDay") as string | undefined;
    const day = event.data?.after.get("streak.lastDay") as string | undefined;
    if (!day || day === before) return;
    const uid = event.params.uid;

    const pairs = await db.collection("friendships").where("users", "array-contains", uid).limit(MAX_FRIENDS).get();
    if (pairs.empty) return;
    const others = pairs.docs.map((d) => ({ ref: d.ref, other: (d.get("users") as string[]).find((u) => u !== uid) }));
    const valid = others.filter((o): o is { ref: FirebaseFirestore.DocumentReference; other: string } => !!o.other);
    if (valid.length === 0) return;
    const friendDocs = await db.getAll(...valid.map((o) => db.collection("users").doc(o.other)));
    const actedToday = new Set(friendDocs.filter((d) => d.get("streak.lastDay") === day).map((d) => d.id));

    let advanced = 0;
    for (const { ref, other } of valid) {
      if (!actedToday.has(other)) continue;
      const did = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const next = advanceFriendStreak(snap.get("streak") as Partial<FriendStreakState> | undefined, day);
        if (!next) return false;
        tx.update(ref, { streak: next });
        return true;
      });
      if (did) advanced++;
    }
    if (advanced > 0) logger.info("friend streaks advanced", { uid, day, advanced });
  }
);

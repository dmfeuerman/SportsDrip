import { db, FieldValue, type Tx } from "./economy";
import type { NotificationModel } from "./notifyModel";

export function notificationRef(uid: string, id: string) {
  return db.collection("users").doc(uid).collection("notifications").doc(id);
}

/**
 * Writes a notification inside the caller's transaction, under the
 * deterministic id the model carries. Callers only reach this after their own
 * "has this already happened?" guard (bet still pending, payout not yet paid),
 * so a replay never gets here twice; and if it somehow did, `set` on the same
 * id converges on one document instead of producing a duplicate.
 */
export function writeNotification(tx: Tx, uid: string, n: NotificationModel): void {
  tx.set(notificationRef(uid, n.id), { ...n, createdAt: FieldValue.serverTimestamp() });
}

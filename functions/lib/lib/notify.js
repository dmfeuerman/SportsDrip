"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationRef = notificationRef;
exports.writeNotification = writeNotification;
const economy_1 = require("./economy");
function notificationRef(uid, id) {
    return economy_1.db.collection("users").doc(uid).collection("notifications").doc(id);
}
/**
 * Writes a notification inside the caller's transaction, under the
 * deterministic id the model carries. Callers only reach this after their own
 * "has this already happened?" guard (bet still pending, payout not yet paid),
 * so a replay never gets here twice; and if it somehow did, `set` on the same
 * id converges on one document instead of producing a duplicate.
 */
function writeNotification(tx, uid, n) {
    tx.set(notificationRef(uid, n.id), { ...n, createdAt: economy_1.FieldValue.serverTimestamp() });
}
//# sourceMappingURL=notify.js.map
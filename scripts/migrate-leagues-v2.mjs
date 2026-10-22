/**
 * One-off: upgrades pre-Pass-4 league documents to the server-owned shape.
 *
 *  - members.{uid}.bankLoans[] -> leagues/{id}/loans/{loanId} (simple interest)
 *    Legacy `amount` already includes whatever the old compounding code
 *    charged. That is honoured as owed, split into principal (capped at the
 *    original amount) and accrued interest; from here on it accrues simply.
 *  - legacy `loanRequests` never moved tokens in Firestore mode and are dropped
 *  - adds schemaVersion, formerMemberIds, payoutStatus, betsPush
 *  - rewrites leagueInvites/{code} to the slim shape joinLeague reads
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrate-leagues-v2.mjs [--dry-run]
 *
 * Idempotent: leagues already at schemaVersion 2 are skipped.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const dry = process.argv.includes("--dry-run");

const snap = await db.collection("leagues").get();
let migrated = 0;

for (const doc of snap.docs) {
  const l = doc.data();
  if (l.schemaVersion === 2) continue;

  const batch = db.batch();
  const update = {
    schemaVersion: 2,
    formerMemberIds: l.formerMemberIds ?? [],
    payoutStatus: l.payoutStatus ?? "none",
    lastActivityAt: l.lastActivityAt ?? l.createdAt ?? Date.now(),
    loanRequests: FieldValue.delete(),
  };

  for (const [uid, m] of Object.entries(l.members ?? {})) {
    update[`members.${uid}.betsPush`] = m.betsPush ?? 0;
    update[`members.${uid}.bankLoans`] = FieldValue.delete();
    for (const bl of m.bankLoans ?? []) {
      if (bl.status !== "active" || !(bl.amount > 0)) continue;
      const principalOutstanding = Math.min(bl.originalAmount ?? bl.amount, bl.amount);
      batch.set(doc.ref.collection("loans").doc(`legacy_${bl.id}`), {
        id: `legacy_${bl.id}`,
        leagueId: doc.id,
        kind: "bank",
        borrowerId: uid,
        borrowerName: m.displayName ?? "Player",
        lenderId: null,
        lenderName: "League Bank",
        status: "active",
        principal: bl.originalAmount ?? bl.amount,
        principalOutstanding,
        interestAccrued: Math.max(0, bl.amount - principalOutstanding),
        interestPaid: 0,
        accruedThrough: bl.lastInterestAt ?? bl.takenAt ?? Date.now(),
        ratePct: l.bankInterestRate ?? 10,
        intervalHours: l.bankInterestIntervalHours ?? 24,
        createdAt: bl.takenAt ?? Date.now(),
        fundedAt: bl.takenAt ?? Date.now(),
        updatedAt: Date.now(),
        migratedFrom: "members.bankLoans",
      });
    }
  }
  batch.update(doc.ref, update);
  if (l.code) {
    batch.set(db.collection("leagueInvites").doc(l.code), {
      code: l.code,
      leagueId: doc.id,
      leagueName: l.name,
      buyIn: l.buyIn ?? 0,
      creatorId: l.creatorId ?? null,
      createdAt: l.createdAt ?? Date.now(),
    });
  }
  if (!dry) await batch.commit();
  migrated++;
  console.log(`${dry ? "[dry] " : ""}migrated ${doc.id} (${l.name})`);
}
console.log(`${migrated} league(s) ${dry ? "would be " : ""}migrated.`);

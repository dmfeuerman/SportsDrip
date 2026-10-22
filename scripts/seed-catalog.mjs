/**
 * Seeds catalog/{itemId}.
 *
 * The shop was a hardcoded 15-item array in constants/shopItems.ts, so adding a
 * hat meant a code change and an app release (AUDIT A4, requirement §14). After
 * this runs, adding an item is one Firestore document — no client change.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/seed-catalog.mjs
 *
 * Safe to re-run: writes are merged by id.
 *
 * Item data and field docs: scripts/catalog-data.mjs.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { CATALOG } from "./catalog-data.mjs";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const run = async () => {
  const batch = db.batch();
  for (const it of CATALOG) {
    batch.set(
      db.collection("catalog").doc(it.id),
      { ...it, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
  console.log(`Seeded ${CATALOG.length} catalog items.`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

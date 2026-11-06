/**
 * Seeds live-ops content: meta/liveOps, seasons/{id} (functions/config/seasons.json)
 * and tags rotation / event items in catalog.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-liveops.mjs
 *
 * Safe to re-run. Rotation items that have never dropped are closed
 * (availableUntil = now) so they only sell when the Monday job drops them;
 * items already dropped keep their window.
 */

import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { LIVE_OPS } from "./liveops-data.mjs";

const { seasons } = JSON.parse(readFileSync(new URL("../functions/config/seasons.json", import.meta.url), "utf8"));

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const run = async () => {
  const now = Date.now();
  const ids = [...new Set([...LIVE_OPS.pool, ...LIVE_OPS.events.flatMap((e) => e.itemIds)])];
  const docs = await db.getAll(...ids.map((id) => db.collection("catalog").doc(id)));
  const missing = docs.filter((d) => !d.exists).map((d) => d.id);
  if (missing.length) throw new Error(`Not in catalog (run seed-catalog first): ${missing.join(", ")}`);

  const batch = db.batch();
  batch.set(db.collection("meta").doc("liveOps"), { ...LIVE_OPS, updatedAt: now });
  for (const s of seasons) batch.set(db.collection("seasons").doc(s.id), s);
  for (const d of docs) {
    batch.set(d.ref, d.get("dropId") ? { rotation: true } : { rotation: true, featured: false, availableUntil: now }, { merge: true });
  }
  await batch.commit();
  console.log(`Seeded meta/liveOps, ${seasons.length} seasons, ${docs.length} rotation items.`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

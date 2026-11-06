import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db, FieldValue } from "../lib/economy";

/**
 * Read-cost cut: the store lists (catalog, moves, backgrounds) are mirrored
 * into one document each, bundles/{name} = { items: [{ id, ...data }] }.
 * Clients listen to that single document, so opening the app costs 1 read
 * per list instead of one read per item (hundreds for the catalog), and a
 * price change re-sends one document instead of the whole collection.
 *
 * Rebuilt whenever any item in the collection is written, from whatever
 * wrote it (seed scripts, liveOps, the console).
 */
async function rebuild(name: "catalog" | "moves" | "backgrounds") {
  const snap = await db.collection(name).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  await db.collection("bundles").doc(name).set({ items, count: items.length, builtAt: FieldValue.serverTimestamp() });
}

const opts = { region: "us-central1", maxInstances: 1 } as const;
export const bundleCatalog = onDocumentWritten({ ...opts, document: "catalog/{id}" }, () => rebuild("catalog"));
export const bundleMoves = onDocumentWritten({ ...opts, document: "moves/{id}" }, () => rebuild("moves"));
export const bundleBackgrounds = onDocumentWritten({ ...opts, document: "backgrounds/{id}" }, () => rebuild("backgrounds"));

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundleBackgrounds = exports.bundleMoves = exports.bundleCatalog = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const economy_1 = require("../lib/economy");
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
async function rebuild(name) {
    const snap = await economy_1.db.collection(name).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    await economy_1.db.collection("bundles").doc(name).set({ items, count: items.length, builtAt: economy_1.FieldValue.serverTimestamp() });
}
const opts = { region: "us-central1", maxInstances: 1 };
exports.bundleCatalog = (0, firestore_1.onDocumentWritten)({ ...opts, document: "catalog/{id}" }, () => rebuild("catalog"));
exports.bundleMoves = (0, firestore_1.onDocumentWritten)({ ...opts, document: "moves/{id}" }, () => rebuild("moves"));
exports.bundleBackgrounds = (0, firestore_1.onDocumentWritten)({ ...opts, document: "backgrounds/{id}" }, () => rebuild("backgrounds"));
//# sourceMappingURL=bundles.js.map
/**
 * Must be imported before anything under src/. Swaps firebase-admin's
 * Firestore for the in-memory fake so the real callables, settlement and
 * ledger code run unmodified against it.
 */
import Module = require("module");
import { createFakeFirestore } from "./fakeFirestore";

export const fake = createFakeFirestore();

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const original = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "firebase-admin/firestore") {
    return { getFirestore: () => fake.db, FieldValue: fake.FieldValue, Timestamp: fake.Timestamp };
  }
  if (request === "firebase-admin/app") {
    return { initializeApp: () => ({}), getApps: () => [{}] };
  }
  return original.call(this, request, parent, isMain);
};

process.env.GCLOUD_PROJECT ??= "demo-sportdrip";
process.env.FUNCTIONS_EMULATOR ??= "true";

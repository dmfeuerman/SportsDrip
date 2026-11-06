import { collection, doc, onSnapshot, type Firestore } from "firebase/firestore";

type Item = { id: string } & Record<string, unknown>;

/**
 * Listens to a store list through its one-document mirror, bundles/{name}
 * (functions/src/triggers/bundles.ts): one read instead of one per item.
 * Falls back to the collection itself until the mirror exists.
 */
export function subscribeBundle(db: Firestore, name: "catalog" | "moves" | "backgrounds", onItems: (items: Item[]) => void, onError: (err: Error) => void): () => void {
  let fallback: (() => void) | null = null;
  const stopFallback = () => {
    fallback?.();
    fallback = null;
  };
  const unsub = onSnapshot(
    doc(db, "bundles", name),
    (snap) => {
      const items = snap.get("items") as Item[] | undefined;
      if (snap.exists() && Array.isArray(items)) {
        stopFallback();
        onItems(items);
      } else if (!fallback) {
        fallback = onSnapshot(collection(db, name), (s) => onItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
      }
    },
    (err) => {
      // Rules not deployed yet, etc.: read the collection directly.
      if (!fallback) fallback = onSnapshot(collection(db, name), (s) => onItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
      else onError(err);
    }
  );
  return () => {
    unsub();
    stopFallback();
  };
}

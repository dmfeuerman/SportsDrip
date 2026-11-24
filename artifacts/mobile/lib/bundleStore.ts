import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import { subscribeBundle } from "@/lib/bundles";
import { getDb } from "@/lib/firebase";
import { firstAnswer } from "@/lib/devtrace";

type Name = "catalog" | "moves" | "backgrounds";
export type BundleItem = { id: string } & Record<string, unknown>;

export interface BundleState {
  /** null until the phone's copy or the server has answered. */
  items: BundleItem[] | null;
  /** No copy yet (neither cached nor from the server). */
  loading: boolean;
  error: string | null;
}

interface Entry {
  state: BundleState;
  listeners: Set<() => void>;
  unsub: (() => void) | null;
  hydrated: boolean;
}

const KEY = (name: Name) => `sd.bundle.${name}.v1`;
const entries = new Map<Name, Entry>();

function entry(name: Name): Entry {
  let e = entries.get(name);
  if (!e) {
    e = { state: { items: null, loading: true, error: null }, listeners: new Set(), unsub: null, hydrated: false };
    entries.set(name, e);
  }
  return e;
}

function set(name: Name, next: Partial<BundleState>) {
  const e = entry(name);
  e.state = { ...e.state, ...next };
  e.listeners.forEach((l) => l());
}

/**
 * One listener per store list for the whole app, shared by every screen, with
 * the last copy kept on the phone. A screen opened for the first time (or the
 * app on its next launch) has the catalog at once instead of starting empty —
 * an empty catalog drew characters without their clothes until it arrived.
 */
function start(name: Name) {
  const e = entry(name);
  if (!e.hydrated) {
    e.hydrated = true;
    AsyncStorage.getItem(KEY(name))
      .then((raw) => {
        if (!raw || e.state.items) return;
        const items = JSON.parse(raw) as BundleItem[];
        if (Array.isArray(items)) set(name, { items, loading: false });
      })
      .catch(() => {});
  }
  if (e.unsub) return;
  const db = getDb();
  if (!db) {
    if (!e.state.items) set(name, { loading: false });
    return;
  }
  const answer = firstAnswer(name, () => {
    if (!e.state.items) set(name, { loading: false, error: "Can't reach the server. Check your connection." });
  });
  e.unsub = subscribeBundle(
    db,
    name,
    (items) => {
      answer.hit();
      set(name, { items, loading: false, error: null });
      AsyncStorage.setItem(KEY(name), JSON.stringify(items)).catch(() => {});
    },
    (err) => {
      answer.hit();
      // Let the next screen that needs it try again.
      e.unsub?.();
      e.unsub = null;
      set(name, { loading: false, error: err.message });
    }
  );
}

/** A store list (bundles/{name}), shared app-wide. `fallback` replaces it entirely (demo mode). */
export function useBundle(name: Name, fallback?: BundleItem[] | null): BundleState {
  const e = entry(name);
  const state = useSyncExternalStore(
    (l) => {
      e.listeners.add(l);
      return () => {
        e.listeners.delete(l);
      };
    },
    () => e.state,
    () => e.state
  );
  useEffect(() => {
    if (!fallback) start(name);
  }, [name, fallback]);
  return fallback ? FALLBACK(fallback) : state;
}

const fallbacks = new WeakMap<BundleItem[], BundleState>();
function FALLBACK(items: BundleItem[]): BundleState {
  let s = fallbacks.get(items);
  if (!s) {
    s = { items, loading: false, error: null };
    fallbacks.set(items, s);
  }
  return s;
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { onSnapshot, Timestamp, type DocumentData, type Query } from "firebase/firestore";

/**
 * Phone-side cache for Firestore lists, to cut reads.
 *
 * A plain listener re-reads every document in its result each time the app
 * opens (Firestore's own cache is memory-only on React Native). This keeps
 * the last result in AsyncStorage, shows it instantly, and then listens only
 * for documents changed since the newest one it already has — so opening the
 * app costs a read per *change*, not per document.
 *
 * Display only. Nothing here is trusted by the server: balances, purchases,
 * bet results and inventory are still decided by callables and security
 * rules, so editing this cache on a device changes nothing but what that
 * device shows (and the next full sync overwrites it).
 *
 * A full re-read still happens on first run, after `fullEveryMs`, and when the
 * cache format changes, which also catches anything the delta can't see
 * (deletions, a writer that didn't touch the cursor field).
 */

export interface CachedItem {
  id: string;
}

export interface CachedQueryOpts<T extends CachedItem> {
  /** AsyncStorage key; include the uid and any parameters. */
  key: string;
  /** Bump to throw away caches written by an older build. */
  version: number;
  /** The whole list (first run and periodic resync). Stays live for the session it runs in. */
  full: () => Query;
  /** Documents whose cursor field is past `after`. */
  delta: (after: number | Timestamp) => Query;
  /** The cursor field on a document, in ms. */
  cursorOf: (d: T) => number | null;
  /** Shape of the cursor field in Firestore. */
  cursorType: "number" | "timestamp";
  /** Final say over the merged list: filter, sort, trim. */
  keep?: (items: T[]) => T[];
  /** Merge rule when a delta doc meets a cached one (default: delta wins). */
  pick?: (cached: T, incoming: T) => T;
  fullEveryMs?: number;
}

interface Stored {
  v: number;
  fullAt: number;
  cursor: number;
  items: unknown[];
}

/* Timestamps survive the trip through JSON. */
const TS = "__ts";
const freeze = (v: unknown): unknown => {
  if (v instanceof Timestamp) return { [TS]: v.toMillis() };
  if (Array.isArray(v)) return v.map(freeze);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freeze(x)]));
  return v;
};
const thaw = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(thaw);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o[TS] === "number" && Object.keys(o).length === 1) return Timestamp.fromMillis(o[TS] as number);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, thaw(x)]));
  }
  return v;
};

export function toMillis(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return null;
}

export interface CachedHandle<T> {
  stop: () => void;
  /** Apply a local change (e.g. a notification marked read) to the list and the cache. */
  patch: (id: string, fields: Partial<T>) => void;
}

export function subscribeCached<T extends CachedItem>(
  o: CachedQueryOpts<T>,
  onItems: (items: T[], meta: { fromCache: boolean }) => void,
  onError: (err: Error) => void
): CachedHandle<T> {
  let alive = true;
  let unsub: (() => void) | null = null;
  let map = new Map<string, T>();
  let cursor = 0;
  let fullAt = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const fullEvery = o.fullEveryMs ?? 24 * 3_600_000;

  const list = () => (o.keep ? o.keep([...map.values()]) : [...map.values()]);
  const emit = (fromCache: boolean) => alive && onItems(list(), { fromCache });
  const write = () => {
    const stored: Stored = { v: o.version * 1000 + CACHE_EPOCH, fullAt, cursor, items: list().map(freeze) };
    AsyncStorage.setItem(o.key, JSON.stringify(stored)).catch(() => {});
  };
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      write();
    }, 800);
  };
  const advance = (items: T[]) => {
    for (const d of items) {
      const c = o.cursorOf(d);
      if (c != null && c > cursor) cursor = c;
    }
  };

  const listenFull = () => {
    unsub = onSnapshot(
      o.full(),
      (snap) => {
        if (!alive) return;
        map = new Map(snap.docs.map((d) => [d.id, { ...(d.data() as DocumentData), id: d.id } as T]));
        advance([...map.values()]);
        fullAt = Date.now();
        emit(snap.metadata.fromCache);
        save();
      },
      onError
    );
  };

  const listenDelta = () => {
    const after = o.cursorType === "timestamp" ? Timestamp.fromMillis(cursor) : cursor;
    unsub = onSnapshot(
      o.delta(after),
      (snap) => {
        if (!alive) return;
        let changed = false;
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") continue; // leaving a delta query isn't a deletion
          const d = { ...(ch.doc.data() as DocumentData), id: ch.doc.id } as T;
          const had = map.get(d.id);
          const merged = had && o.pick ? o.pick(had, d) : d;
          map.set(d.id, merged);
          // Move the cursor on, so the next launch asks only for what's newer than this (it used to
          // stay at the last full read and re-read every document since, on every launch).
          advance([merged]);
          changed = true;
        }
        if (!changed) return;
        emit(snap.metadata.fromCache);
        save();
      },
      (err) => {
        // A missing index or rules change: fall back to the plain listener.
        if (!alive) return;
        if (__DEV__) console.warn(`[cache] ${o.key} delta failed, full read`, err.message);
        listenFull();
      }
    );
  };

  AsyncStorage.getItem(o.key)
    .then((raw) => {
      if (!alive) return;
      const s = raw ? (JSON.parse(raw) as Stored) : null;
      if (s && s.v === o.version * 1000 + CACHE_EPOCH && Array.isArray(s.items) && Date.now() - s.fullAt < fullEvery) {
        map = new Map((s.items.map(thaw) as T[]).map((d) => [d.id, d]));
        cursor = s.cursor;
        fullAt = s.fullAt;
        emit(true);
        listenDelta();
      } else listenFull();
    })
    .catch(() => alive && listenFull());

  return {
    stop: () => {
      alive = false;
      unsub?.();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        write();
      }
    },
    patch: (id, fields) => {
      const had = map.get(id);
      if (!had) return;
      map.set(id, { ...had, ...fields });
      emit(false);
      save();
    },
  };
}

/* ── one cached subscription per key, shared by every hook that asks ───────── */

interface Shared<T> {
  items: T[] | null;
  fromCache: boolean;
  error: Error | null;
  /** When the server last delivered a fresh result. */
  syncedAt: number | null;
  refs: number;
  subs: Set<() => void>;
  handle: CachedHandle<T> | null;
  linger: ReturnType<typeof setTimeout> | null;
}

const shared = new Map<string, Shared<CachedItem>>();

export function sharedCached<T extends CachedItem>(opts: CachedQueryOpts<T>) {
  let s = shared.get(opts.key) as Shared<T> | undefined;
  if (!s) {
    s = { items: null, fromCache: true, error: null, syncedAt: null, refs: 0, subs: new Set(), handle: null, linger: null };
    shared.set(opts.key, s as unknown as Shared<CachedItem>);
  }
  const st = s;
  const notify = () => st.subs.forEach((f) => f());
  return {
    get: () => st,
    subscribe: (fn: () => void) => {
      st.subs.add(fn);
      return () => {
        st.subs.delete(fn);
      };
    },
    acquire: () => {
      st.refs++;
      if (st.linger) {
        clearTimeout(st.linger);
        st.linger = null;
      }
      if (st.handle) return;
      st.handle = subscribeCached<T>(
        opts,
        (items, meta) => {
          st.items = items;
          st.fromCache = meta.fromCache;
          if (!meta.fromCache) st.syncedAt = Date.now();
          st.error = null;
          notify();
        },
        (err) => {
          st.error = err;
          notify();
        }
      );
    },
    release: () => {
      st.refs = Math.max(0, st.refs - 1);
      if (st.refs > 0 || st.linger) return;
      // A screen switch shouldn't tear down and restart the listener.
      st.linger = setTimeout(() => {
        st.linger = null;
        if (st.refs === 0) {
          st.handle?.stop();
          st.handle = null;
        }
      }, 60_000);
    },
    patch: (id: string, fields: Partial<T>) => st.handle?.patch(id, fields),
  };
}

/** Wipes every list cached on this phone (sign-out: the next account mustn't see this one's bets). */
/** Bump to drop every cached list on every phone (e.g. after a server-side migration rewrote old docs). 1: coins x10. */
const CACHE_EPOCH = 1;

export async function clearCachedQueries(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("sd.cache."));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {}
}

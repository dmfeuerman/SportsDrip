import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as api from "@/lib/api";
import type { PublicUser } from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { DEMO, demoFriends } from "@/lib/demo";

/** Foreground re-read of requests + friends, under the live listeners. */
export const FRIENDS_POLL_MS = 3 * 60_000;

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  status: "pending" | "accepted" | "declined";
}

const NO_REQUESTS: FriendRequest[] = [];

/**
 * Friends data.
 *
 * Every function this hook hands back is now stable for the lifetime of the
 * mount. That is the fix for the "Maximum update depth exceeded" crash on the
 * Friends tab, not a style preference:
 *
 *   useFriends() returned a fresh `search` arrow on every render
 *     -> FriendsScreen's debounce effect listed `search` in its deps
 *     -> the effect re-ran on every render
 *     -> its first statement was `setResults([])`, a new array each time,
 *        so React could not bail out on referential equality
 *     -> re-render -> new `search` -> effect -> setResults([]) -> forever.
 *
 * React Compiler does not save this: it memoises what it can prove, and it
 * bailed on this hook. Explicit useCallback is the contract.
 *
 * The listeners themselves are unchanged in behaviour: friendship docs drive a
 * re-pull of the enriched list (resolving friendship ids to user docs on the
 * client is an N+1 that `listFriends` does in one getAll), and the two request
 * queries are live so an incoming request lands without a refresh.
 */
/**
 * One set of friend listeners and one poll per signed-in user, shared by every
 * screen that calls useFriends (Chat, Home's checklist, the Friends tab, game
 * and league screens). Each mount used to open its own three listeners and its
 * own 45 s poll — every poll a listFriends call (one read per friend) plus two
 * queries — so the same data was read several times over, every 45 seconds.
 */
interface Shared {
  friends: PublicUser[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  loading: boolean;
  error: string | null;
}

class FriendsStore {
  state: Shared = { friends: [], incoming: NO_REQUESTS, outgoing: NO_REQUESTS, loading: true, error: null };
  private subs = new Set<() => void>();
  private refs = 0;
  private stop: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private lastPull = 0;

  constructor(private uid: string) {}

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  set(next: Partial<Shared>) {
    this.state = { ...this.state, ...next };
    this.subs.forEach((f) => f());
  }

  /** The enriched list. Coalesced: overlapping callers share one call, and a pull within 5 s is reused. */
  refresh = (force = false): Promise<void> => {
    if (this.inflight) return this.inflight;
    if (!force && Date.now() - this.lastPull < 5_000) return Promise.resolve();
    this.inflight = (async () => {
      try {
        const res = await api.listFriends({});
        this.lastPull = Date.now();
        if (JSON.stringify(this.state.friends) !== JSON.stringify(res.friends)) this.set({ friends: res.friends });
        if (this.state.error) this.set({ error: null });
      } catch (err) {
        this.set({ error: api.friendlyError(err) });
      } finally {
        if (this.state.loading) this.set({ loading: false });
        this.inflight = null;
      }
    })();
    return this.inflight;
  };

  /** Fallback re-read under the listeners, for a stalled listener. */
  sync = async () => {
    const db = getDb();
    if (!db) return;
    const pending = (field: "from" | "to") =>
      getDocs(query(collection(db, "friendRequests"), where(field, "==", this.uid), where("status", "==", "pending")));
    const res = await Promise.all([pending("to"), pending("from"), this.refresh(true)]).catch((err: { code?: string }) => {
      if (__DEV__) console.warn(`[friends] poll friendRequests: ${err?.code ?? err}`);
      return null;
    });
    if (!res) return;
    const [inc, out] = res;
    const sameIds = (prev: FriendRequest[], next: { id: string }[]) => prev.length === next.length && prev.every((r, i) => r.id === next[i]?.id);
    const map = (docs: typeof inc.docs) => docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as FriendRequest);
    const incoming = inc.empty ? NO_REQUESTS : sameIds(this.state.incoming, inc.docs) ? this.state.incoming : map(inc.docs);
    const outgoing = out.empty ? NO_REQUESTS : sameIds(this.state.outgoing, out.docs) ? this.state.outgoing : map(out.docs);
    if (incoming !== this.state.incoming || outgoing !== this.state.outgoing) this.set({ incoming, outgoing });
  };

  acquire() {
    this.refs++;
    if (this.stop) return;
    const db = getDb();
    if (!db) {
      this.set({ loading: false });
      return;
    }
    const mapRequests = (docs: { id: string; data: () => unknown }[]) => docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as FriendRequest);
    const unsubs = [
      onSnapshot(
        query(collection(db, "friendships"), where("users", "array-contains", this.uid)),
        () => void this.refresh(true),
        (err) => this.set({ error: api.friendlyError(err) })
      ),
      onSnapshot(
        query(collection(db, "friendRequests"), where("to", "==", this.uid), where("status", "==", "pending")),
        (snap) => this.set({ incoming: snap.empty ? NO_REQUESTS : mapRequests(snap.docs) }),
        (err) => __DEV__ && console.warn(`[friends] incoming listener: ${err.code}`)
      ),
      onSnapshot(
        query(collection(db, "friendRequests"), where("from", "==", this.uid), where("status", "==", "pending")),
        (snap) => this.set({ outgoing: snap.empty ? NO_REQUESTS : mapRequests(snap.docs) }),
        (err) => __DEV__ && console.warn(`[friends] outgoing listener: ${err.code}`)
      ),
    ];
    // Foreground-only fallback poll.
    let timer: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (!timer) timer = setInterval(() => void this.sync().catch(() => {}), FRIENDS_POLL_MS);
    };
    const stopPoll = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active" || AppState.currentState == null) startPoll();
    const app = AppState.addEventListener("change", (st) => (st === "active" ? startPoll() : stopPoll()));
    this.stop = () => {
      unsubs.forEach((u) => u());
      stopPoll();
      app.remove();
    };
  }

  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs > 0) return;
    // Linger briefly so a tab switch doesn't tear down and re-read everything.
    setTimeout(() => {
      if (this.refs === 0 && this.stop) {
        this.stop();
        this.stop = null;
      }
    }, 30_000);
  }
}

const stores = new Map<string, FriendsStore>();
const storeFor = (uid: string) => {
  let st = stores.get(uid);
  if (!st) stores.set(uid, (st = new FriendsStore(uid)));
  return st;
};
const EMPTY: Shared = { friends: [], incoming: NO_REQUESTS, outgoing: NO_REQUESTS, loading: false, error: null };
const noopSub = () => () => {};

export function useFriends(uid: string | null) {
  const store = uid && !DEMO ? storeFor(uid) : null;
  const shared = useSyncExternalStore(store?.subscribe ?? noopSub, () => store?.state ?? EMPTY, () => store?.state ?? EMPTY);
  const [localError, setError] = useState<string | null>(null);
  const friends = DEMO ? demoFriends : shared.friends;
  const { incoming, outgoing, loading } = shared;
  const error = localError ?? shared.error;

  // Guards a setState after the screen has gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    store.acquire();
    void store.refresh();
    return () => store.release();
  }, [store]);

  const refresh = useCallback(async () => {
    await store?.refresh(true);
  }, [store]);
  const sync = useCallback(async () => {
    await store?.sync();
  }, [store]);

  /**
   * Who sent each pending request.
   *
   * friendRequests documents hold uids only, which is why the Friends screen
   * renders "Someone wants to be friends" and asks people to accept a stranger.
   * One getDoc per pending sender is bounded by how many requests a person has
   * open, and users/{uid} is readable by any signed-in user, so this needs no
   * new callable.
   */
  const [senders, setSenders] = useState<Record<string, PublicUser>>({});

  useEffect(() => {
    const missing = incoming.map((r) => r.from).filter((id) => !senders[id]);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const db = getDb();
      if (!db) return;
      const found: Record<string, PublicUser> = {};
      await Promise.all(
        missing.slice(0, 25).map(async (id) => {
          try {
            const snap = await getDoc(doc(db, "users", id));
            if (snap.exists()) found[id] = { uid: id, ...(snap.data() as object) } as PublicUser;
          } catch {
            // A deleted account leaves the row on the generic label.
          }
        })
      );
      if (!cancelled && Object.keys(found).length && alive.current) {
        setSenders((prev) => ({ ...prev, ...found }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // `senders` is read but deliberately not a dependency: adding a resolved
    // sender must not re-run the lookup that resolved it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const wrap = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      // Don't wait on the listener to reflect what we just did.
      void sync().catch(() => {});
      return true;
    } catch (err) {
      if (alive.current) setError(api.friendlyError(err));
      return false;
    }
  }, [sync]);

  const clearError = useCallback(() => {
    setError(null);
    store?.set({ error: null });
  }, [store]);
  const search = useCallback(
    (q: string) => api.searchUsers({ q }).then((r) => r.results),
    []
  );
  const sendRequest = useCallback(
    (toUid: string) => wrap(() => api.sendFriendRequest({ toUid })),
    [wrap]
  );
  const respond = useCallback(
    (fromUid: string, accept: boolean) => wrap(() => api.respondFriendRequest({ fromUid, accept })),
    [wrap]
  );
  const remove = useCallback(
    (otherUid: string) => wrap(() => api.removeFriend({ otherUid })),
    [wrap]
  );

  /** Sets, not arrays — FriendsScreen was rebuilding these on every render. */
  const friendUids = useMemo(() => new Set(friends.map((f) => f.uid)), [friends]);
  const outgoingUids = useMemo(() => new Set(outgoing.map((r) => r.to)), [outgoing]);

  return useMemo(
    () => ({
      friends,
      incoming,
      /** uid -> public profile for whoever sent a pending request. */
      senders,
      outgoing,
      friendUids,
      outgoingUids,
      loading,
      error,
      clearError,
      refresh,
      search,
      sendRequest,
      respond,
      remove,
    }),
    [
      friends,
      incoming,
      /** uid -> public profile for whoever sent a pending request. */
      senders,
      outgoing,
      friendUids,
      outgoingUids,
      loading,
      error,
      clearError,
      refresh,
      search,
      sendRequest,
      respond,
      remove,
    ]
  );
}

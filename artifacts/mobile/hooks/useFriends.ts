import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { PublicUser } from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { DEMO, demoFriends } from "@/lib/demo";

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
export function useFriends(uid: string | null) {
  const [friends, setFriends] = useState<PublicUser[]>(DEMO ? demoFriends : []);
  const [incoming, setIncoming] = useState<FriendRequest[]>(NO_REQUESTS);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>(NO_REQUESTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards a setState after the screen has gone. Firestore callbacks and the
  // listFriends round trip both outlive a fast tab switch.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const res = await api.listFriends({});
      if (!alive.current) return;
      setFriends(res.friends);
      setError(null);
    } catch (err) {
      if (alive.current) setError(api.friendlyError(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid || DEMO) {
      setLoading(false);
      return;
    }
    const db = getDb();
    if (!db) {
      setLoading(false);
      return;
    }

    const mapRequests = (docs: { id: string; data: () => unknown }[]) =>
      docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as FriendRequest);

    const unsubs = [
      onSnapshot(
        query(collection(db, "friendships"), where("users", "array-contains", uid)),
        () => void refresh(),
        (err) => setError(api.friendlyError(err))
      ),
      onSnapshot(
        query(
          collection(db, "friendRequests"),
          where("to", "==", uid),
          where("status", "==", "pending")
        ),
        // Reuse the shared empty array when there is nothing, so an empty
        // snapshot is not a new object identity for every consumer.
        (snap) => setIncoming(snap.empty ? NO_REQUESTS : mapRequests(snap.docs)),
        () => {}
      ),
      onSnapshot(
        query(
          collection(db, "friendRequests"),
          where("from", "==", uid),
          where("status", "==", "pending")
        ),
        (snap) => setOutgoing(snap.empty ? NO_REQUESTS : mapRequests(snap.docs)),
        () => {}
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [uid, refresh]);

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
      return true;
    } catch (err) {
      if (alive.current) setError(api.friendlyError(err));
      return false;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
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

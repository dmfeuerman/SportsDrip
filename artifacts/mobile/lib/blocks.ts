import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useSyncExternalStore } from "react";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";

/**
 * Players the signed-in user blocked (users/{uid}/blocks, server-written by
 * blockUser). Their messages, comments and banners are hidden everywhere, and
 * DMs / friend requests are refused both ways by rules and functions.
 */
let blocked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const set = (next: ReadonlySet<string>) => {
  blocked = next;
  emit();
};

export function isBlocked(uid: string | null | undefined): boolean {
  return !!uid && blocked.has(uid);
}

export function useBlockedUids(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => blocked,
    () => blocked
  );
}

/** One listener for the signed-in user's block list. Mount once (ChatProvider). */
export function useBlocksSync(uid: string | null): void {
  useEffect(() => {
    if (!uid || DEMO) return;
    const db = getDb();
    if (!db) return;
    const unsub = onSnapshot(
      collection(db, "users", uid, "blocks"),
      (snap) => set(new Set(snap.docs.map((d) => d.id))),
      () => {}
    );
    return () => {
      unsub();
      set(new Set());
    };
  }, [uid]);
}

/** Hides them at once; the server write follows (rolled back if it fails). Returns an error message or null. */
export async function blockPlayer(otherUid: string): Promise<string | null> {
  const before = blocked;
  set(new Set([...blocked, otherUid]));
  try {
    await api.blockUser({ otherUid });
    return null;
  } catch (e) {
    set(before);
    return api.friendlyError(e);
  }
}

export async function unblockPlayer(otherUid: string): Promise<string | null> {
  const before = blocked;
  const next = new Set(blocked);
  next.delete(otherUid);
  set(next);
  try {
    await api.unblockUser({ otherUid });
    return null;
  } catch (e) {
    set(before);
    return api.friendlyError(e);
  }
}

import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { PublicUser } from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { DEMO, demoPublicProfiles } from "@/lib/demo";

/**
 * Public profile (name, avatar, outfit) for a set of uids, so league standings
 * and activity render members as their actual characters instead of a coloured
 * initial. Cached for the session and refreshed after thirty minutes, so moving
 * between league screens doesn't re-read the same documents.
 */
const cache = new Map<string, { at: number; user: PublicUser | null }>();
const TTL = 30 * 60_000;

export function usePublicProfiles(uids: string[]): Record<string, PublicUser> {
  const key = [...new Set(uids)].sort().join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    const db = getDb();
    if (!db || !key) return;
    const now = Date.now();
    const missing = key.split(",").filter((u) => {
      const hit = cache.get(u);
      return !hit || now - hit.at > TTL;
    });
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.slice(0, 50).map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          const d = snap.data() as Partial<PublicUser> | undefined;
          cache.set(uid, {
            at: Date.now(),
            user: d
              ? { uid, username: d.username ?? "", displayName: d.displayName ?? "", avatar: d.avatar!, equipped: d.equipped ?? {}, stats: d.stats, favoriteTeams: d.favoriteTeams ?? [] }
              : null,
          });
        } catch {
          cache.set(uid, { at: Date.now(), user: null });
        }
      })
    ).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [key]);

  if (DEMO) return demoPublicProfiles;
  const out: Record<string, PublicUser> = {};
  for (const u of key ? key.split(",") : []) {
    const hit = cache.get(u)?.user;
    if (hit?.avatar) out[u] = hit;
  }
  return out;
}

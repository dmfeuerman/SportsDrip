import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";

/** Seen within this long counts as "online now". */
export const ONLINE_MS = 7 * 60_000;
/** Every beat is a write, and a read for every friend watching: keep it slow. */
const BEAT_MS = 5 * 60_000;
/** A resume within this long of the last beat (same game) doesn't write again. */
const MIN_GAP_MS = 60_000;

let watchingGame: string | null = null;
let beat: (() => void) | null = null;

/** Tell friends which game you're looking at (null when you leave it). */
export function setWatchingGame(gameId: string | null) {
  watchingGame = gameId;
  beat?.();
}

/**
 * Heartbeat to presence/{uid} while the app is in the foreground: on open, on
 * resume and every two minutes. Friends read it for the green dot.
 */
export function usePresenceHeartbeat(uid: string | null | undefined) {
  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    let last = { at: 0, gameId: null as string | null };
    const send = () => {
      if (AppState.currentState !== "active") return;
      const now = Date.now();
      if (now - last.at < MIN_GAP_MS && last.gameId === watchingGame) return;
      last = { at: now, gameId: watchingGame };
      setDoc(doc(db, "presence", uid), { at: now, gameId: watchingGame }).catch(() => {});
    };
    beat = send;
    send();
    const timer = setInterval(send, BEAT_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && send());
    return () => {
      beat = null;
      clearInterval(timer);
      sub.remove();
    };
  }, [uid]);
}

export interface Presence {
  at: number;
  gameId: string | null;
}

/** Friends' last-seen times (and the game they're on), live. */
export function usePresence(uids: string[]): Record<string, Presence> {
  const [map, setMap] = useState<Record<string, Presence>>({});
  const key = uids.slice(0, 60).sort().join(",");
  useEffect(() => {
    if (DEMO || !key) return;
    const db = getDb();
    if (!db) return;
    const unsubs = key.split(",").map((u) =>
      onSnapshot(
        doc(db, "presence", u),
        (s) => {
          const d = s.data() as Partial<Presence> | undefined;
          if (d?.at) setMap((m) => ({ ...m, [u]: { at: d.at!, gameId: d.gameId ?? null } }));
        },
        () => {}
      )
    );
    return () => unsubs.forEach((f) => f());
  }, [key]);
  return map;
}

export function lastSeenLabel(at: number | undefined, now: number): string | null {
  if (!at) return null;
  const ms = now - at;
  if (ms < ONLINE_MS) return "Online now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `Active ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h}h ago`;
  return null;
}

/** Renders nothing; keeps the signed-in user's presence fresh. */
export function PresenceBeat({ uid }: { uid: string }) {
  usePresenceHeartbeat(uid);
  return null;
}

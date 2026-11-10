import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";

export interface FlashPick {
  id: string;
  gameId: string;
  side: "home" | "away";
  teamAbbr: string;
  homeAt: number;
  awayAt: number;
  reward: number;
  status: "pending" | "won" | "lost" | "push";
  createdAt: number;
}

/** Your flash picks on one game, newest first. Listens only while `enabled` (the game is live or just ended). */
export function useFlashPicks(uid: string | null | undefined, gameId: string | null | undefined, enabled: boolean): FlashPick[] {
  const [picks, setPicks] = useState<FlashPick[]>([]);
  useEffect(() => {
    const db = getDb();
    if (!db || !uid || !gameId || !enabled) return;
    return onSnapshot(
      query(collection(db, "flashPicks"), where("uid", "==", uid), where("gameId", "==", gameId)),
      (snap) => setPicks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FlashPick).sort((a, b) => b.createdAt - a.createdAt)),
      () => {}
    );
  }, [uid, gameId, enabled]);
  return picks;
}

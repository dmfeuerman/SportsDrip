import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";

export interface FlashPick {
  id: string;
  gameId: string;
  sport?: string | null;
  side: "home" | "away";
  teamAbbr: string;
  homeAt: number;
  awayAt: number;
  stake?: number;
  paid?: boolean;
  odds?: number | null;
  reward: number;
  status: "pending" | "won" | "lost" | "push";
  createdAt: number;
  settledAt?: number | null;
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

/** All of the signed-in user's live flash picks (for My Bets), newest first. */
export function useMyFlashPicks(uid: string | null | undefined): FlashPick[] {
  const [picks, setPicks] = useState<FlashPick[]>([]);
  useEffect(() => {
    const db = getDb();
    if (!db || !uid) {
      setPicks([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "flashPicks"), where("uid", "==", uid)),
      (snap) =>
        setPicks(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as FlashPick)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 50)
        ),
      () => {}
    );
  }, [uid]);
  return picks;
}

import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { DEMO } from "@/lib/demo";
import type { Market, Selection } from "@/lib/markets";

export interface ParlayLegDoc {
  gameId: string;
  sport: string | null;
  market: Market;
  selection: Selection;
  label: string;
  teamAbbr: string;
  opponentAbbr: string;
  odds: number;
  startsAt: number;
  status: "pending" | "won" | "lost" | "push" | "void";
}
export interface ParlayDoc {
  id: string;
  uid: string;
  legs: ParlayLegDoc[];
  stake: number;
  odds: number;
  potentialPayout: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled";
  firstStartsAt: number;
  placedAt: { seconds: number } | null;
}

/** The player's bet-slip parlays, newest first. */
export function useMyParlays(uid: string | null | undefined): ParlayDoc[] {
  const [list, setList] = useState<ParlayDoc[]>([]);
  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    return onSnapshot(
      query(collection(db, "slipParlays"), where("uid", "==", uid), orderBy("placedAt", "desc"), limit(100)),
      (s) => setList(s.docs.map((d) => ({ ...(d.data() as ParlayDoc), id: d.id }))),
      () => {}
    );
  }, [uid]);
  return list;
}

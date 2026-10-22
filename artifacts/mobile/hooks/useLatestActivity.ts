import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { LeagueActivity } from "@/constants/leagueTypes";
import { getDb } from "@/lib/firebase";
import { DEMO, demoActivity } from "@/lib/demo";

/** The newest feed entry per league, for overview cards. */
export function useLatestActivity(leagueIds: string[]): Record<string, LeagueActivity | undefined> {
  const key = leagueIds.join(",");
  const [map, setMap] = useState<Record<string, LeagueActivity | undefined>>(
    DEMO ? Object.fromEntries(Object.entries(demoActivity).map(([k, v]) => [k, v[0]])) : {}
  );
  useEffect(() => {
    const db = getDb();
    if (!db || !key) return;
    const unsubs = key.split(",").map((id) =>
      onSnapshot(
        query(collection(db, "leagues", id, "activity"), orderBy("at", "desc"), limit(1)),
        (s) => setMap((p) => ({ ...p, [id]: s.docs[0] ? ({ ...(s.docs[0].data() as LeagueActivity), id: s.docs[0].id }) : undefined })),
        () => {}
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return map;
}

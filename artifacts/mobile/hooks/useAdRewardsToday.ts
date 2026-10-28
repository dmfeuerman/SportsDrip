import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Bonus videos credited today (UTC), from users/{uid}/private/ads — written
 * only by the AdMob SSV callback. null until the first snapshot.
 */
export function useAdRewardsToday(uid: string | null | undefined): number | null {
  const [state, setState] = useState<{ day: string; count: number } | null>(null);

  useEffect(() => {
    const db = getDb();
    if (!db || !uid) {
      setState({ day: utcDay(), count: 0 });
      return;
    }
    return onSnapshot(
      doc(db, "users", uid, "private", "ads"),
      (snap) => {
        const d = snap.data() as { day?: string; count?: number } | undefined;
        setState({ day: d?.day ?? "", count: d?.count ?? 0 });
      },
      () => setState({ day: utcDay(), count: 0 })
    );
  }, [uid]);

  if (!state) return null;
  return state.day === utcDay() ? state.count : 0;
}

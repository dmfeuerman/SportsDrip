import { db } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

/**
 * Server-side sweat alerts (replaces the app-open-only client watcher for
 * pushes). On every games sync, a live game whose leader changes notifies
 * everyone holding a moneyline-style position on it — credit bets, league
 * bets and friend challenges — who opted in (users/{uid}.sweatAlerts).
 * At most MAX_PER_GAME lead-change alerts per game; state lives in
 * sweat/{gameId}. Cost scales with live games that have open stakes, not users.
 */
export const MAX_PER_GAME = 3;

type Side = "home" | "away";
interface LiveGame {
  id: string;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  clock?: string | null;
  homeTeam?: { abbreviation: string };
  awayTeam?: { abbreviation: string };
}

export async function sendSweatAlerts(games: LiveGame[], now = Date.now()): Promise<number> {
  let sent = 0;
  for (const g of games) {
    if (g.status !== "live" || g.homeScore == null || g.awayScore == null) continue;
    const leader: Side | "tie" = g.homeScore === g.awayScore ? "tie" : g.homeScore > g.awayScore ? "home" : "away";
    const stateRef = db.collection("sweat").doc(g.id);
    const state = await stateRef.get();
    const prev = state.get("leader") as string | undefined;
    const count = (state.get("count") as number | undefined) ?? 0;
    if (prev === leader) continue;
    await stateRef.set({ leader, count: prev && leader !== "tie" ? count + 1 : count, at: now }, { merge: true });
    // First sighting just records the leader; ties aren't a lead change.
    if (!prev || leader === "tie" || count >= MAX_PER_GAME) continue;

    // uid -> side they're on.
    const holders = new Map<string, Side>();
    const [bets, leagueBets, challenges] = await Promise.all([
      db.collection("bets").where("gameId", "==", g.id).where("status", "==", "pending").limit(2000).get(),
      db.collectionGroup("leagueBets").where("gameId", "==", g.id).where("status", "==", "pending").limit(2000).get(),
      db.collection("challenges").where("gameId", "==", g.id).where("status", "==", "accepted").limit(500).get(),
    ]);
    for (const d of [...bets.docs, ...leagueBets.docs]) {
      const market = (d.get("market") as string | undefined) ?? "ml";
      if (market !== "ml") continue;
      const side = d.get("side") as Side | null;
      if (side && d.get("uid")) holders.set(d.get("uid") as string, side);
    }
    for (const ch of challenges.docs) {
      const cs = ch.get("creatorSide") as Side;
      holders.set(ch.get("creatorUid") as string, cs);
      holders.set(ch.get("opponentUid") as string, cs === "home" ? "away" : "home");
    }
    if (!holders.size) continue;

    const uids = [...holders.keys()];
    const optedIn = new Set<string>();
    for (let i = 0; i < uids.length; i += 100) {
      const snaps = await db.getAll(...uids.slice(i, i + 100).map((u) => db.collection("users").doc(u)));
      for (const s of snaps) if (s.get("sweatAlerts") === true) optedIn.add(s.id);
    }
    const home = g.homeTeam?.abbreviation ?? "HOME";
    const away = g.awayTeam?.abbreviation ?? "AWAY";
    const leadAbbr = leader === "home" ? home : away;
    const line = `${away} ${g.awayScore}, ${home} ${g.homeScore}${g.clock ? ` · ${g.clock}` : ""}`;
    const n = count + 1;

    const targets = uids.filter((u) => optedIn.has(u));
    for (let i = 0; i < targets.length; i += 200) {
      await db.runTransaction(async (tx) => {
        for (const uid of targets.slice(i, i + 200)) {
          const winning = holders.get(uid) === leader;
          writeNotification(
            tx,
            uid,
            simpleNotification({
              id: `sweat_${g.id}_${n}`,
              type: "sweat_alert",
              title: `${leadAbbr} takes the lead`,
              body: `${line} — you're ${winning ? "winning" : "losing"} right now.`,
              now,
              data: { gameId: g.id },
            })
          );
        }
      });
      sent += Math.min(200, targets.length - i);
    }
  }
  return sent;
}

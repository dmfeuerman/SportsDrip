"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PER_GAME = void 0;
exports.sendSweatAlerts = sendSweatAlerts;
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
/**
 * Server-side sweat alerts (replaces the app-open-only client watcher for
 * pushes). On every games sync, a live game whose leader changes notifies
 * everyone holding a moneyline-style position on it — credit bets, league
 * bets and friend challenges — who opted in (users/{uid}.sweatAlerts).
 * At most MAX_PER_GAME lead-change alerts per game; state lives in
 * sweat/{gameId}. Cost scales with live games that have open stakes, not users.
 */
exports.MAX_PER_GAME = 3;
async function sendSweatAlerts(games, now = Date.now()) {
    let sent = 0;
    for (const g of games) {
        if (g.status !== "live" || g.homeScore == null || g.awayScore == null)
            continue;
        const leader = g.homeScore === g.awayScore ? "tie" : g.homeScore > g.awayScore ? "home" : "away";
        const stateRef = economy_1.db.collection("sweat").doc(g.id);
        const state = await stateRef.get();
        const prev = state.get("leader");
        const count = state.get("count") ?? 0;
        if (prev === leader)
            continue;
        await stateRef.set({ leader, count: prev && leader !== "tie" ? count + 1 : count, at: now }, { merge: true });
        // First sighting just records the leader; ties aren't a lead change.
        if (!prev || leader === "tie" || count >= exports.MAX_PER_GAME)
            continue;
        // uid -> side they're on.
        const holders = new Map();
        const [bets, leagueBets, challenges] = await Promise.all([
            economy_1.db.collection("bets").where("gameId", "==", g.id).where("status", "==", "pending").limit(2000).get(),
            economy_1.db.collectionGroup("leagueBets").where("gameId", "==", g.id).where("status", "==", "pending").limit(2000).get(),
            economy_1.db.collection("challenges").where("gameId", "==", g.id).where("status", "==", "accepted").limit(500).get(),
        ]);
        for (const d of [...bets.docs, ...leagueBets.docs]) {
            const market = d.get("market") ?? "ml";
            if (market !== "ml")
                continue;
            const side = d.get("side");
            if (side && d.get("uid"))
                holders.set(d.get("uid"), side);
        }
        for (const ch of challenges.docs) {
            const cs = ch.get("creatorSide");
            holders.set(ch.get("creatorUid"), cs);
            holders.set(ch.get("opponentUid"), cs === "home" ? "away" : "home");
        }
        if (!holders.size)
            continue;
        const uids = [...holders.keys()];
        const optedIn = new Set();
        for (let i = 0; i < uids.length; i += 100) {
            const snaps = await economy_1.db.getAll(...uids.slice(i, i + 100).map((u) => economy_1.db.collection("users").doc(u)));
            for (const s of snaps)
                if (s.get("sweatAlerts") === true)
                    optedIn.add(s.id);
        }
        const home = g.homeTeam?.abbreviation ?? "HOME";
        const away = g.awayTeam?.abbreviation ?? "AWAY";
        const leadAbbr = leader === "home" ? home : away;
        const line = `${away} ${g.awayScore}, ${home} ${g.homeScore}${g.clock ? ` · ${g.clock}` : ""}`;
        const n = count + 1;
        const targets = uids.filter((u) => optedIn.has(u));
        for (let i = 0; i < targets.length; i += 200) {
            await economy_1.db.runTransaction(async (tx) => {
                for (const uid of targets.slice(i, i + 200)) {
                    const winning = holders.get(uid) === leader;
                    (0, notify_1.writeNotification)(tx, uid, (0, notifyModel_1.simpleNotification)({
                        id: `sweat_${g.id}_${n}`,
                        type: "sweat_alert",
                        title: `${leadAbbr} takes the lead`,
                        body: `${line} — you're ${winning ? "winning" : "losing"} right now.`,
                        now,
                        data: { gameId: g.id },
                    }));
                }
            });
            sent += Math.min(200, targets.length - i);
        }
    }
    return sent;
}
//# sourceMappingURL=sweat.js.map
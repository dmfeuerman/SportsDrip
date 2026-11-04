"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerProfile = exports.updateFavoriteTeams = exports.MAX_FAVORITE_TEAMS = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const moves_1 = require("../lib/moves");
const progression_1 = require("../lib/progression");
/**
 * Player profiles: what a tapped league card or friend row opens.
 *
 * users/{uid} is already readable by any signed-in client, but bets are not —
 * the rules only let a client *list* its own. Rather than loosen that, the
 * server decides what the viewer may see:
 *
 *   self / friend  -> public profile + balance + global bet history + trophies
 *   league-mate    -> public profile + that league's bets (already visible to
 *                     members) + their league line + head-to-head rivalry record
 *   anyone else    -> public profile + trophies
 */
const SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"];
exports.MAX_FAVORITE_TEAMS = 5;
const FavoriteTeam = zod_1.z.object({
    sport: zod_1.z.enum(SPORTS),
    abbr: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9&]{2,5}$/),
    name: zod_1.z.string().trim().min(2).max(40),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
exports.updateFavoriteTeams = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const parsed = zod_1.z.array(FavoriteTeam).max(exports.MAX_FAVORITE_TEAMS).safeParse(req.data?.teams);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", `Pick up to ${exports.MAX_FAVORITE_TEAMS} teams.`);
    const seen = new Set();
    const teams = parsed.data.filter((t) => {
        const k = `${t.sport}:${t.abbr}`;
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
    await economy_1.db.collection("users").doc(uid).update({ favoriteTeams: teams, updatedAt: economy_1.FieldValue.serverTimestamp() });
    return { ok: true, teams };
});
function ms(v) {
    if (v instanceof economy_1.Timestamp)
        return v.toMillis();
    if (typeof v === "number")
        return v;
    return null;
}
function betOf(d) {
    const b = d.data();
    return {
        id: d.id,
        gameId: b.gameId,
        sport: b.sport ?? null,
        side: b.side ?? null,
        market: b.market ?? "ml",
        selection: b.selection ?? b.side ?? "home",
        line: b.line ?? null,
        label: b.label ?? b.teamAbbr,
        lock: Boolean(b.lock),
        teamName: b.teamName,
        teamAbbr: b.teamAbbr,
        teamColor: b.teamColor ?? "#5F6B80",
        opponentAbbr: b.opponentAbbr,
        stake: b.stake,
        odds: b.odds,
        potentialPayout: b.potentialPayout,
        status: b.status,
        placedAt: ms(b.placedAt),
        settledAt: ms(b.settledAt),
        finalHomeScore: b.finalHomeScore ?? null,
        finalAwayScore: b.finalAwayScore ?? null,
    };
}
exports.getPlayerProfile = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { uid, leagueId } = zod_1.z
        .object({ uid: zod_1.z.string().min(1).max(128), leagueId: zod_1.z.string().min(1).max(128).optional() })
        .parse(req.data);
    const [user, friendship, league, trophiesSnap, ownedMovesSnap] = await Promise.all([
        economy_1.db.collection("users").doc(uid).get(),
        uid === me ? Promise.resolve(null) : economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, uid)).get(),
        leagueId ? economy_1.db.collection("leagues").doc(leagueId).get() : Promise.resolve(null),
        economy_1.db.collection("users").doc(uid).collection("trophies").limit(50).get(),
        economy_1.db.collection("users").doc(uid).collection("moves").select().get(),
    ]);
    if (!user.exists)
        throw new https_1.HttpsError("not-found", "That player doesn't exist.");
    const self = uid === me;
    const friend = !!friendship?.exists;
    const memberIds = league?.get("memberIds") ?? [];
    const leagueMate = !!league?.exists && memberIds.includes(me) && memberIds.includes(uid);
    const relation = self ? "self" : friend ? "friend" : leagueMate ? "league" : "none";
    const [betsSnap, leagueBetsSnap, rivalrySnap] = await Promise.all([
        self || friend
            ? economy_1.db.collection("bets").where("uid", "==", uid).orderBy("placedAt", "desc").limit(50).get()
            : Promise.resolve(null),
        leagueMate
            ? economy_1.db
                .collection("leagues")
                .doc(leagueId)
                .collection("leagueBets")
                .where("uid", "==", uid)
                .orderBy("placedAt", "desc")
                .limit(30)
                .get()
            : Promise.resolve(null),
        leagueMate && !self
            ? economy_1.db.collection("leagues").doc(leagueId).collection("rivalries").doc((0, economy_1.pairId)(me, uid)).get()
            : Promise.resolve(null),
    ]);
    const m = leagueMate ? league.get(`members.${uid}`) : undefined;
    const now = Date.now();
    const visibleLeagueBets = leagueBetsSnap
        ? leagueBetsSnap.docs
            .filter((d) => {
            if (self)
                return true;
            if (d.get("hidden") !== true)
                return true;
            const startsAt = d.get("startsAt") ?? 0;
            return (startsAt > 0 && startsAt <= now) || d.get("status") !== "pending";
        })
            .map(betOf)
        : [];
    let rivalry = null;
    if (rivalrySnap?.exists) {
        const aUid = rivalrySnap.get("aUid");
        const aWins = rivalrySnap.get("aWins") ?? 0;
        const bWins = rivalrySnap.get("bWins") ?? 0;
        const pushes = rivalrySnap.get("pushes") ?? 0;
        rivalry = {
            myWins: me === aUid ? aWins : bWins,
            theirWins: me === aUid ? bWins : aWins,
            pushes,
        };
    }
    return {
        relation,
        profile: {
            uid,
            username: user.get("username"),
            displayName: user.get("displayName"),
            avatar: user.get("avatar") ?? null,
            equipped: user.get("equipped") ?? {},
            // Only moves they own (or the free ones) — never trust the stored loadout alone.
            moves: (0, moves_1.loadoutOf)((0, moves_1.loadoutOf)(user.get("moves")).filter((id) => (0, moves_1.isFreeMove)(id) || ownedMovesSnap.docs.some((d) => d.id === id))),
            favoriteTeams: user.get("favoriteTeams") ?? [],
            level: (0, progression_1.levelFromXp)(user.get("xp")),
            background: user.get("background") ?? null,
            stats: user.get("stats") ?? null,
            streak: user.get("streak") ?? null,
            punishment: user.get("punishment") ?? null,
            trophies: trophiesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            memberSince: ms(user.get("createdAt")),
            balance: self || friend ? (user.get("balance") ?? null) : null,
        },
        bets: betsSnap ? betsSnap.docs.map(betOf) : null,
        league: leagueMate
            ? {
                leagueId: leagueId,
                leagueName: league.get("name"),
                leagueTokens: m?.leagueTokens ?? 0,
                betsWon: m?.betsWon ?? 0,
                betsLost: m?.betsLost ?? 0,
                betsPush: m?.betsPush ?? 0,
                locksWon: m?.locksWon ?? 0,
                locksLost: m?.locksLost ?? 0,
                joinedAt: m?.joinedAt ?? null,
                bets: visibleLeagueBets,
                rivalry,
            }
            : null,
    };
});
//# sourceMappingURL=players.js.map